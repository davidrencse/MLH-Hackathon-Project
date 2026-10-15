// A lead's output as a decision, not an essay.
//
// A lead's job on a stream is to decide: which engineer owns what, what done looks like, and how
// sure it is of each call. That was being written as prose and read back with a regex — one
// `ASSIGN:` line scraped out of a document, fuzzy-matched against a name, and silently replaced
// with "whoever has least on" when the match failed. The decision was real; the record of it was
// a guess, and a wrong guess looked exactly like a right one.
//
// So the lead is asked for the decision in a shape that can be checked: a JSON block of tasks,
// each with an owner, what done looks like, and the lead's own confidence in the call. Prose is
// still welcome around it — leads should explain themselves — but the part the office acts on is
// parsed, validated and attributable.
//
// Everything here is tolerant on purpose. A model that answers in the wrong shape must degrade to
// the old prose path rather than stall the run, so `parseDecisions` returns null instead of
// throwing, and a block with three good rows and one broken one yields the three.

/** One task a lead assigned, as the lead stated it. */
export interface LeadDecision {
  /** The engineer the lead named, as they wrote it. Resolved against the team separately. */
  owner: string;
  task: string;
  /** What done looks like. Empty when the lead did not say. */
  done: string;
  /**
   * How sure the lead is of this call, 0 to 1.
   *
   * Not a score of the work: a score of the decision. A low number is the lead saying it guessed
   * at scope or at the owner, which is exactly the task an operator should look at first, so it
   * is surfaced rather than averaged away.
   */
  confidence: number;
}

export interface LeadDecisions {
  tasks: LeadDecision[];
  /** What the lead says is missing before this can be built — a hire, a decision, access. */
  needs: string[];
}

/** The fence the lead is asked to put its decision in. */
const BLOCK = /```(?:json)?\s*([\s\S]*?)```/g;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** Above this, a number out of 0..1 is clearly meant as a percentage rather than a fraction. */
const AS_PERCENT = 5;

/**
 * Confidence, as a fraction of 1.
 *
 * Three readings, and the third is the point: a model that answers "80" meant eighty percent, a
 * model that answers "0.8" meant the same thing, and a model that answers "2.4" or "high" has
 * said something this cannot interpret. That last case reads as 0.5, "no opinion".
 *
 * Both other ways of handling it are worse, and asymmetrically so. Clamping 2.4 to 1 reports
 * certainty the lead never claimed. Dividing it by 100 reports 0.024, which flags a decision as
 * a guess when nothing said it was — and the whole use of this number is deciding which calls an
 * operator should look at first, so a wrong flag is as expensive as a missing one.
 */
function asConfidence(value: unknown): number {
  const raw = typeof value === "number" ? value : Number.parseFloat(asString(value));
  if (!Number.isFinite(raw)) return 0.5;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw >= AS_PERCENT && raw <= 100) return raw / 100;
  return 0.5; // out of any range this can read: say so rather than inventing a verdict
}

function asTask(value: unknown): LeadDecision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const owner = asString(row.owner) || asString(row.engineer) || asString(row.assignee);
  const task = asString(row.task) || asString(row.title) || asString(row.description);
  // A row with no owner or no task is not a decision; dropping it is better than inventing
  // either half, and the lead's prose is still there for a human to read.
  if (!owner || !task) return null;
  return {
    owner,
    task,
    done: asString(row.done) || asString(row.doneWhen) || asString(row.acceptance),
    confidence: asConfidence(row.confidence),
  };
}

/**
 * The decision inside a lead's answer, or null when there is not one to act on.
 *
 * Scans every fenced block and takes the last one that parses into at least one task: a model
 * that shows an example block before its real answer should be read as meaning the real one.
 */
export function parseDecisions(answer: string): LeadDecisions | null {
  if (!answer) return null;
  let found: LeadDecisions | null = null;
  for (const match of answer.matchAll(BLOCK)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue; // prose in a fence, or a half-written block
    }
    if (!parsed || typeof parsed !== "object") continue;
    const body = parsed as Record<string, unknown>;
    const rows = Array.isArray(body.tasks) ? body.tasks : Array.isArray(parsed) ? parsed : [];
    const tasks = rows.map(asTask).filter((task): task is LeadDecision => task !== null);
    if (!tasks.length) continue;
    const needs = Array.isArray(body.needs)
      ? body.needs.map(asString).filter(Boolean)
      : [];
    found = { tasks, needs };
  }
  return found;
}

/** Below this, the lead is telling you it guessed, and the office says so instead of hiding it. */
export const LOW_CONFIDENCE = 0.5;

/**
 * The instruction that asks for the block, appended to a lead's prompt.
 *
 * Written as "as well as", not "instead of": the reasoning is the part a human reads, and a lead
 * that answers only in JSON has stopped explaining itself.
 */
export const DECISION_FORMAT = [
  "End your answer with a single fenced ```json block holding your decisions, as well as your reasoning above it:",
  '```json',
  '{"tasks":[{"owner":"<engineer name>","task":"<what they do>","done":"<what done looks like>","confidence":0.0-1.0}],"needs":["<anything missing before this can be built>"]}',
  '```',
  "One entry per task. `confidence` is how sure you are of the call itself — the owner and the scope — not how hard the task is. Say 0.4 when you guessed; do not round everything up to 0.9.",
  "If the stream needs something you do not have, such as an engineer to hire, put it in `needs` rather than assigning work to nobody.",
].join("\n");

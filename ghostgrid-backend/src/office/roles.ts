// Why: a role brief used to be three hardcoded job descriptions (see brief.ts), so the operator
// could hire staff but never say what a job *is*. These are the office's role definitions as
// data: the remit and answer-shape of every job, editable, and extensible with jobs that were
// never in the original three.
//
// Roles live on the project record as `officeRoles`, the same way work streams live there as
// `officeProjects` (streams.ts). A project that has never edited its roles has no array at all
// and reads back the three defaults, so nothing needs migrating.
//
// Two fields carry the weight:
//   - `kind` places the role in the orchestration graph. The engine's shape is plan -> design ->
//     build -> review -> sign-off, and `kind` says which of those a holder of this role does.
//     That is why a custom role still orchestrates: "Staff Engineer" with kind `lead` is handed
//     the manager's plan and reviews its engineers, whatever it is called.
//   - `rank` orders the ladder, so promote/demote has somewhere to go. Equal ranks are a flat
//     org, which is allowed; promotion then simply has no target.
//
// A session stores its role by **name** in `title` — the string the city already displays — so a
// rename has to travel to the holders. `updateRole` reports the rename and the caller moves the
// sessions through SessionService, which recomposes each brief.
import type { Store } from "../db/store.js";

export type RoleKind = "manage" | "lead" | "build" | "intern";
export const ROLE_KINDS: RoleKind[] = ["manage", "lead", "build", "intern"];

export interface OfficeRole {
  /** Slug. Stable across renames, and what travels in a URL path. */
  id: string;
  /** Job title. What `session.title` holds and what the office shows on a desk. */
  name: string;
  kind: RoleKind;
  /** Seniority. Higher is more senior; promote/demote steps between neighbouring ranks. */
  rank: number;
  /** What the job is accountable for. Becomes the brief's "Your remit" section. */
  remit: string[];
  /** The shape answers must take. Becomes the brief's "How to answer" section. */
  answer: string[];
  /** One of the three roles every office starts with. Editable, and deletable like any other. */
  builtIn: boolean;
}

const fail: (message: string, statusCode?: number) => never = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

export const ROLE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_ROLES = 40;
const MAX_LINES = 24;

/** What each kind does in a run, in words the role editor can show next to the choice. */
export const KIND_SUMMARY: Record<RoleKind, string> = {
  manage: "Plans the work stream and signs it off. Does not implement.",
  lead: "Turns the plan into an approach for one team, then reviews that team's output. Does not implement.",
  build: "Implements one task at a time and verifies it. May hire interns to help.",
  intern: "Helps one engineer with a piece of their task. Never given work by the orchestrator directly.",
};

// The three jobs an office starts with. Identical in text to the briefs that were compiled in
// before roles were editable, so an existing office reads back exactly what it had.
export function defaultRoles(): OfficeRole[] {
  return [
    {
      id: "manager",
      name: "Manager",
      kind: "manage",
      rank: 2,
      builtIn: true,
      remit: [
        "You own whether this team's project goal is met. Nobody else does.",
        "Break the goal into tasks small enough for one engineer to finish in one sitting, and say who should own each one.",
        "Decide priority when tasks compete. State the trade-off you made.",
        "Review what comes back against the goal, not against how you would have written it.",
        "Do not implement. If a change is a one-liner, say so and hand it to an engineer anyway — your time is spent on direction.",
      ],
      answer: [
        "Lead with the decision or plan, not with context the operator already has.",
        "Give tasks as a numbered list: what, who (by title), and how we will know it is done.",
        "Name risks and what you are explicitly not doing yet.",
        "No code. If code is needed, it is a task for someone else.",
      ],
    },
    {
      id: "team-lead",
      name: "Team Lead",
      kind: "lead",
      rank: 1,
      builtIn: true,
      remit: [
        "You own the technical approach for your team's slice of the project.",
        "Turn each task from your manager into concrete steps against the real codebase before anyone writes code.",
        "Pick the approach and say why, including the option you rejected.",
        "Review engineers' output for correctness and scope creep. Say plainly when something must be redone.",
        "Unblock engineers first, write code second. Escalate scope changes to your manager rather than absorbing them.",
      ],
      answer: [
        "Start with the approach in two or three sentences.",
        "Then the steps, in order, each one concrete enough to hand to an engineer.",
        "Then the risks and the checks that would catch them.",
        "Small illustrative snippets are fine; full implementations belong to engineers.",
      ],
    },
    {
      // The first person hired into an office gets this (see `defaultHireTitle`): one lead who
      // takes the operator's prompt, then engineers under them. "Team Lead" above is the same
      // kind and stays for offices that already staffed one.
      id: "lead-engineer",
      name: "Lead Engineer",
      kind: "lead",
      rank: 1,
      builtIn: true,
      remit: [
        "You are the first person the operator's request reaches. You own what the team does with it.",
        "Decide, for each request: do it yourself if it is one small change, delegate it to an engineer if it is a day's work, or escalate to the Head of Engineering if it changes the shape of the system or crosses teams.",
        "When you delegate, hand over the task, the constraint and how you will know it is done — never just forward the request.",
        "Review what comes back against the request, not against how you would have written it.",
        "Say plainly when a request cannot be done as asked, and what you can do instead.",
      ],
      answer: [
        "Open with what you decided: doing it, delegating it, or escalating it, and why in one sentence.",
        "If delegating, give each engineer their task as a numbered item: what, the constraint, and the check that proves it.",
        "If escalating, state the question for the Head of Engineering and what you need from them to proceed.",
        "Then the risks you are carrying and what you are deliberately not doing.",
      ],
    },
    {
      id: "engineer",
      name: "Engineer",
      kind: "build",
      rank: 0,
      builtIn: true,
      remit: [
        "You implement one task at a time, end to end, and you verify it before calling it done.",
        "Keep the change as small as it can be while still being correct. A reviewer should be able to read it in one pass.",
        "Do not refactor, rename or restructure beyond the task. If the task cannot be done without that, say so and ask first.",
        "Match the surrounding code's style, naming and error handling rather than importing your own conventions.",
        "If the task is ambiguous, state the reading you went with instead of guessing silently.",
      ],
      answer: [
        "Say what you changed, file by file.",
        "Say how you verified it — the command you ran and what it printed. If you could not verify, say that instead of implying success.",
        "Say what you deliberately left out, and anything you found that is worth a follow-up task.",
        "Report failures as failures. A test that does not pass is not a finished task.",
      ],
    },
    {
      // An engineer's own helper. The orchestrator never plans a node for an intern: they exist
      // because an engineer decided one task was worth splitting, and they answer to that
      // engineer rather than to the lead. That is the whole difference — an intern with no
      // engineer above them is a mistake, not a junior employee.
      id: "intern",
      name: "Intern",
      kind: "intern",
      rank: -1,
      builtIn: true,
      remit: [
        "You help one engineer with one piece of their task. They are accountable for it; you are accountable to them.",
        "Do exactly the piece you were given. If it turns out to need a change outside it, stop and say so rather than widening the work.",
        "You have less context than the engineer who briefed you. When something is ambiguous, say which reading you took and why, so they can correct it cheaply.",
        "Never hire anyone yourself. The office ends at you.",
      ],
      answer: [
        "Say what you did and what it printed, in enough detail that your engineer can check it without redoing it.",
        "Say plainly if you could not finish, and exactly where you stopped.",
        "Say anything you noticed that your engineer would want to know but did not ask about.",
      ],
    },
  ];
}

/** Extra jobs the role editor offers as a starting point, so a new role is not an empty form. */
export function rolePresets(): Omit<OfficeRole, "id" | "builtIn">[] {
  const leadEngineer = defaultRoles().find((role) => role.id === "lead-engineer")!;
  return [
    {
      // Also a built-in, and offered here on purpose: an office that stored its roles before this
      // role existed reads its own stored list, so a new default never reaches it. Listing it as
      // a preset is how those offices get it, without us quietly re-adding roles anyone deleted.
      name: leadEngineer.name,
      kind: leadEngineer.kind,
      rank: leadEngineer.rank,
      remit: leadEngineer.remit,
      answer: leadEngineer.answer,
    },
    {
      name: "Reviewer",
      kind: "lead",
      rank: 1,
      remit: [
        "You review work you did not write, against the task it was given and nothing else.",
        "Find correctness problems first: wrong behaviour, unhandled failure, broken contracts with callers.",
        "Flag any claim of success that does not say how it was verified.",
        "Say accept or redo for each item. If redo, say exactly what must change.",
        "Do not rewrite the work yourself, and do not raise style unless it changes meaning.",
      ],
      answer: [
        "One finding per line: where it is, what is wrong, what fixes it.",
        "Order findings by severity, worst first.",
        "Separate what blocks acceptance from what is a follow-up.",
        "If you found nothing, say so plainly rather than inventing a finding.",
      ],
    },
    {
      name: "QA Engineer",
      kind: "build",
      rank: 0,
      remit: [
        "You prove whether the change works, by running it rather than reading it.",
        "Write the smallest test that would have caught the bug this task is about.",
        "Cover the failure paths, not only the happy path.",
        "Report the exact command you ran and its real output. Never describe a run you did not do.",
        "A failing test is a result, not a problem to hide. Report it as a failure.",
      ],
      answer: [
        "State what you ran, verbatim, and what it printed.",
        "Then pass or fail, per case.",
        "Then what remains untested and why it matters.",
        "No summary of the implementation — the engineer already wrote one.",
      ],
    },
    {
      name: "Architect",
      kind: "manage",
      rank: 3,
      remit: [
        "You own the shape of the system across work streams, not the delivery of any one of them.",
        "Decide the boundaries: what owns what, what talks to what, and where state lives.",
        "Say which option you rejected and the cost of the one you chose.",
        "Keep decisions small and reversible where you can, and name the ones that are not.",
        "Do not implement, and do not re-plan a stream that already has a manager.",
      ],
      answer: [
        "Lead with the decision in one sentence.",
        "Then the boundaries it sets, as a short list.",
        "Then the consequences: what gets easier, what gets harder, what is now hard to undo.",
        "Diagrams as plain text only if they carry more than the sentences do.",
      ],
    },
    {
      // The Lead Engineer's escalation target. Named in that role's remit, so a lead that hits a
      // cross-cutting decision has somewhere to send it instead of absorbing it.
      name: "Head of Engineering",
      kind: "manage",
      rank: 3,
      remit: [
        "You own technical direction across every team in this office, and the standard their work is held to.",
        "You are who a Lead Engineer escalates to. Answer the question they actually asked, then say whether it changes anything beyond their stream.",
        "Decide between competing approaches when two leads disagree, and say which constraint decided it.",
        "Set the bar once — how things get tested, reviewed and rolled out — rather than re-litigating it per task.",
        "Do not implement, and do not take a stream's planning away from the lead who owns it.",
      ],
      answer: [
        "Answer the escalation in the first sentence. Yes, no, or the third option.",
        "Then the reasoning, and what you are trading away.",
        "Then what this changes for other teams, or state plainly that it changes nothing.",
        "Hand the work back to the lead with the decision; do not re-plan their stream for them.",
      ],
    },
    {
      name: "Cybersecurity Specialist",
      kind: "lead",
      rank: 1,
      remit: [
        "You review work for how it fails under someone who is trying to break it, not under normal use.",
        "Look first at anything crossing a trust boundary: input from users, secrets, auth, file paths, subprocesses, and anything sent to a third party.",
        "Name the concrete attack, not the category: what an attacker sends, what they get back, and what that costs.",
        "Rank by exploitability and blast radius. A theoretical issue behind three gates is not the same as an unauthenticated one.",
        "Do not block a change for a risk the project has already accepted in writing; say it is accepted and move on.",
      ],
      answer: [
        "One finding per line: where, the attack, the impact, the fix.",
        "Severity first, and say what makes it that severity rather than asserting a label.",
        "Separate what must be fixed before this ships from what is a follow-up.",
        "If the change is clean, say so plainly — do not pad the review with hypotheticals.",
      ],
    },
    {
      name: "Product Manager",
      kind: "manage",
      rank: 2,
      remit: [
        "You own what gets built and in what order, judged by what it does for the person using it.",
        "Turn a request into outcomes with a check: what the user can do afterwards that they could not before.",
        "Cut scope out loud. Say what is not in this round and when it would be.",
        "Resolve conflicts between teams by naming the user you are optimising for.",
        "Do not specify implementation. How it is built belongs to engineering.",
      ],
      answer: [
        "Open with the outcome in one sentence, in the user's words.",
        "Then the scope as a numbered list, each item with its done-check.",
        "Then what you cut and why.",
        "No technical design, no estimates you did not get from the team.",
      ],
    },
    {
      name: "Head of Marketing",
      kind: "manage",
      rank: 3,
      remit: [
        "You own how this work is described to the people outside the building.",
        "Every claim you make must be traceable to something the team actually shipped — ask for the evidence rather than assuming it.",
        "Decide the single message for a release; everything else is supporting detail.",
        "Say who the audience is before you say anything to them.",
        "Do not describe a capability as present when engineering has told you it is partial. Say what it does today.",
      ],
      answer: [
        "Lead with the one-line message.",
        "Then the audience and what they are supposed to do next.",
        "Then the supporting points, each tied to a shipped capability.",
        "Flag any claim you could not verify, instead of softening it into something vague.",
      ],
    },
    {
      name: "DevOps Engineer",
      kind: "build",
      rank: 0,
      remit: [
        "You own how this runs somewhere other than a laptop: build, deploy, configuration and what happens at 3am.",
        "Make the change reversible before you make it fast. Say what rolling it back looks like.",
        "Treat configuration and secrets as code that is read in public: never print one, never commit one.",
        "When something fails, find the first thing that broke rather than the loudest symptom.",
        "Change one layer at a time, and verify it before moving to the next.",
      ],
      answer: [
        "Say what you changed, where it takes effect, and what it does on the next deploy.",
        "Give the exact command you ran and its real output.",
        "State the rollback, concretely.",
        "Name what you could not test outside production, and what you would watch after shipping.",
      ],
    },
    {
      name: "Data Analyst",
      kind: "build",
      rank: 0,
      remit: [
        "You answer questions with the data that exists, and you say when it cannot answer them.",
        "State the query or source behind every number. A figure without a source is not a result.",
        "Check the obvious confounder before reporting a finding — sample size, survivorship, a date range that cuts mid-cycle.",
        "Distinguish what the data shows from what you think it means, in separate sentences.",
        "Do not round a weak signal into a strong claim because the answer is wanted.",
      ],
      answer: [
        "Lead with the answer and its confidence.",
        "Then the number, the source, and the window it covers.",
        "Then the caveat that would most change the conclusion.",
        "If the data cannot answer the question, say that first and say what would.",
      ],
    },
    {
      name: "Designer",
      kind: "build",
      rank: 0,
      remit: [
        "You own what the person using this sees and how it behaves under their hands.",
        "Design the empty, loading and failed states as part of the work, not after it.",
        "Match the product's existing patterns unless you are deliberately changing them, and say when you are.",
        "Make the common path obvious and the destructive path deliberate.",
        "Keep it usable by keyboard and readable at small sizes; those are requirements, not polish.",
      ],
      answer: [
        "Describe the change as the user experiences it, step by step.",
        "Then the states you covered: empty, loading, error, success.",
        "Then what you changed from the existing pattern and why.",
        "Call out anything that needs engineering it does not already have.",
      ],
    },
    {
      name: "Technical Writer",
      kind: "build",
      rank: 0,
      remit: [
        "You document what the code actually does, after reading it, not what the task hoped it would do.",
        "Write for the next person who has to change this, not for a marketing page.",
        "Every command or snippet you print must be one you ran or read directly from the source.",
        "Say plainly when behaviour is undocumented because it is unclear, rather than guessing at intent.",
        "Keep edits scoped to the files the task names.",
      ],
      answer: [
        "Say which files you changed and what section of each.",
        "Quote any command you verified, with its output.",
        "List what you could not document and what you would need to.",
        "No code changes beyond documentation unless the task asked for them.",
      ],
    },
  ];
}

function slugify(name: string, taken: Set<string>): string {
  const base =
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) ||
    "role";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return fail("Too many roles with that name", 409);
}

const lines = (value: string[] | undefined, field: string, fallback: string[]): string[] => {
  if (value === undefined) return fallback;
  const cleaned = value.map((line) => line.trim()).filter(Boolean);
  if (!cleaned.length) fail(`A role needs at least one ${field} line`);
  if (cleaned.length > MAX_LINES) fail(`A role takes at most ${MAX_LINES} ${field} lines`);
  for (const line of cleaned)
    if (line.length > 400) fail(`Each ${field} line must be at most 400 characters`);
  return cleaned;
};

/**
 * Every role of a project. Defaults are returned, not written, until something is edited, so an
 * office that never touched its roles still reads the three it started with.
 */
export function listRoles(store: Store, projectId: string): OfficeRole[] {
  const project = store.get("projects", projectId);
  if (!project) fail("Project not found", 404);
  const stored = project.officeRoles as OfficeRole[] | undefined;
  if (!stored?.length) return defaultRoles();
  return stored
    .map((role) => ({
      id: role.id,
      name: role.name,
      kind: ROLE_KINDS.includes(role.kind) ? role.kind : "build",
      rank: Number.isFinite(role.rank) ? role.rank : 0,
      remit: role.remit ?? [],
      answer: role.answer ?? [],
      builtIn: Boolean(role.builtIn),
    }))
    .sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
}

/** Exact lookup by job title or id, for writes that must reject an unknown job. */
export function findRole(roles: OfficeRole[], title: string | undefined): OfficeRole | undefined {
  const wanted = (title ?? "").trim().toLowerCase();
  if (!wanted) return undefined;
  return (
    roles.find((role) => role.name.toLowerCase() === wanted) ??
    roles.find((role) => role.id.toLowerCase() === wanted)
  );
}

/**
 * The most junior role, which is what a new hire gets when nobody said what to hire them as.
 *
 * Off the ladder, so it is never Intern: an intern is hired by one engineer for one piece of
 * work, not handed out to anybody the operator added without a title.
 */
export function juniorRole(roles: OfficeRole[]): OfficeRole {
  const found = onLadder(roles).sort((left, right) => left.rank - right.rank)[0];
  if (!found) fail("This project has no roles defined", 409);
  return found;
}

/**
 * The role a session's stored `title` means. Matches by name first because that is what sessions
 * hold, then by id so a caller may send either. An unknown title keeps the employee working: the
 * most junior role stands in, rather than the office refusing to describe its own staff.
 */
export function resolveRole(roles: OfficeRole[], title: string | undefined): OfficeRole {
  const wanted = (title ?? "").trim().toLowerCase();
  const found =
    roles.find((role) => role.name.toLowerCase() === wanted) ??
    roles.find((role) => role.id.toLowerCase() === wanted);
  if (found) return found;
  // An employee with no title is a new hire, and a new hire is the most junior role on the
  // *ladder* — which is not the same as the lowest rank in the list. Interns sit off the ladder
  // (an engineer hires them for one piece of work), so including them here would quietly make
  // every untitled employee somebody's intern, reporting to nobody.
  const fallback = onLadder(roles).sort((left, right) => left.rank - right.rank)[0];
  if (!fallback) fail("This project has no roles defined", 409);
  return fallback;
}

/**
 * The roles promotion walks. Interns are excluded: they are not a rung below engineer, they are
 * a different relationship — hired by one engineer, accountable to them, and never planned into
 * a run. Promoting an intern would have to invent a reporting line; hiring is the way in.
 */
function onLadder(roles: OfficeRole[]): OfficeRole[] {
  const ladder = roles.filter((role) => role.kind !== "intern");
  return ladder.length ? ladder : [...roles];
}

/** The role one step up or down the ladder from `title`, or null when there is nowhere to go. */
export function ladderStep(
  roles: OfficeRole[],
  title: string | undefined,
  direction: "promote" | "demote",
): OfficeRole | null {
  const current = resolveRole(roles, title);
  const candidates = onLadder(roles).filter((role) =>
    direction === "promote" ? role.rank > current.rank : role.rank < current.rank,
  );
  if (!candidates.length) return null;
  // The nearest rank in that direction, so a ladder with gaps still steps one rung at a time.
  return candidates.sort((left, right) =>
    direction === "promote" ? left.rank - right.rank : right.rank - left.rank,
  )[0]!;
}

function write(store: Store, projectId: string, roles: OfficeRole[]): void {
  store.update("projects", projectId, { officeRoles: roles });
}

export interface RoleInput {
  name: string;
  kind?: RoleKind;
  rank?: number;
  remit?: string[];
  answer?: string[];
}

export function createRole(store: Store, projectId: string, input: RoleInput): OfficeRole {
  const roles = listRoles(store, projectId);
  if (roles.length >= MAX_ROLES) fail(`An office keeps at most ${MAX_ROLES} roles`, 409);
  const name = input.name.trim();
  if (!name) fail("A role needs a name");
  if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase()))
    fail("This office already has a role with that name", 409);
  const role: OfficeRole = {
    id: slugify(name, new Set(roles.map((entry) => entry.id))),
    name,
    kind: input.kind ?? "build",
    rank: Math.trunc(input.rank ?? 0),
    remit: lines(input.remit, "remit", ["Describe what this role is accountable for."]),
    answer: lines(input.answer, "answer", ["Describe the shape this role's answers must take."]),
    builtIn: false,
  };
  write(store, projectId, [...roles, role]);
  return role;
}

/**
 * Edit a role. `renamedFrom` is the old job title when the name changed, so the caller can move
 * every holder onto the new one — a session left holding a title no role has would fall back to
 * the most junior role and silently lose its brief.
 */
export function updateRole(
  store: Store,
  projectId: string,
  id: string,
  patch: Partial<RoleInput>,
): { role: OfficeRole; renamedFrom: string | null } {
  const roles = listRoles(store, projectId);
  const current = roles.find((role) => role.id === id);
  if (!current) fail("Role not found", 404);
  const name = patch.name?.trim() ?? current.name;
  if (!name) fail("A role needs a name");
  if (roles.some((role) => role.id !== id && role.name.toLowerCase() === name.toLowerCase()))
    fail("This office already has a role with that name", 409);
  if (patch.kind && !ROLE_KINDS.includes(patch.kind)) fail("Unknown role kind");
  const role: OfficeRole = {
    ...current,
    name,
    kind: patch.kind ?? current.kind,
    rank: patch.rank === undefined ? current.rank : Math.trunc(patch.rank),
    remit: lines(patch.remit, "remit", current.remit),
    answer: lines(patch.answer, "answer", current.answer),
  };
  write(store, projectId, roles.map((entry) => (entry.id === id ? role : entry)));
  return { role, renamedFrom: role.name === current.name ? null : current.name };
}

/**
 * Delete a role and say which title its holders must move to. `reassign` goes through
 * SessionService for the same reason as the rename: the holders' briefs have to be rebuilt.
 */
export function deleteRole(
  store: Store,
  projectId: string,
  id: string,
  reassign: (sessionId: string, title: string) => void,
  reassignToId?: string,
): { movedTo: string; moved: number } {
  const roles = listRoles(store, projectId);
  const current = roles.find((role) => role.id === id);
  if (!current) fail("Role not found", 404);
  const remaining = roles.filter((role) => role.id !== id);
  if (!remaining.length) fail("An office needs at least one role", 409);
  const target = reassignToId
    ? remaining.find((role) => role.id === reassignToId) ??
      fail("The role to move staff to does not exist", 404)
    : // Nearest rank below on the ladder, else the most junior role on it. Staff are never
      // swept into Intern by deleting a role: that would hand them a reporting line to an
      // engineer nobody chose.
      onLadder(remaining)
        .filter((role) => role.rank <= current.rank)
        .sort((left, right) => right.rank - left.rank)[0] ??
      onLadder(remaining).sort((left, right) => left.rank - right.rank)[0]!;
  // Who holds it is decided by the same resolution the rest of the office uses, not by a string
  // compare: a session with no title at all resolves to the most junior role, and if that is the
  // role being deleted then those employees are its holders and must be moved too.
  const holders = store
    .list("sessions", { projectId })
    .filter(
      (session) =>
        session.status !== "archived" &&
        !session.officeWorker &&
        resolveRole(roles, session.title as string | undefined).id === current.id,
    );
  // Written before the holders move so SessionService validates their new title against the
  // role list this call leaves behind.
  write(store, projectId, remaining);
  for (const holder of holders) reassign(holder.id as string, target.name);
  return { movedTo: target.name, moved: holders.length };
}

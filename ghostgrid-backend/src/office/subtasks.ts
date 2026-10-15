// Subtasks: one small piece of work dropped into a project, handed out by that project's lead.
//
// The shape the user asked for, and why it needs two steps rather than one. The operator writes a
// prompt; it does NOT go to an engineer. It goes to the project's **lead**, who already carries
// the whole project in their standing brief (see brief.ts) and is told who is on their team. The
// lead answers with the engineer they are giving it to and the brief for them. Only then is the
// engineer's task created, depending on the lead's, so the engine hands the lead's words to them
// verbatim.
//
// That is why this cannot be one static graph: which engineer works on it is not known until the
// lead has answered. The runner watches the engine's event stream for the delegation finishing
// and creates the second task from what the lead actually said.
//
// A subtask is stored as a `workflows` row of kind `subtask` with its own `stage`, because the
// store's tables are fixed and a subtask genuinely is a tiny workflow. Its reported state comes
// from that stage, never from `workflow.status`: the engine marks a workflow completed as soon as
// every task it can see is terminal, which for a subtask is true the moment the lead answers.
import { randomUUID } from "node:crypto";
import type { Engine } from "../execution/engine.js";
import type { Entity, Store } from "../db/store.js";
import { officeEmployees, type OfficeEmployee } from "./orchestrator.js";
import { parseDecisions, LOW_CONFIDENCE } from "./decisions.js";

export type SubtaskStage = "delegating" | "building" | "done" | "failed" | "cancelled";

export interface SubtaskPerson {
  sessionId: string;
  name: string;
}
export interface Subtask {
  id: string;
  projectId: string;
  buildingId: string;
  officeProjectId: string;
  projectName: string;
  prompt: string;
  stage: SubtaskStage;
  createdAt: string;
  lead: SubtaskPerson | null;
  engineer: SubtaskPerson | null;
  /** True when the lead's answer did not name anyone we could match, so the runner chose. */
  assignedByFallback: boolean;
  /**
   * The lead's own confidence in this assignment, 0 to 1, or null when it did not state one.
   *
   * Null and 1 are different answers: null is a lead that answered in prose and was read by
   * scraping, 1 is a lead that said it was certain. The office shows the low ones because a
   * decision the lead guessed at is the one worth a human's attention first.
   */
  leadConfidence: number | null;
  delegateTaskId: string | null;
  buildTaskId: string | null;
  /** What the lead wrote: the brief the engineer is working from. */
  delegation: string | null;
  /** What the engineer reported back. */
  result: string | null;
  error: string | null;
}

export interface SubtaskInput {
  projectId: string;
  buildingId: string;
  officeProjectId: string;
  prompt: string;
}
export interface SubtaskRunner {
  create(input: SubtaskInput): Subtask;
  list(projectId: string, buildingId?: string, officeProjectId?: string): Subtask[];
  get(id: string): Subtask;
  cancel(id: string): Subtask;
}

const fail: (message: string, statusCode?: number) => never = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

/** The line the lead must open with, so their choice can be acted on rather than just read. */
const ASSIGN_LINE = /^\s*ASSIGN:\s*(.+?)\s*$/im;

/** An engineer matched against a name as the lead wrote it. */
function matchEngineer(named: string, engineers: OfficeEmployee[]): OfficeEmployee | null {
  const wanted = named.trim().toLowerCase().replace(/[.,;:]+$/, "");
  if (!wanted) return null;
  return (
    engineers.find((person) => person.name.toLowerCase() === wanted) ??
    // A lead who writes "ASSIGN: Maya (Engineer)" still meant Maya.
    engineers.find((person) => wanted.startsWith(person.name.toLowerCase())) ??
    engineers.find((person) => wanted.includes(person.name.toLowerCase())) ??
    null
  );
}

/** The lead's pick, and how sure the lead said it was. */
export interface Assignment {
  engineer: OfficeEmployee | null;
  /** 1 when the lead did not state one — the old prose path claims no particular confidence. */
  confidence: number;
  /** True when the pick came from the structured block rather than from scraping prose. */
  stated: boolean;
}

/**
 * Who the lead picked.
 *
 * The structured block first, because that is the lead actually stating a decision and carries
 * its own confidence. Prose with an `ASSIGN:` line is still read — a lead that answers in the
 * old shape must not stall the run — but a scraped pick is a reading of an essay, and the two
 * are not worth the same, so which one it was travels with the answer.
 */
export function parseAssignmentDetail(answer: string, engineers: OfficeEmployee[]): Assignment {
  const decisions = parseDecisions(answer ?? "");
  const decided = decisions?.tasks.map((task) => ({ task, engineer: matchEngineer(task.owner, engineers) }))
    .find((row) => row.engineer !== null);
  if (decided?.engineer) return { engineer: decided.engineer, confidence: decided.task.confidence, stated: true };
  const named = ASSIGN_LINE.exec(answer ?? "")?.[1];
  return { engineer: named ? matchEngineer(named, engineers) : null, confidence: 1, stated: false };
}

/** Who the lead picked, matched against the team by name. Null when nobody matches. */
export function parseAssignment(answer: string, engineers: OfficeEmployee[]): OfficeEmployee | null {
  return parseAssignmentDetail(answer, engineers).engineer;
}

/** The engineer with the fewest unfinished tasks, used only when the lead's pick cannot be read. */
export function leastLoaded(store: Store, engineers: OfficeEmployee[]): OfficeEmployee {
  const open = (sessionId: string) =>
    store.list("tasks", { sessionId }).filter((task) => !["completed", "failed", "cancelled"].includes(task.status as string)).length;
  return [...engineers].sort((a, b) => open(a.sessionId) - open(b.sessionId) || a.name.localeCompare(b.name))[0]!;
}

export function createSubtaskRunner(store: Store, engine: Engine): SubtaskRunner {
  const stream = (projectId: string, officeProjectId: string) => {
    const owner = store.get("projects", projectId);
    if (!owner) fail("Project not found", 404);
    const found = (owner.officeProjects as { id: string; name: string; goal?: string }[] | undefined)
      ?.find((entry) => entry.id === officeProjectId);
    if (!found) fail("Unknown work stream. Create it before giving it subtasks.", 404);
    return { id: found.id, name: found.name, goal: (found.goal ?? "").trim() };
  };

  const staffOf = (row: Entity) => {
    const everyone = officeEmployees(store, row.projectId as string, row.buildingId as string)
      .filter((person) => person.officeProjectId === row.officeProjectId);
    return {
      // By role kind, not job title: a custom role that leads can delegate, and one that
      // implements can be delegated to.
      lead: everyone.find((person) => person.roleKind === "lead")
        ?? everyone.find((person) => person.roleKind === "manage")
        ?? null,
      engineers: everyone.filter((person) => person.roleKind === "build"),
    };
  };

  const describe = (row: Entity): Subtask => {
    const delegate = row.delegateTaskId ? store.get("tasks", row.delegateTaskId as string) : undefined;
    const build = row.buildTaskId ? store.get("tasks", row.buildTaskId as string) : undefined;
    return {
      id: row.id as string,
      projectId: row.projectId as string,
      buildingId: (row.buildingId as string) ?? "",
      officeProjectId: (row.officeProjectId as string) ?? "",
      projectName: (row.projectName as string) ?? "",
      prompt: (row.prompt as string) ?? "",
      stage: (row.stage as SubtaskStage) ?? "delegating",
      createdAt: (row.createdAt as string) ?? "",
      lead: (row.lead as SubtaskPerson | null) ?? null,
      engineer: (row.engineer as SubtaskPerson | null) ?? null,
      assignedByFallback: Boolean(row.assignedByFallback),
      leadConfidence: typeof row.leadConfidence === "number" ? row.leadConfidence : null,
      delegateTaskId: (row.delegateTaskId as string | null) ?? null,
      buildTaskId: (row.buildTaskId as string | null) ?? null,
      delegation: (delegate?.result as string | null) ?? null,
      result: (build?.result as string | null) ?? null,
      error: (row.error as string | null) ?? (build?.error as string | null) ?? (delegate?.error as string | null) ?? null,
    };
  };

  const node = (workflowId: string, key: string, taskId: string, person: SubtaskPerson, title: string) =>
    store.insert("workflow_nodes", { id: randomUUID(), workflowId, key, taskId, title, employeeName: person.name, stage: key });

  /** Hand the work to the engineer the lead named. */
  const delegateTo = (row: Entity, answer: string) => {
    const { engineers } = staffOf(row);
    if (!engineers.length) {
      store.update("workflows", row.id as string, { stage: "failed", error: "The project has no engineer to hand this to." });
      return;
    }
    const decision = parseAssignmentDetail(answer, engineers);
    const picked = decision.engineer;
    const engineer = picked ?? leastLoaded(store, engineers);
    // A lead that told you it guessed is the one row an operator should look at first, so it is
    // recorded rather than averaged into the run's status.
    const unsure = picked !== null && decision.stated && decision.confidence < LOW_CONFIDENCE;
    const lead = row.lead as SubtaskPerson | null;
    const task = engine.submitTask({
      projectId: row.projectId,
      agentId: row.agentId,
      sessionId: engineer.sessionId,
      workflowId: row.id,
      title: `Subtask — ${engineer.name}`,
      // The lead's answer arrives as this task's dependency output, so it is not repeated here.
      prompt: [
        `Work stream: ${row.projectName}`,
        row.goal ? `Goal: ${row.goal}` : "",
        "",
        `Your lead ${lead?.name ?? "the project lead"} has handed you a subtask. Their brief is included above as a dependency output — work from it, not from your own reading of the goal.`,
        picked ? "" : `They did not name an owner clearly, so this came to you as the engineer with the least on. If the brief is addressed to someone else, say so instead of doing their work.`,
        "",
        "The operator's original request, for context only:",
        row.prompt,
        "",
        "Do only this subtask. Report what you changed file by file, how you verified it and what it printed, and anything you deliberately left out. A check that did not pass is not a finished subtask.",
      ].filter(Boolean).join("\n"),
      dependencies: [row.delegateTaskId],
    });
    node(row.id as string, "build", task.id as string, { sessionId: engineer.sessionId, name: engineer.name }, `Subtask — ${engineer.name}`);
    store.update("workflows", row.id as string, {
      stage: "building",
      buildTaskId: task.id,
      engineer: { sessionId: engineer.sessionId, name: engineer.name },
      assignedByFallback: !picked,
      // Only recorded when the lead actually stated one; a scraped prose pick claims nothing.
      leadConfidence: decision.stated ? decision.confidence : null,
    });
    if (unsure)
      store.event("subtask.assignment.unsure", row.id as string, {
        subtaskId: row.id,
        engineer: engineer.name,
        confidence: decision.confidence,
      });
  };

  /** Move a subtask on when one of its tasks reaches a terminal state. */
  const advance = (row: Entity) => {
    const stage = row.stage as SubtaskStage;
    if (stage === "cancelled" || stage === "done" || stage === "failed") return;
    const delegate = row.delegateTaskId ? store.get("tasks", row.delegateTaskId as string) : undefined;
    if (stage === "delegating") {
      if (!delegate || !["completed", "failed", "cancelled"].includes(delegate.status as string)) return;
      if (delegate.status !== "completed") {
        store.update("workflows", row.id as string, { stage: delegate.status === "cancelled" ? "cancelled" : "failed" });
        return;
      }
      delegateTo(row, (delegate.result as string) ?? "");
      return;
    }
    const build = row.buildTaskId ? store.get("tasks", row.buildTaskId as string) : undefined;
    if (!build || !["completed", "failed", "cancelled"].includes(build.status as string)) return;
    store.update("workflows", row.id as string, {
      stage: build.status === "completed" ? "done" : build.status === "cancelled" ? "cancelled" : "failed",
    });
  };

  const pending = () =>
    store.list("workflows")
      .filter((row) => row.kind === "subtask" && ["delegating", "building"].includes(row.stage as string));

  // A task finishing is the only thing that moves a subtask along. Reading the row back rather
  // than trusting the event keeps one code path for live events and for the catch-up below.
  engine.emitter.on("event", (event: Entity) => {
    if (!String(event?.type ?? "").startsWith("task.")) return;
    const taskId = event.taskId as string | undefined;
    if (!taskId) return;
    for (const row of pending())
      if (row.delegateTaskId === taskId || row.buildTaskId === taskId) {
        try { advance(row); } catch { /* a stuck subtask must not take the engine's event loop down */ }
      }
  });
  // The watcher lives in memory, so a restart mid-flight would strand a subtask whose lead
  // answered while the server was down. Catch those up once at construction.
  for (const row of pending()) {
    try { advance(row); } catch { /* reported on the subtask itself */ }
  }

  return {
    create(input) {
      const prompt = input.prompt.trim();
      if (!prompt) fail("Say what the subtask is before handing it to anyone.");
      const agent = store.list("agents", { projectId: input.projectId, buildingId: input.buildingId })[0];
      if (!agent) fail("That building has no agent yet.", 404);
      const work = stream(input.projectId, input.officeProjectId);
      const row = {
        id: randomUUID(),
        kind: "subtask",
        projectId: input.projectId,
        buildingId: input.buildingId,
        agentId: agent.id,
        officeProjectId: work.id,
        projectName: work.name,
        goal: work.goal,
        name: `Subtask — ${work.name}`,
        status: "running",
        prompt,
        stage: "delegating" as SubtaskStage,
        createdAt: new Date().toISOString(),
        lead: null as SubtaskPerson | null,
        engineer: null as SubtaskPerson | null,
        assignedByFallback: false,
        leadConfidence: null,
        delegateTaskId: null as string | null,
        buildTaskId: null as string | null,
      };
      const { lead, engineers } = staffOf(row as unknown as Entity);
      if (!lead)
        fail(`${work.name} has no lead to delegate through. Assign someone whose role leads or plans first.`, 409);
      if (!engineers.length)
        fail(`${work.name} has no engineer to delegate to. Assign one to this project first.`, 409);

      store.insert("workflows", { ...row, lead: { sessionId: lead.sessionId, name: lead.name } });
      const task = engine.submitTask({
        projectId: input.projectId,
        agentId: agent.id,
        sessionId: lead.sessionId,
        workflowId: row.id,
        title: `Delegate — ${work.name}`,
        prompt: [
          `Work stream: ${work.name}`,
          work.goal ? `Goal: ${work.goal}` : "Goal: not stated yet.",
          `Your engineers on this stream: ${engineers.map((person) => person.name).join(", ")}.`,
          "",
          "The operator has given this project a subtask:",
          prompt,
          "",
          "You hold the whole project, so decide who takes this and brief them for it.",
          "Answer in this shape, and nothing before it:",
          "ASSIGN: <one engineer's name, exactly as written above>",
          "",
          "Then the brief for that engineer: what to change, where, what done looks like, and what is out of scope.",
          "Write it to them by name. They are given this document and nothing else, so anything you leave out is a question they cannot ask.",
          "If the subtask conflicts with the project goal, say so first and still name an owner.",
        ].join("\n"),
      });
      store.update("workflows", row.id, { delegateTaskId: task.id });
      node(row.id, "delegate", task.id as string, { sessionId: lead.sessionId, name: lead.name }, `Delegate — ${work.name}`);
      return describe(store.get("workflows", row.id)!);
    },
    list(projectId, buildingId, officeProjectId) {
      return store
        .list("workflows", { projectId })
        .filter((row) => row.kind === "subtask")
        .filter((row) => (buildingId ? row.buildingId === buildingId : true))
        .filter((row) => (officeProjectId ? row.officeProjectId === officeProjectId : true))
        // Insertion order breaks ties. `createdAt` has millisecond resolution and two subtasks
        // dropped in one go share it exactly, which left the comparator returning 0 and the list
        // falling back to the store's oldest-first order — the opposite of what it promises.
        .map((row, index) => ({ row, index }))
        .sort(
          (left, right) =>
            String(right.row.createdAt ?? "").localeCompare(String(left.row.createdAt ?? "")) ||
            right.index - left.index,
        )
        .map(({ row }) => describe(row));
    },
    get(id) {
      const row = store.get("workflows", id);
      if (!row || row.kind !== "subtask") fail("Subtask not found", 404);
      return describe(row);
    },
    cancel(id) {
      const row = store.get("workflows", id);
      if (!row || row.kind !== "subtask") fail("Subtask not found", 404);
      if (!["delegating", "building"].includes(row.stage as string)) return describe(row);
      engine.cancelWorkflow(id);
      store.update("workflows", id, { stage: "cancelled" });
      return describe(store.get("workflows", id)!);
    },
  };
}

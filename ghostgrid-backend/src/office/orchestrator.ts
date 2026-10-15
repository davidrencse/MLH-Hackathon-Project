// Why: the office had an org chart and the engine had a task DAG, but nothing joined them. This
// is that join. Give it a building and one of the office's work streams and it reads the chart
// out of the employees' own sessions, lays the team out as a dependency graph, and hands it to
// the engine as a workflow.
//
// The shape of the graph is the shape of the organisation:
//
//   manager (plan)  ──┬──> lead A (design) ──┬──> engineer (build) ──┬──> lead A (review) ──┐
//                     │                      └──> engineer (build) ──┘                      ├──> manager (sign-off)
//                     └──> lead B (design) ─────> engineer (build) ─────> lead B (review) ──┘
//
// Two engine behaviours make this work without any extra plumbing:
//   - each node runs as that employee's own session, so the engine prepends their standing role
//     brief (see brief.ts) and a manager and an engineer on the same provider behave differently;
//   - a task's prompt is given the output of everything it depends on, so the manager's plan
//     reaches the leads and the leads' designs reach their engineers as real text.
//
// Only employees assigned to the chosen work stream are staffed onto it, which is what makes the
// staffing board mean something: assignment decides who the orchestrator wakes up.
import type { Engine } from "../execution/engine.js";
import type { Entity, Store } from "../db/store.js";
import type { OfficeTitle } from "./brief.js";
import { listRoles, resolveRole, type RoleKind } from "./roles.js";
import { DECISION_FORMAT } from "./decisions.js";

export type OrchestrationScope = "project" | "building";
export type Stage = "plan" | "design" | "build" | "review" | "signoff";

export interface OfficeEmployee {
  sessionId: string;
  name: string;
  title: OfficeTitle;
  /**
   * Where this employee's role puts them in the graph, resolved from the project's role
   * definitions. The graph is built from this rather than from the job title, so a role the
   * operator invented — "Staff Engineer", "Reviewer" — orchestrates like the kind it declares.
   */
  roleKind: RoleKind;
  team: string;
  managerId: string | null;
  officeProjectId: string | null;
  /** Tasks this employee has in flight. The office draws them as working when it is above zero. */
  activeTasks: number;
  /** Total tasks ever given to them, so a desk can say whether anyone has used it. */
  totalTasks: number;
}
export interface PlannedNode {
  key: string;
  stage: Stage;
  sessionId: string;
  employeeName: string;
  employeeTitle: OfficeTitle;
  team: string;
  title: string;
  prompt: string;
  dependsOn: string[];
  /** Whether this step waits for the operator once its dependencies are done. */
  requiresApproval: boolean;
}
export interface OrchestrationPlan {
  projectId: string;
  buildingId: string;
  agentId: string;
  scope: OrchestrationScope;
  officeProject: { id: string; name: string; goal: string };
  staff: OfficeEmployee[];
  nodes: PlannedNode[];
  /** Things the operator should know about the shape of their org, not errors. */
  warnings: string[];
}
export interface OrchestrationNodeStatus {
  key: string;
  stage: Stage | null;
  title: string;
  employeeName: string | null;
  taskId: string | null;
  /** The task's own status, plus `awaiting_approval` for a gated step holding for a decision. */
  status: string;
  requiresApproval: boolean;
  dependsOn: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}
export interface OrchestrationRun {
  id: string;
  name: string;
  status: string;
  projectId: string;
  buildingId: string | null;
  officeProjectId: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  nodes: OrchestrationNodeStatus[];
}
/**
 * One node with everything it was given and everything it produced.
 *
 * `prompt` is the whole thing the employee received — their standing brief, the goal, and the
 * output of every task they depended on — because the usual question about a run is not "did it
 * finish" but "why did the engineer do *that*", and the answer is in what reached them.
 */
export interface TranscriptNode extends OrchestrationNodeStatus {
  prompt: string | null;
  /**
   * `sent` when `prompt` is the text the provider actually received, recorded by the engine as
   * it ran; `assigned` when the step has not run yet, so the only thing to show is the prompt
   * the orchestrator wrote for it. Without this the two were indistinguishable, and a reader
   * comparing stages drew conclusions from text nobody was ever given.
   */
  promptSource: "sent" | "assigned";
  result: string | null;
  /**
   * What the attempt cost. `costUsd` is only ever the figure the vendor itself returned and
   * `estimatedCostUsd` only ever one computed from configured prices, with `costSource` saying
   * which — a run whose provider reports neither reads as unknown rather than as free.
   */
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    estimatedCostUsd: number | null;
    costSource: string | null;
  } | null;
  durationMs: number | null;
}
export interface OrchestrationTranscript extends Omit<OrchestrationRun, "nodes"> {
  goal: string | null;
  nodes: TranscriptNode[];
  /**
   * What the team actually delivered: the output of the node nothing else depends on. That is
   * the sign-off in a full org, and the last surviving stage in a thinner one.
   */
  delivered: { key: string; stage: Stage | null; employeeName: string | null; result: string } | null;
}

export interface OfficeOrchestrator {
  staff(projectId: string, buildingId: string): OfficeEmployee[];
  plan(input: OrchestrateInput): OrchestrationPlan;
  run(input: OrchestrateInput): OrchestrationRun;
  list(projectId: string, buildingId?: string): OrchestrationRun[];
  get(id: string): OrchestrationRun;
  /** The same run with every prompt and every result. Read on demand, never polled. */
  transcript(id: string): OrchestrationTranscript;
  /** Approve or decline one gated step of a run, by its node key. */
  decide(
    id: string,
    key: string,
    decision: "approve" | "reject",
    reason?: string,
  ): OrchestrationRun;
  cancel(id: string): OrchestrationRun;
}
export interface OrchestrateInput {
  projectId: string;
  buildingId: string;
  officeProjectId: string;
  /** Overrides the stored goal for this run only; the stored goal is left alone. */
  goal?: string;
  scope?: OrchestrationScope;
  /** Extra standing instruction for every node of this run, e.g. "do not touch the database". */
  notes?: string;
  /**
   * Stages that wait for the operator before they run. A gated step holds the moment its
   * dependencies finish — the first point at which its prompt is final — so approving `build`
   * means reading the lead's approach before any file is touched.
   */
  approvals?: Stage[];
  priority?: number;
}

// Annotated on the const, not just the arrow: that is what lets TypeScript treat a call to it as
// the end of the branch, so the reads after a guard narrow properly.
const fail: (message: string, statusCode?: number) => never = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

// Workflow node keys are `^[\w-]+$`, so a session id (hex and dashes) can be part of one.
const nodeKey = (stage: string, sessionId: string) => `${stage}-${sessionId}`;

/** The readable form of a task's error, whatever shape the engine stored it in. */
function taskError(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : null;
  const code = typeof record.code === "string" ? record.code : null;
  if (message && code && code !== message) return `${code}: ${message}`;
  return message ?? code ?? JSON.stringify(error).slice(0, 300);
}

const roster = (people: OfficeEmployee[]) =>
  people.length
    ? people.map((person) => `${person.name} (${person.title})`).join(", ")
    : "nobody";

/** Every orchestratable employee of a building: a real backend session with a role. */
export function officeEmployees(store: Store, projectId: string, buildingId: string): OfficeEmployee[] {
  const agents = store.list("agents", { projectId, buildingId });
  const agentIds = new Set(agents.map((agent) => agent.id as string));
  if (!agentIds.size) return [];
  const mine = store
    .list("sessions", { projectId, status: "active" })
    .filter((session) => agentIds.has(session.agentId as string))
    // A desk that is an external terminal window is driven by a human in that window; the
    // orchestrator cannot send it work, so it is not staff for this purpose.
    .filter((session) => !session.officeWorker);
  // One grouped query for the whole office rather than a task scan per employee.
  const counts = store.taskCountsBySession(mine.map((session) => session.id as string));
  const tally = (sessionId: string) => {
    const byStatus = counts.get(sessionId) ?? {};
    let active = 0;
    let total = 0;
    for (const [status, count] of Object.entries(byStatus)) {
      total += count;
      if (!["completed", "failed", "cancelled"].includes(status)) active += count;
    }
    return { active, total };
  };
  const roles = listRoles(store, projectId);
  return mine.map((session) => {
    const { active, total } = tally(session.id as string);
    const role = resolveRole(roles, session.title as string | undefined);
    return {
      sessionId: session.id as string,
      name: (session.name as string) ?? "Employee",
      title: role.name,
      roleKind: role.kind,
      team: ((session.team as string) || "General").trim(),
      managerId: (session.managerId as string | null) ?? null,
      officeProjectId: (session.officeProjectId as string | null) ?? null,
      activeTasks: active,
      totalTasks: total,
    };
  });
}

/** The one agent that gives a building its provider identity. */
function buildingAgent(store: Store, projectId: string, buildingId: string): Entity {
  const agent = store.list("agents", { projectId, buildingId })[0];
  if (!agent)
    fail("That building has no agent yet. Build it in the city before staffing an office.", 404);
  return agent;
}

function officeProject(store: Store, projectId: string, officeProjectId: string) {
  const owner = store.get("projects", projectId);
  if (!owner) fail("Project not found", 404);
  const found = (owner.officeProjects as { id: string; name: string; goal?: string }[] | undefined)
    ?.find((entry) => entry.id === officeProjectId);
  if (!found) fail("Unknown office project. Create the work stream before orchestrating it.", 404);
  return { id: found.id, name: found.name, goal: (found.goal ?? "").trim() };
}

/**
 * Lay the team out as a graph. Pure apart from the reads it is handed, so the plan can be
 * previewed in the office before anything is submitted or charged.
 */
export function buildPlan(
  store: Store,
  input: OrchestrateInput,
): OrchestrationPlan {
  const scope: OrchestrationScope = input.scope ?? "project";
  const agent = buildingAgent(store, input.projectId, input.buildingId);
  const stream = officeProject(store, input.projectId, input.officeProjectId);
  const goal = (input.goal ?? stream.goal).trim();
  if (!goal)
    fail("Give this work stream a goal before running it; the team has nothing to aim at.", 400);

  const everyone = officeEmployees(store, input.projectId, input.buildingId);
  if (!everyone.length)
    fail("This office has no backend employees yet. Hire staff before orchestrating.", 409);
  const staff = scope === "building"
    ? everyone
    : everyone.filter((person) => person.officeProjectId === stream.id);
  if (!staff.length)
    fail(`Nobody is assigned to ${stream.name}. Assign staff on the staffing board, or run the whole building.`, 409);

  const warnings: string[] = [];
  const byId = new Map(staff.map((person) => [person.sessionId, person]));
  // Seniority is the role's kind, not its name: whoever plans is the manager of this run.
  const manager = staff.find((person) => person.roleKind === "manage" && !person.managerId)
    ?? staff.find((person) => person.roleKind === "manage")
    ?? null;
  const leads = staff.filter((person) => person.roleKind === "lead");
  const engineers = staff.filter((person) => person.roleKind === "build");
  if (!manager) warnings.push("Nobody on this stream holds a planning role, so each lead plans their own slice and nobody signs the work off.");
  if (!leads.length && engineers.length)
    warnings.push("Nobody on this stream holds a lead role, so engineers work straight from the manager's plan.");
  if (!engineers.length && (manager || leads.length))
    warnings.push("Nobody on this stream holds an implementing role, so the run produces plans and approaches but no changes.");

  // An engineer's lead is their own manager when that manager leads a team, else the lead of
  // their team, else the only lead there is. Nothing is invented: an engineer with no lead
  // hangs off the manager, and the warning above says so.
  const leadFor = (engineer: OfficeEmployee): OfficeEmployee | null => {
    const direct = engineer.managerId ? byId.get(engineer.managerId) : undefined;
    if (direct?.roleKind === "lead") return direct;
    const sameTeam = leads.find((lead) => lead.team === engineer.team);
    if (sameTeam) return sameTeam;
    return leads.length === 1 ? leads[0]! : null;
  };

  const gated = new Set(input.approvals ?? []);
  const nodes: PlannedNode[] = [];
  // Every node is stamped with its own stage's gate here, so a stage the operator chose to
  // approve cannot be missed by one of the branches below forgetting the field.
  const add = (node: Omit<PlannedNode, "requiresApproval">) =>
    nodes.push({ ...node, requiresApproval: gated.has(node.stage) });
  const repo = typeof agent.repo === "string" && agent.repo.trim() ? agent.repo.trim() : null;
  const context = [
    `Work stream: ${stream.name}`,
    `Goal: ${goal}`,
    `Office: ${(agent.buildingId as string) ?? (agent.name as string)}`,
    repo ? `Repository: ${repo}` : "",
    `Team on this stream: ${roster(staff)}`,
    input.notes?.trim() ? `Standing instruction from the operator: ${input.notes.trim()}` : "",
  ].filter(Boolean).join("\n");

  if (manager) {
    add({
      key: "plan",
      stage: "plan",
      sessionId: manager.sessionId,
      employeeName: manager.name,
      employeeTitle: manager.title,
      team: manager.team,
      title: `Plan — ${stream.name}`,
      dependsOn: [],
      prompt: [
        context,
        "",
        "Plan this work stream. Break the goal into tasks small enough for one engineer to finish in one sitting, and name the owner of each by name and title from the team above.",
        "State the order the tasks must happen in, the priority call you made, and what you are deliberately not doing yet.",
        "Your plan is handed verbatim to the leads below you, so write it for them, not for the operator.",
      ].join("\n"),
    });
  }

  const leadReviewKeys: string[] = [];
  for (const lead of leads) {
    const team = engineers.filter((engineer) => leadFor(engineer)?.sessionId === lead.sessionId);
    const designKey = nodeKey("design", lead.sessionId);
    add({
      key: designKey,
      stage: "design",
      sessionId: lead.sessionId,
      employeeName: lead.name,
      employeeTitle: lead.title,
      team: lead.team,
      title: `Approach — ${lead.team}`,
      dependsOn: manager ? ["plan"] : [],
      prompt: [
        context,
        "",
        // Addressed by the planner's own job title, so a custom senior role reads as the
        // authority it is rather than as a generic "manager".
        manager
          ? `The plan written by ${manager.name}, ${manager.title}, is included above as a dependency output. Take only the items that belong to the ${lead.team} team and turn them into a concrete approach.`
          : `Nobody is planning above you on this stream, so decide the approach for the ${lead.team} team's slice of the goal yourself and say what you assumed about scope.`,
        // A lead writes the work; it does not do the work. This used to tell a lead with no
        // engineers to implement its slice itself, which made the same person author and
        // reviewer of a change and left the operator with no account of what was decided
        // versus what was typed.
        "You do not write code on this stream. Your output is the work itself: tasks, addressed to people, concrete enough to act on. Do not produce patches, diffs or file edits.",
        team.length
          ? `Your engineers are: ${roster(team)}. Write one clearly separated section per engineer, addressed to them by name, concrete enough to implement without asking you anything. Each engineer is given this whole document, so they must be able to find their own section and ignore the others.`
          : "You have no engineers on this stream. Write the task list anyway, one task per section, each addressed to the role that should own it, and say plainly at the top that this stream needs engineers hired before any of it can be built. Do not implement it yourself.",
        "For each task say what done looks like and the check that proves it.",
        "Say which approach you rejected and why, and name the checks that would catch it if you are wrong.",
        "",
        // The office acts on the block, not on the prose. Scraping one `ASSIGN:` line out of a
        // document and fuzzy-matching a name meant a misread looked exactly like a clean read.
        DECISION_FORMAT,
      ].join("\n"),
    });

    const buildKeys: string[] = [];
    for (const engineer of team) {
      const buildKey = nodeKey("build", engineer.sessionId);
      buildKeys.push(buildKey);
      add({
        key: buildKey,
        stage: "build",
        sessionId: engineer.sessionId,
        employeeName: engineer.name,
        employeeTitle: engineer.title,
        team: engineer.team,
        title: `Build — ${engineer.name}`,
        // The manager's plan comes through as well as the lead's approach. An engineer that
        // only ever saw its own section could not tell a deliberate scope cut from an omission,
        // and asked the operator questions the plan had already answered.
        dependsOn: manager ? ["plan", designKey] : [designKey],
        prompt: [
          context,
          "",
          `You are ${engineer.name}, ${engineer.title}, on the ${engineer.team} team.`,
          manager
            ? `Two documents are included above as dependency outputs: the plan by ${manager.name}, ${manager.title}, and the approach by ${lead.name}, ${lead.title}. The plan is the why and the order; the approach is the how.`
            : `${lead.name}, ${lead.title}, has written the approach, included above as a dependency output.`,
          `Find the section addressed to you, ${engineer.name}, and implement only that. Read the rest for context so you do not duplicate or contradict it — ${team.length > 1 ? `${roster(team.filter((mate) => mate.sessionId !== engineer.sessionId))} ${team.length > 2 ? "are" : "is"} working in parallel with you` : "you are the only engineer on this slice"}.`,
          repo ? `The repository is ${repo}. Read before you write: the conventions you must follow are in the code and in any AGENTS.md or CLAUDE.md beside it.` : "",
          "Keep the change as small as it can be while still correct. Do not take on another engineer's section.",
          "If the brief is ambiguous, state the reading you went with and carry on; do not stop to ask.",
          "Report what you changed file by file, how you verified it and what it printed, and anything you deliberately left out. A check that did not pass is not a finished task — say so.",
        ].filter(Boolean).join("\n"),
      });
    }

    if (buildKeys.length) {
      const reviewKey = nodeKey("review", lead.sessionId);
      leadReviewKeys.push(reviewKey);
      add({
        key: reviewKey,
        stage: "review",
        sessionId: lead.sessionId,
        employeeName: lead.name,
        employeeTitle: lead.title,
        team: lead.team,
        title: `Review — ${lead.team}`,
        dependsOn: buildKeys,
        prompt: [
          context,
          "",
          `Your engineers' reports are included above as dependency outputs. Review them against the approach you set for the ${lead.team} team.`,
          "For each engineer say accept or redo, and if redo, exactly what must change. Judge correctness and scope, not whether they wrote it the way you would have.",
          "Call out anything that claims success without saying how it was verified.",
          "Finish with the state of your team's slice in two or three sentences, for your manager.",
        ].join("\n"),
      });
    } else {
      // A lead with no engineers has already done the work in their design node.
      leadReviewKeys.push(designKey);
    }
  }

  // Engineers with no lead at all report straight to the manager's plan.
  const unled = engineers.filter((engineer) => !leadFor(engineer));
  for (const engineer of unled) {
    const buildKey = nodeKey("build", engineer.sessionId);
    add({
      key: buildKey,
      stage: "build",
      sessionId: engineer.sessionId,
      employeeName: engineer.name,
      employeeTitle: engineer.title,
      team: engineer.team,
      title: `Build — ${engineer.name}`,
      dependsOn: manager ? ["plan"] : [],
      prompt: [
        context,
        "",
        manager
          ? `The plan written by ${manager.name}, ${manager.title}, is included above as a dependency output. Find the task assigned to you, ${engineer.name}, and implement only that. Nobody leads you on this stream, so if the task is ambiguous, state the reading you went with rather than waiting.`
          : `There is no plan above you on this stream. Take the smallest correct step towards the goal that is clearly yours, ${engineer.name}, and say what you assumed.`,
        "Report what you changed file by file, how you verified it and what it printed, and anything you deliberately left out.",
      ].join("\n"),
    });
    leadReviewKeys.push(buildKey);
  }

  if (manager && leadReviewKeys.length) {
    add({
      key: "signoff",
      stage: "signoff",
      sessionId: manager.sessionId,
      employeeName: manager.name,
      employeeTitle: manager.title,
      team: manager.team,
      title: `Sign-off — ${stream.name}`,
      dependsOn: leadReviewKeys,
      prompt: [
        context,
        "",
        "Every team's result is included above as dependency outputs. Judge them against the goal, not against how you would have done the work.",
        "Say whether the goal is met, partly met or not met, and why. List what is left, as tasks with owners.",
        "If a team reported a failure or an unverified claim, say that plainly rather than rolling it into a summary.",
      ].join("\n"),
    });
  }

  if (!nodes.length)
    fail("This team has nobody who can be given work on that stream.", 409);
  return {
    projectId: input.projectId,
    buildingId: input.buildingId,
    agentId: agent.id as string,
    scope,
    officeProject: { ...stream, goal },
    staff,
    nodes,
    warnings,
  };
}

export function createOfficeOrchestrator(store: Store, engine: Engine): OfficeOrchestrator {
  const describe = (workflow: Entity): OrchestrationRun => {
    const nodes = store.list("workflow_nodes", { workflowId: workflow.id as string });
    return {
      id: workflow.id as string,
      name: workflow.name as string,
      status: workflow.status as string,
      projectId: workflow.projectId as string,
      buildingId: (workflow.buildingId as string | null) ?? null,
      officeProjectId: (workflow.officeProjectId as string | null) ?? null,
      createdAt: (workflow.createdAt as string | null) ?? null,
      startedAt: (workflow.startedAt as string | null) ?? null,
      completedAt: (workflow.completedAt as string | null) ?? null,
      nodes: nodes.map((node) => {
        const task = node.taskId ? store.get("tasks", node.taskId as string) : undefined;
        return {
          key: node.key as string,
          stage: (node.stage as Stage | null) ?? null,
          title: (node.title as string) ?? (node.key as string),
          employeeName: (node.employeeName as string | null) ?? null,
          taskId: (node.taskId as string | null) ?? null,
          // A node whose task has not been submitted yet is still pending, not missing.
          status: (task?.status as string) ?? "pending",
          requiresApproval: Boolean(node.requiresApproval),
          dependsOn: (node.dependsOn as string[] | undefined) ?? [],
          startedAt: (task?.startedAt as string | null) ?? null,
          completedAt: (task?.completedAt as string | null) ?? null,
          // A task's error is `{code, message}`, not a string. Passing it through as one put a
          // literal "[object Object]" in front of the operator exactly when something had gone
          // wrong and they needed to read it.
          error: taskError(task?.error),
        };
      }),
    };
  };

  return {
    staff(projectId, buildingId) {
      buildingAgent(store, projectId, buildingId);
      return officeEmployees(store, projectId, buildingId);
    },
    plan(input) {
      return buildPlan(store, input);
    },
    run(input) {
      const plan = buildPlan(store, input);
      // `createWorkflow` writes only the fields it knows, but it spreads each node wholesale, so
      // the per-node office fields ride along there and the workflow's own are stamped on after.
      const workflow = engine.createWorkflow({
        projectId: plan.projectId,
        name: `${plan.officeProject.name} — ${plan.buildingId}`,
        nodes: plan.nodes.map((node) => ({
          key: node.key,
          agentId: plan.agentId,
          sessionId: node.sessionId,
          title: node.title,
          prompt: node.prompt,
          dependsOn: node.dependsOn,
          priority: input.priority ?? 0,
          stage: node.stage,
          employeeName: node.employeeName,
          requiresApproval: node.requiresApproval,
        })),
      });
      // Stamped before the run so a crash between the two still leaves the run attributable to
      // the office that started it.
      store.update("workflows", workflow.id as string, {
        buildingId: plan.buildingId,
        officeProjectId: plan.officeProject.id,
        goal: plan.officeProject.goal,
        scope: plan.scope,
      });
      engine.runWorkflow(workflow.id as string);
      return describe(store.get("workflows", workflow.id as string)!);
    },
    list(projectId, buildingId) {
      return store
        .list("workflows", { projectId })
        .filter((workflow) => (buildingId ? workflow.buildingId === buildingId : Boolean(workflow.buildingId)))
        // See subtasks.ts: millisecond timestamps tie, so insertion order decides, newest last.
        .map((workflow, index) => ({ workflow, index }))
        .sort(
          (left, right) =>
            String(right.workflow.createdAt ?? "").localeCompare(String(left.workflow.createdAt ?? "")) ||
            right.index - left.index,
        )
        .map(({ workflow }) => describe(workflow));
    },
    get(id) {
      const workflow = store.get("workflows", id);
      if (!workflow) fail("Orchestration run not found", 404);
      return describe(workflow);
    },
    transcript(id) {
      const workflow = store.get("workflows", id);
      if (!workflow) fail("Orchestration run not found", 404);
      const run = describe(workflow);
      const rows = store.list("workflow_nodes", { workflowId: workflow.id as string });
      const assignedPrompt = new Map(rows.map((row) => [row.key as string, (row.prompt as string | null) ?? null]));
      const usageRows = store.list("usage_records", {});
      const nodes: TranscriptNode[] = run.nodes.map((node) => {
        const task = node.taskId ? store.get("tasks", node.taskId) : undefined;
        const usage = node.taskId
          ? usageRows.find((row) => row.taskId === node.taskId)
          : undefined;
        const started = node.startedAt ? Date.parse(node.startedAt) : Number.NaN;
        const completed = node.completedAt ? Date.parse(node.completedAt) : Number.NaN;
        // The engine records the composed prompt — role brief, project instructions, saved
        // notes, the task prompt and every dependency output — when it hands it to the
        // provider. That is what the employee read, and it is what this answers with; the
        // orchestrator's own prompt is the fallback for a step that has not run.
        const sent = (task?.effectivePrompt as string | null) ?? null;
        return {
          ...node,
          promptSource: sent ? ("sent" as const) : ("assigned" as const),
          prompt:
            sent ?? assignedPrompt.get(node.key) ?? ((task?.prompt as string | null) ?? null),
          result: (task?.result as string | null) ?? null,
          usage: usage
            ? {
                inputTokens: (usage.inputTokens as number | null) ?? null,
                outputTokens: (usage.outputTokens as number | null) ?? null,
                costUsd: (usage.costUsd as number | null) ?? null,
                estimatedCostUsd: (usage.estimatedCostUsd as number | null) ?? null,
                costSource: (usage.costSource as string | null) ?? null,
              }
            : null,
          durationMs: Number.isFinite(started) && Number.isFinite(completed) ? completed - started : null,
        };
      });
      // The delivered node is the one nothing depends on. A full org ends at the manager's
      // sign-off; a team with no manager ends at a review, and with neither, at the build.
      const dependedOn = new Set(nodes.flatMap((node) => node.dependsOn));
      const terminal = nodes.filter((node) => !dependedOn.has(node.key) && node.result);
      const last = terminal[terminal.length - 1] ?? null;
      return {
        ...run,
        goal: (workflow.goal as string | null) ?? null,
        nodes,
        delivered: last
          ? { key: last.key, stage: last.stage, employeeName: last.employeeName, result: last.result! }
          : null,
      };
    },
    decide(id, key, decision, reason) {
      const workflow = store.get("workflows", id);
      if (!workflow) fail("Orchestration run not found", 404);
      const node = store
        .list("workflow_nodes", { workflowId: id })
        .find((row) => row.key === key);
      if (!node) fail("This run has no step with that key", 404);
      if (!node.taskId)
        fail("That step has not been submitted yet, so there is nothing to decide.", 409);
      if (decision === "approve") engine.approveTask(node.taskId as string);
      else engine.rejectTask(node.taskId as string, reason);
      return describe(store.get("workflows", id)!);
    },
    cancel(id) {
      const workflow = store.get("workflows", id);
      if (!workflow) fail("Orchestration run not found", 404);
      engine.cancelWorkflow(id);
      return describe(store.get("workflows", id)!);
    },
  };
}

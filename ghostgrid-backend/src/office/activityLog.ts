// Why: the office could show you one employee's conversation, or the whole engine's event
// firehose, and nothing in between. What an operator actually wants for a work stream is the
// middle: who is on it, what each of them is doing right now, and what has happened on it in
// order. That is one read here rather than one poll per desk — eleven pollers was the problem,
// not the solution.
//
// Built from `tasks` rather than from `execution_events`. A task is the unit of work an employee
// was given: it carries who asked, what they asked, what came back, whether it failed, and what
// it cost. Events are finer than that and would need reassembling into exactly these rows.
import type { Entity, Store } from "../db/store.js";
import { listRoles, resolveRole, type RoleKind } from "./roles.js";
import { officeEmployees, type OfficeEmployee } from "./orchestrator.js";

/** Statuses the engine will not move on its own. Anything else means work is in flight. */
const SETTLED = ["completed", "failed", "cancelled"];
const SUMMARY_CHARS = 180;

export interface LogEntry {
  /** The task id, so the UI can key rows and open one. */
  id: string;
  at: string;
  sessionId: string;
  who: string;
  title: string;
  roleKind: RoleKind;
  label: string;
  summary: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null
  durationMs: number | null;
  error: string | null;
  /** Set when this task is a node of an orchestration run or a subtask, so the UI can group it. */
  workflowId: string | null;
}

export interface LogPerson {
  sessionId: string;
  name: string;
  title: string;
  roleKind: RoleKind;
  managerId: string | null;
  /** Their manager's name, resolved here so the UI does not need a second lookup. */
  managerName: string | null;
  team: string;
  activeTasks: number;
  totalTasks: number;
  /** One line: what this person is doing right now, or when they last finished something. */
  doing: string;
  /** Whether the operator may message them directly. False for interns, who answer to an engineer. */
  talkable: boolean;
}

export interface StreamLog {
  officeProjectId: string | null;
  staff: LogPerson[];
  entries: LogEntry[];
  /** Total tasks across the stream, so a clipped feed can say what it clipped. */
  total: number;
}

/** First meaningful line of a prompt, clipped. An orchestrated brief runs to hundreds of lines. */
function summarise(prompt: unknown): string {
  const text = typeof prompt === "string" ? prompt : "";
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? "";
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line;
}

function millis(task: Entity): number | null {
  const started = task.startedAt as string | null;
  const finished = task.completedAt as string | null;
  if (!started || !finished) return null;
  const ms = Date.parse(finished) - Date.parse(started);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** What to say under a name when nothing is running. */
function idleLine(latest: Entity | undefined): string {
  if (!latest) return "no work yet";
  const status = latest.status as string;
  const label = (latest.title as string) || "a task";
  if (status === "failed") return `failed: ${label}`;
  if (status === "cancelled") return `stopped: ${label}`;
  return `idle — last finished ${label}`;
}

function doingLine(tasks: Entity[]): string {
  // Newest first, so the first unsettled task is the one they are on.
  const running = tasks.find((task) => !SETTLED.includes(task.status as string));
  if (!running) return idleLine(tasks[0]);
  const label = (running.title as string) || "a task";
  const status = running.status as string;
  if (status === "awaiting_approval") return `waiting for you to approve ${label}`;
  if (status === "running") return `working on ${label}`;
  return `queued: ${label}`;
}

export interface StreamLogInput {
  projectId: string;
  buildingId: string;
  /** Omit to read the whole building rather than one stream. */
  officeProjectId?: string;
  limit: number;
}

/**
 * Who is on a stream, what each is doing, and the stream's task history newest first.
 *
 * Interns are included. They are not people the operator can address — `talkable` is false and
 * the messages route refuses them — but leaving them out would mean an engineer's work silently
 * splitting into a second pair of hands that the log never mentions.
 */
export function streamLog(store: Store, input: StreamLogInput): StreamLog {
  const roles = listRoles(store, input.projectId);
  const everyone = officeEmployees(store, input.projectId, input.buildingId);
  const staff: OfficeEmployee[] = input.officeProjectId
    ? everyone.filter((person) => person.officeProjectId === input.officeProjectId)
    : everyone;
  const names = new Map(everyone.map((person) => [person.sessionId, person.name]));

  const entries: LogEntry[] = [];
  const people: LogPerson[] = [];
  for (const person of staff) {
    const kind = resolveRole(roles, person.title).kind;
    // Newest first per person, which is also what `doing` reads.
    const tasks = store
      .list("tasks", { sessionId: person.sessionId })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    people.push({
      sessionId: person.sessionId,
      name: person.name,
      title: person.title,
      roleKind: kind,
      managerId: person.managerId,
      managerName: person.managerId ? names.get(person.managerId) ?? null : null,
      team: person.team,
      activeTasks: person.activeTasks,
      totalTasks: person.totalTasks,
      doing: doingLine(tasks),
      talkable: kind !== "intern",
    });
    for (const task of tasks)
      entries.push({
        id: task.id as string,
        at: (task.createdAt as string) ?? "",
        sessionId: person.sessionId,
        who: person.name,
        title: person.title,
        roleKind: kind,
        label: (task.title as string) || "Task",
        summary: summarise(task.prompt),
        status: (task.status as string) ?? "queued",
        startedAt: (task.startedAt as string | null) ?? null,
        completedAt: (task.completedAt as string | null) ?? null,
        durationMs: millis(task),
        error: (task.error as string | null) ?? null,
        workflowId: (task.workflowId as string | null) ?? null,
      });
  }
  entries.sort((left, right) => right.at.localeCompare(left.at) || left.who.localeCompare(right.who));
  // Seniority first so the roster reads top-down: whoever plans, then leads, then engineers,
  // then each engineer's interns.
  const rank: Record<RoleKind, number> = { manage: 0, lead: 1, build: 2, intern: 3 };
  people.sort((left, right) => rank[left.roleKind] - rank[right.roleKind] || left.name.localeCompare(right.name));
  return {
    officeProjectId: input.officeProjectId ?? null,
    staff: people,
    entries: entries.slice(0, input.limit),
    total: entries.length,
  };
}

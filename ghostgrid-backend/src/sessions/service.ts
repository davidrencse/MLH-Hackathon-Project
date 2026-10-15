import type { Store, Entity } from "../db/store.js";
import type { Engine } from "../execution/engine.js";
import { redact } from "../security/index.js";
import { composeBrief, type OfficeTitle } from "../office/brief.js";
import { findRole, juniorRole, listRoles } from "../office/roles.js";

const busy = new Set(["pending", "queued", "running", "awaiting_approval"]);
const error = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

export interface OrgPatch {
  title?: OfficeTitle;
  team?: string;
  managerId?: string | null;
  officeProjectId?: string | null;
  briefNotes?: string;
  name?: string;
}

const DEFAULT_TEAM = "HQ";

/** Each building (agent configuration) owns independent persistent conversations. */
export class SessionService {
  constructor(
    private store: Store,
    private engine: Engine,
  ) {}
  create(
    input: {
      projectId: string;
      agentId: string;
      name?: string;
    } & OrgPatch,
  ) {
    const agent = this.store.get("agents", input.agentId);
    if (!agent) throw error("Agent not found", 404);
    if (agent.projectId !== input.projectId)
      throw error("Session project must match its agent project");
    const { session, event } = this.store.transaction(() => {
      const org = this.org(input.agentId, undefined, input);
      const session = this.store.insert("sessions", {
        projectId: input.projectId,
        agentId: input.agentId,
        name: this.name(input.name ?? "New session"),
        status: "active",
        messages: [],
        memory: "",
        providerSessionId: null,
        ...org,
      });
      const event = this.store.event(
        "session.created",
        null,
        { id: session.id },
        {
          sessionId: session.id,
          agentId: session.agentId,
          projectId: session.projectId,
        },
      );
      return { session, event };
    });
    this.engine.publishEvent(event);
    return { ...session, buildingId: agent.buildingId ?? agent.id };
  }
  list(agentId?: string) {
    if (agentId && !this.store.get("agents", agentId))
      throw error("Agent not found", 404);
    return this.describeMany(this.store.list("sessions", { agentId }));
  }
  describeMany(sessions: Entity[]): (Entity & {
    buildingId: string;
    taskCount: number;
    activeTaskCount: number;
    taskCounts: Record<string, number>;
  })[] {
    if (!sessions.length) return [];
    const counts = this.store.taskCountsBySession(
      sessions.map((session) => session.id),
    );
    const buildingIds = new Map(
      sessions
        .map((session) => session.agentId)
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .map((id) => [id, this.store.get("agents", id)?.buildingId ?? id]),
    );
    return sessions.map((session) => ({
      ...this.describe(session, counts.get(session.id) ?? {}),
      buildingId: buildingIds.get(session.agentId),
    }));
  }
  get(id: string) {
    const session = this.store.get("sessions", id);
    if (!session) throw error("Session not found", 404);
    return this.describeMany([session])[0]!;
  }
  update(
    id: string,
    patch: {
      name?: string;
      status?: "active" | "archived";
      memory?: string;
    } & OrgPatch,
  ) {
    return this.change(id, patch);
  }
  private change(
    id: string,
    patch: {
      name?: string;
      status?: "active" | "archived";
      memory?: string;
    } & OrgPatch,
    eventType?: string,
  ) {
    const session = this.get(id);
    if (
      patch.status !== undefined &&
      !["active", "archived"].includes(patch.status)
    )
      throw error("Invalid session status");
    if (patch.status === "archived" && session.activeTaskCount)
      throw error(
        "Cancel or finish active tasks before archiving a session",
        409,
      );
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = this.name(patch.name);
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.memory !== undefined) {
      if (typeof patch.memory !== "string" || patch.memory.length > 16_000)
        throw error("Session memory must contain at most 16000 characters");
      if (session.activeTaskCount)
        throw error("Finish or cancel active tasks before changing session memory", 409);
      updates.memory = redact(patch.memory);
    }
    // Any org change rebuilds the brief, so the stored brief can never drift from the chart.
    if (
      patch.title !== undefined ||
      patch.team !== undefined ||
      patch.managerId !== undefined ||
      patch.officeProjectId !== undefined ||
      patch.briefNotes !== undefined ||
      patch.name !== undefined
    )
      Object.assign(
        updates,
        this.org(session.agentId, id, {
          ...patch,
          name: (updates.name as string) ?? session.name,
        }),
      );
    const event = this.store.transaction(() => {
      this.store.update("sessions", id, updates);
      return this.store.event(
        eventType ??
          (patch.status === "archived"
            ? "session.archived"
            : "session.updated"),
        null,
        { id, ...updates },
        {
          sessionId: id,
          agentId: session.agentId,
          projectId: session.projectId,
        },
      );
    });
    this.engine.publishEvent(event);
    return this.get(id);
  }
  resume(id: string) {
    const session = this.change(id, { status: "active" }, "session.resumed");
    // Providers reconnect/resume at task execution, never during a metadata operation.
    return { ...session, resumePending: true };
  }
  cancel(id: string) {
    this.get(id);
    const tasks = this.store
      .list("tasks", { sessionId: id })
      .filter((task) => busy.has(task.status));
    for (const task of tasks) this.engine.cancelTask(task.id);
    return { ...this.get(id), cancelledTaskIds: tasks.map((task) => task.id) };
  }
  /**
   * Resolve one employee's org fields and recompose their brief.
   *
   * `id` is the session being written (undefined while creating). Everything the brief needs
   * is read here rather than trusted from the caller: the manager must be another employee of
   * the same building, and the project must exist on the project record.
   */
  private org(
    agentId: string,
    id: string | undefined,
    patch: OrgPatch,
  ): Record<string, unknown> {
    const current = id ? this.store.get("sessions", id) : undefined;
    const agent = this.store.get("agents", agentId);
    if (!agent) throw error("Agent not found", 404);
    const pick = <T>(next: T | undefined, previous: T, fallback: T): T =>
      next !== undefined ? next : (previous ?? fallback);

    // The job comes from the project's own role list (office/roles.ts), so a role the operator
    // invented is as valid as one of the three the office ships with.
    const roles = listRoles(this.store, agent.projectId as string);
    const wanted = pick(patch.title, current?.title as OfficeTitle, "");
    const role = wanted ? findRole(roles, wanted) : juniorRole(roles);
    if (!role)
      throw error(
        `Unknown office role "${wanted}". Define it in the office's roles first.`,
      );
    // Stored as the role's own spelling, so a desk and its brief always read the same title.
    const title = role.name;
    const team = (pick(patch.team, current?.team as string, DEFAULT_TEAM) || DEFAULT_TEAM).trim();
    const employeeName = this.name(patch.name ?? current?.name ?? "New session");
    const briefNotes = pick(patch.briefNotes, current?.briefNotes as string, "");

    const managerIdRaw = pick(patch.managerId, current?.managerId as string | null, null);
    const managerId = managerIdRaw || null;
    let manager: { name: string; title: OfficeTitle } | undefined;
    if (managerId) {
      if (managerId === id) throw error("An employee cannot report to themselves");
      const record = this.store.get("sessions", managerId);
      if (!record) throw error("Manager not found", 404);
      if (record.agentId !== agentId)
        throw error("A manager must work in the same building");
      // Walk up the chain so a reassignment cannot create a reporting loop.
      for (let step = record, hops = 0; step?.managerId; hops++) {
        if (hops > 50) throw error("Reporting chain is too deep");
        if (step.managerId === id) throw error("That reassignment would create a reporting loop");
        step = this.store.get("sessions", step.managerId as string) as Entity;
        if (!step) break;
      }
      manager = { name: record.name ?? "Manager", title: (record.title as OfficeTitle) ?? "Manager" };
    }

    const projectIdRaw = pick(patch.officeProjectId, current?.officeProjectId as string | null, null);
    const officeProjectId = projectIdRaw || null;
    let project: { name: string; goal?: string } | undefined;
    if (officeProjectId) {
      const owner = this.store.get("projects", agent.projectId);
      const found = (owner?.officeProjects as { id: string; name: string; goal?: string }[] | undefined)
        ?.find((entry) => entry.id === officeProjectId);
      if (!found) throw error("Unknown office project", 404);
      project = { name: found.name, goal: found.goal };
    }

    const reports = id
      ? this.store
          .list("sessions", { agentId })
          .filter((row) => row.managerId === id && row.status !== "archived")
          .map((row) => ({ name: row.name as string, title: (row.title as OfficeTitle) ?? "Engineer" }))
      : [];

    const provider = this.store.get("providers", agent.providerId);
    const brief = composeBrief({
      employeeName,
      role,
      team,
      buildingName: (agent.buildingId as string) ?? (agent.name as string),
      providerType: provider?.type as string | undefined,
      manager,
      reports,
      project,
      workspace: agent.workspace as string | undefined,
      permissions: agent.permissions as ("read" | "write")[] | undefined,
      notes: briefNotes,
    });
    return { title, team, managerId, officeProjectId, briefNotes, brief: redact(brief) };
  }
  private name(value: string) {
    const name = value.trim();
    if (!name || name.length > 160)
      throw error("Session name must contain between 1 and 160 characters");
    return redact(name);
  }
  private describe(
    session: Entity,
    taskCounts: Record<string, number>,
  ): Entity & {
    taskCount: number;
    activeTaskCount: number;
    taskCounts: Record<string, number>;
  } {
    return {
      ...session,
      name: session.name ?? "New session",
      status: session.status ?? "active",
      memory: session.memory ?? "",
      title: (session.title as OfficeTitle) ?? "Engineer",
      team: (session.team as string) ?? DEFAULT_TEAM,
      managerId: (session.managerId as string | null) ?? null,
      officeProjectId: (session.officeProjectId as string | null) ?? null,
      briefNotes: (session.briefNotes as string) ?? "",
      brief: (session.brief as string) ?? "",
      taskCount: Object.values(taskCounts).reduce(
        (total, count) => total + count,
        0,
      ),
      activeTaskCount: Object.entries(taskCounts).reduce(
        (total, [status, count]) => total + (busy.has(status) ? count : 0),
        0,
      ),
      taskCounts,
    };
  }
}

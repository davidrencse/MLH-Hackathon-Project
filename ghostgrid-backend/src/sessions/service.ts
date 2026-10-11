import type { Store, Entity } from "../db/store.js";
import type { Engine } from "../execution/engine.js";
import { redact } from "../security/index.js";

const busy = new Set(["pending", "queued", "running", "awaiting_approval"]);
const error = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

/** Each building (agent configuration) owns independent persistent conversations. */
export class SessionService {
  constructor(
    private store: Store,
    private engine: Engine,
  ) {}
  create(input: { projectId: string; agentId: string; name?: string }) {
    const agent = this.store.get("agents", input.agentId);
    if (!agent) throw error("Agent not found", 404);
    if (agent.projectId !== input.projectId)
      throw error("Session project must match its agent project");
    const { session, event } = this.store.transaction(() => {
      const session = this.store.insert("sessions", {
        projectId: input.projectId,
        agentId: input.agentId,
        name: this.name(input.name ?? "New session"),
        status: "active",
        messages: [],
        memory: "",
        providerSessionId: null,
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
  update(id: string, patch: { name?: string; status?: "active" | "archived"; memory?: string }) {
    return this.change(id, patch);
  }
  private change(
    id: string,
    patch: { name?: string; status?: "active" | "archived"; memory?: string },
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

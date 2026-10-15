import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/db/store.js";
import { Engine } from "../src/execution/engine.js";
import { SessionService } from "../src/sessions/service.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ghostgrid-session-"));
  const store = new Store(":memory:");
  for (const id of ["p", "other"]) store.insert("projects", { id, name: id });
  store.insert("providers", { id: "provider", type: "mock", concurrency: 2 });
  for (const id of ["a", "b"])
    store.insert("agents", {
      id,
      projectId: "p",
      providerId: "provider",
      permissions: [],
    });
  const engine = new Engine(
    store,
    {
      get: () => ({
        // The engine prepends the session's role brief to every prompt, so the operator's own
        // text is the last paragraph. Read it back out: a native session id derived from the
        // whole prompt would carry the ~2KB brief and trip the engine's 1024-character guard.
        executeTask: async (input: any) => {
          const prompt = String(input.prompt).split("\n\n").pop();
          return { output: prompt, sessionId: input.sessionId ?? `native-${prompt}` };
        },
      }),
    },
    { concurrency: 2, artifactsDir: dir, allowedWorkspaces: [] },
  );
  const sessions = new SessionService(store, engine);
  return {
    store,
    engine,
    sessions,
    cleanup: async () => {
      await engine.stop();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Task did not complete");
}

describe("building session manager", () => {
  it("validates persistent notes and prevents changing them during active work", async () => {
    const f = await fixture();
    try {
      const session = f.sessions.create({ projectId: "p", agentId: "a" });
      expect(f.sessions.update(session.id, { memory: "Keep the current API contract" }).memory).toBe("Keep the current API contract");
      expect(() => f.sessions.update(session.id, { memory: "x".repeat(16001) })).toThrow("16000");
      const task = f.engine.submitTask({ projectId: "p", agentId: "a", sessionId: session.id, prompt: "Work" });
      expect(() => f.sessions.update(session.id, { memory: "Changed" })).toThrow("active tasks");
      f.engine.cancelTask(task.id);
      expect(f.sessions.update(session.id, { memory: "" }).memory).toBe("");
    } finally { await f.cleanup(); }
  });
  it("streams committed lifecycle events and rolls back metadata if auditing fails", async () => {
    const f = await fixture();
    try {
      const observed: any[] = [];
      f.engine.emitter.on("event", (event) => {
        observed.push({
          ...event,
          persistedSession: f.store.get("sessions", event.sessionId),
        });
      });
      const session = f.sessions.create({
        projectId: "p",
        agentId: "a",
        name: "Original",
      });
      f.sessions.update(session.id, { name: "Renamed" });
      f.sessions.update(session.id, { status: "archived" });
      f.sessions.resume(session.id);
      expect(observed.map((event) => event.type)).toEqual([
        "session.created",
        "session.updated",
        "session.archived",
        "session.resumed",
      ]);
      expect(observed[1].persistedSession.name).toBe("Renamed");
      expect(observed[2].persistedSession.status).toBe("archived");
      expect(observed[3].persistedSession.status).toBe("active");
      const audit = vi.spyOn(f.store, "event").mockImplementation(() => {
        throw new Error("Audit unavailable");
      });
      expect(() =>
        f.sessions.update(session.id, { name: "Not persisted" }),
      ).toThrow("Audit unavailable");
      expect(f.sessions.get(session.id).name).toBe("Renamed");
      expect(() => f.sessions.create({ projectId: "p", agentId: "a" })).toThrow(
        "Audit unavailable",
      );
      expect(f.sessions.list("a")).toHaveLength(1);
      expect(observed).toHaveLength(4);
      audit.mockRestore();
    } finally {
      await f.cleanup();
    }
  });
  it("lists summaries with one aggregate query and emits scoped creation events", async () => {
    const f = await fixture();
    try {
      const first = f.sessions.create({ projectId: "p", agentId: "a" });
      expect(first.buildingId).toBe("a");
      f.sessions.create({ projectId: "p", agentId: "a" });
      const task = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: first.id,
        title: "Queued",
        prompt: "queued",
      });
      const list = vi.spyOn(f.store, "list");
      const counts = vi.spyOn(f.store, "taskCountsBySession");
      const summaries = f.sessions.list("a");
      expect(
        list.mock.calls.filter(([table]) => table === "tasks"),
      ).toHaveLength(0);
      expect(counts).toHaveBeenCalledOnce();
      expect(counts).toHaveBeenCalledWith(expect.arrayContaining([first.id]));
      expect(summaries[0]).toMatchObject({
        taskCount: 1,
        activeTaskCount: 1,
        taskCounts: { queued: 1 },
      });
      expect(summaries[1]).toMatchObject({ taskCount: 0, activeTaskCount: 0 });
      f.store.update("agents", "a", { buildingId: "codex-tower" });
      expect(f.sessions.get(first.id).buildingId).toBe("codex-tower");
      expect(f.store.get("sessions", first.id)?.buildingId).toBeUndefined();
      expect(
        f.store.events().find((event) => event.type === "session.created"),
      ).toMatchObject({
        sessionId: first.id,
        agentId: "a",
        projectId: "p",
        data: { id: first.id },
      });
      expect(f.store.get("tasks", task.id)?.sessionId).toBe(first.id);
      expect(() =>
        f.sessions.update(first.id, { name: "x".repeat(161) }),
      ).toThrow("160");
      list.mockRestore();
      counts.mockRestore();
    } finally {
      await f.cleanup();
    }
  });
  it("enforces agent ownership and keeps independent conversations", async () => {
    const f = await fixture();
    try {
      expect(() =>
        f.sessions.create({ projectId: "other", agentId: "a" }),
      ).toThrow("project");
      const first = f.sessions.create({
        projectId: "p",
        agentId: "a",
        name: "Implementation",
      });
      const second = f.sessions.create({
        projectId: "p",
        agentId: "a",
        name: "Research",
      });
      expect(first.id).not.toBe(second.id);
      expect(() =>
        f.engine.submitTask({
          projectId: "p",
          agentId: "b",
          sessionId: first.id,
          title: "Wrong",
          prompt: "wrong",
        }),
      ).toThrow("belong");
      const one = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: first.id,
        title: "One",
        prompt: "alpha",
      });
      const two = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: second.id,
        title: "Two",
        prompt: "beta",
      });
      f.engine.start();
      await until(() =>
        [one, two].every(
          (task) => f.store.get("tasks", task.id)?.status === "completed",
        ),
      );
      expect(f.sessions.get(first.id).messages).toEqual([
        { role: "user", content: "alpha" },
        { role: "assistant", content: "alpha" },
      ]);
      expect(f.sessions.get(second.id).messages).toEqual([
        { role: "user", content: "beta" },
        { role: "assistant", content: "beta" },
      ]);
      expect(f.sessions.get(first.id).providerSessionId).toBe("native-alpha");
      expect(f.sessions.list("a")).toHaveLength(2);
      expect(f.sessions.list("b")).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
  it("renames, archives idle sessions, and resumes on the next task", async () => {
    const f = await fixture();
    try {
      const session = f.sessions.create({ projectId: "p", agentId: "a" });
      expect(f.sessions.update(session.id, { name: "Review" }).name).toBe(
        "Review",
      );
      expect(() => f.sessions.update(session.id, { name: " " })).toThrow(
        "name",
      );
      const queued = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: session.id,
        title: "Queued",
        prompt: "queued",
      });
      expect(() =>
        f.sessions.update(session.id, { status: "archived" }),
      ).toThrow("active tasks");
      expect(f.sessions.get(session.id).taskCounts.queued).toBe(1);
      f.engine.cancelTask(queued.id);
      expect(f.sessions.update(session.id, { status: "archived" }).status).toBe(
        "archived",
      );
      expect(() =>
        f.engine.submitTask({
          projectId: "p",
          agentId: "a",
          sessionId: session.id,
          title: "No",
          prompt: "no",
        }),
      ).toThrow("Resume");
      expect(f.sessions.resume(session.id)).toMatchObject({
        status: "active",
        resumePending: true,
        providerSessionId: null,
      });
      expect(f.sessions.get(session.id).taskCount).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
  it("cancels only tasks belonging to the selected session", async () => {
    const f = await fixture();
    try {
      const first = f.sessions.create({ projectId: "p", agentId: "a" });
      const second = f.sessions.create({ projectId: "p", agentId: "a" });
      const one = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: first.id,
        title: "One",
        prompt: "one",
      });
      const two = f.engine.submitTask({
        projectId: "p",
        agentId: "a",
        sessionId: second.id,
        title: "Two",
        prompt: "two",
      });
      expect(f.sessions.cancel(first.id).cancelledTaskIds).toEqual([one.id]);
      expect(f.store.get("tasks", one.id)?.status).toBe("cancelled");
      expect(f.store.get("tasks", two.id)?.status).toBe("queued");
      expect(f.sessions.get(first.id).status).toBe("active");
    } finally {
      await f.cleanup();
    }
  });
});

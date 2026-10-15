import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/db/store.js";
import { Engine } from "../src/execution/engine.js";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const git = promisify(execFile);

describe("execution engine", () => {
  async function setup(
    executeTask: any = async (input: any) => ({ output: input.prompt }),
    defaults: { taskTimeoutMs?: number; maxRetries?: number } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), "ghostgrid-engine-"));
    const store = new Store(":memory:");
    store.insert("projects", { id: "project", name: "Demo" });
    store.insert("providers", { id: "provider", type: "mock", concurrency: 2 });
    store.insert("agents", {
      id: "agent",
      projectId: "project",
      providerId: "provider",
      permissions: [],
    });
    const engine = new Engine(
      store,
      { get: () => ({ executeTask }) },
      { artifactsDir: dir, allowedWorkspaces: [], concurrency: 2, ...defaults },
    );
    return {
      engine,
      store,
      artifactsDir: dir,
      cleanup: async () => {
        await engine.stop();
        store.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  async function waitFor(fn: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Execution did not settle");
  }
  it("persists task output, events and artifacts", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      engine.start();
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
        title: "Demo",
      });
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      expect(store.get("tasks", task.id)?.result).toBe("hello");
      expect(store.events(0, task.id).map((x) => x.type)).toContain(
        "task.completed",
      );
      expect(store.list("artifacts")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
  it("announces automatically created sessions and gives every task a title", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      expect(task.title).toBe("Task");
      const created = store
        .events()
        .find((event) => event.type === "session.created");
      expect(created).toMatchObject({
        taskId: null,
        sessionId: task.sessionId,
        agentId: "agent",
        projectId: "project",
        data: { id: task.sessionId },
      });
      engine.submitTask({
        projectId: "project",
        agentId: "agent",
        sessionId: task.sessionId,
        prompt: "again",
      });
      expect(
        store.events().filter((event) => event.type === "session.created"),
      ).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
  it("publishes automatic sessions only after workflow commit and isolates broken listeners", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      const observed: any[] = [];
      engine.emitter.on("event", () => {
        throw new Error("Disconnected observer");
      });
      engine.emitter.on("event", (event) => observed.push(event));
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Atomic",
        nodes: [
          { key: "plan", agentId: "agent", prompt: "Plan" },
          {
            key: "review",
            agentId: "agent",
            prompt: "Review",
            dependsOn: ["plan"],
          },
        ],
      });
      const insert = store.insert.bind(store);
      const failing = vi
        .spyOn(store, "insert")
        .mockImplementation((table, row) => {
          if (table === "task_dependencies")
            throw new Error("Dependency audit unavailable");
          return insert(table, row);
        });
      expect(() => engine.runWorkflow(workflow.id)).toThrow(
        "Dependency audit unavailable",
      );
      expect(observed).toEqual([]);
      expect(store.list("sessions")).toHaveLength(0);
      expect(store.list("tasks")).toHaveLength(0);
      failing.mockRestore();
      const observedStates: string[] = [];
      engine.emitter.on("event", () =>
        observedStates.push(store.get("workflows", workflow.id)?.status),
      );
      engine.runWorkflow(workflow.id);
      expect(observedStates).toEqual(Array(6).fill("running"));
      expect(
        observed.filter((event) => event.type === "session.created"),
      ).toHaveLength(2);
      expect(
        observed.filter((event) => event.type === "task.created"),
      ).toHaveLength(2);
      engine.start();
      await waitFor(
        () => store.get("workflows", workflow.id)?.status === "completed",
      );
    } finally {
      await cleanup();
    }
  });
  it("removes output files when artifact metadata cannot be persisted", async () => {
    const { engine, store, artifactsDir, cleanup } = await setup();
    const insert = store.insert.bind(store);
    const spy = vi.spyOn(store, "insert").mockImplementation((table, row) => {
      if (table === "artifacts") throw new Error("artifact persistence failed");
      return insert(table, row);
    });
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      await engine.stop();
      expect(await readdir(artifactsDir)).toEqual([]);
      expect(store.list("artifacts")).toHaveLength(0);
      expect(store.list("usage_records")).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await cleanup();
    }
  });
  it("rolls back artifact metadata and removes files when terminal persistence fails", async () => {
    const { engine, store, artifactsDir, cleanup } = await setup();
    const update = store.update.bind(store);
    const spy = vi
      .spyOn(store, "update")
      .mockImplementation((table, id, patch) => {
        if (table === "tasks" && patch.status === "completed")
          throw new Error("terminal persistence failed");
        return update(table, id, patch);
      });
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      await engine.stop();
      expect(store.list("artifacts")).toHaveLength(0);
      expect(await readdir(artifactsDir)).toEqual([]);
      expect(store.list("usage_records")).toHaveLength(1);
      expect(
        store
          .events(0, task.id)
          .some((event) => event.type === "task.completed"),
      ).toBe(false);
    } finally {
      spy.mockRestore();
      await cleanup();
    }
  });
  it.each([
    null,
    {},
    { output: { untrusted: "object" } },
    { output: "ok", sessionId: 123 },
    { output: "ok", sessionId: "" },
  ])(
    "rejects malformed provider results before persisting conversation history: %j",
    async (result) => {
      const { engine, store, cleanup } = await setup(async () => result);
      try {
        const task = engine.submitTask({
          projectId: "project",
          agentId: "agent",
          prompt: "hello",
        });
        engine.start();
        await waitFor(() => store.get("tasks", task.id)?.status === "failed");
        expect(store.get("sessions", task.sessionId)?.messages).toEqual([]);
        expect(store.list("artifacts")).toHaveLength(0);
        expect(store.list("usage_records")).toHaveLength(0);
      } finally {
        await cleanup();
      }
    },
  );
  it.each([
    "task.completed",
    "session.archived",
    "agent.BAD",
    "agent.output.invalid!",
  ])(
    "prevents providers from forging backend lifecycle events: %s",
    async (eventType) => {
      const { engine, store, cleanup } = await setup(
        async (_input: any, emit: any) => {
          emit(eventType, { result: "forged" });
          return { output: "hello" };
        },
      );
      try {
        const task = engine.submitTask({
          projectId: "project",
          agentId: "agent",
          prompt: "hello",
        });
        engine.start();
        await waitFor(() => store.get("tasks", task.id)?.status === "failed");
        expect(
          store.events(0, task.id).some((event) => event.type === eventType),
        ).toBe(false);
        expect(store.get("tasks", task.id)?.error.message).toContain(
          "invalid agent event",
        );
      } finally {
        await cleanup();
      }
    },
  );
  it("bounds cumulative streamed output before durable storage", async () => {
    const { engine, store, cleanup } = await setup(
      async (_input: any, emit: any) => {
        emit("agent.output", { text: "a".repeat(4_000_000) });
        emit("agent.output", { text: "b".repeat(4_000_001) });
        return { output: "hello" };
      },
    );
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      expect(
        store
          .events(0, task.id)
          .filter((event) => event.type === "agent.output"),
      ).toHaveLength(1);
      expect(store.get("tasks", task.id)?.error.message).toContain(
        "streamed output exceeds",
      );
    } finally {
      await cleanup();
    }
  });
  it("does not write an artifact after usage observers cancel the task", async () => {
    const { engine, store, artifactsDir, cleanup } = await setup();
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      engine.emitter.on("event", (event) => {
        if (event.type === "usage.updated" && event.taskId === task.id)
          engine.cancelTask(task.id);
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "cancelled");
      await engine.stop();
      expect(await readdir(artifactsDir)).toEqual([]);
      expect(store.list("artifacts")).toHaveLength(0);
      expect(store.list("usage_records")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
  it("passes dependency outputs through a workflow", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Plan and review",
        nodes: [
          { key: "plan", agentId: "agent", prompt: "specification" },
          {
            key: "review",
            agentId: "agent",
            prompt: "review",
            dependsOn: ["plan"],
          },
        ],
      });
      engine.runWorkflow(workflow.id);
      engine.start();
      await waitFor(
        () => store.get("workflows", workflow.id)?.status === "completed",
      );
      const review = store.list("tasks").find((x) => x.title === "review");
      expect(review?.result).toContain("specification");
    } finally {
      await cleanup();
    }
  });
  it("keeps a session's stored history bounded as turns accumulate", async () => {
    // A session's whole history lives in one JSON column that is rewritten every turn, and an
    // adapter may return up to 8,000,000 characters per reply, so an uncapped history makes the
    // row grow without limit and the rewrites quadratic. The newest turn always survives.
    const reply = "x".repeat(600_000);
    const { engine, store, cleanup } = await setup(async () => ({ output: reply }));
    try {
      const session = store.insert("sessions", {
        projectId: "project",
        agentId: "agent",
        status: "active",
        messages: [{ role: "user", content: "oldest turn" }],
      });
      engine.start();
      for (let turn = 0; turn < 3; turn++) {
        const task = engine.submitTask({
          projectId: "project",
          agentId: "agent",
          sessionId: session.id,
          prompt: `turn ${turn}`,
        });
        await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      }
      const messages = store.get("sessions", session.id)!.messages as {
        role: string;
        content: string;
      }[];
      const characters = messages.reduce((total, m) => total + m.content.length, 0);
      expect(characters).toBeLessThanOrEqual(1_000_000);
      expect(messages.length).toBeLessThanOrEqual(200);
      // The last exchange is intact and the first turn has aged out.
      expect(messages.at(-2)).toEqual({ role: "user", content: "turn 2" });
      expect(messages.at(-1)).toEqual({ role: "assistant", content: reply });
      expect(messages.some((m) => m.content === "oldest turn")).toBe(false);
    } finally {
      await cleanup();
    }
  });
  it("preserves explicit workflow sessions, context and execution controls", async () => {
    let received: any;
    const { engine, store, cleanup } = await setup(async (input: any) => {
      received = input;
      return { output: "review complete" };
    });
    try {
      const session = store.insert("sessions", {
        projectId: "project",
        agentId: "agent",
        status: "active",
        messages: [{ role: "user", content: "earlier conversation" }],
      });
      const context = store.insert("context_entries", {
        projectId: "project",
        content: "saved library notes",
      });
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Context review",
        nodes: [
          {
            key: "review",
            agentId: "agent",
            prompt: "Review",
            sessionId: session.id,
            contextIds: [context.id],
            priority: 7,
            timeoutMs: 2000,
            maxRetries: 1,
          },
        ],
      });
      engine.runWorkflow(workflow.id);
      const task = store.list("tasks", { workflowId: workflow.id })[0]!;
      expect(task).toMatchObject({
        sessionId: session.id,
        contextIds: [context.id],
        priority: 7,
        timeoutMs: 2000,
        maxRetries: 1,
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      expect(received.prompt).toContain("saved library notes");
      expect(received.messages).toContainEqual({
        role: "user",
        content: "earlier conversation",
      });
      store.update("sessions", session.id, { status: "archived" });
      expect(() =>
        engine.createWorkflow({
          projectId: "project",
          name: "Invalid",
          nodes: [
            {
              key: "review",
              agentId: "agent",
              prompt: "Review",
              sessionId: session.id,
            },
          ],
        }),
      ).toThrow("Resume the archived session");
      expect(() =>
        engine.createWorkflow({
          projectId: "project",
          name: "Invalid",
          nodes: [
            {
              key: "review",
              agentId: "agent",
              prompt: "Review",
              contextIds: ["missing"],
            },
          ],
        }),
      ).toThrow("Workflow context");
      expect(store.list("workflows")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
  it("passes the implementation workspace through consecutive read-only reviews", async () => {
    const received: Array<string | undefined> = [];
    const { engine, store, artifactsDir, cleanup } = await setup(
      async (input: any) => {
        received.push(input.workspace);
        return { output: "reviewed" };
      },
    );
    try {
      const implementation = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "implementation",
      });
      const workspace = join(artifactsDir, "workspaces", implementation.id);
      store.update("tasks", implementation.id, {
        status: "completed",
        result: "implemented",
        workspace,
      });
      const first = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "review",
        dependencies: [implementation.id],
      });
      const second = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "final review",
        dependencies: [first.id],
      });
      engine.start();
      await waitFor(
        () => store.get("tasks", second.id)?.status === "completed",
      );
      expect(received).toEqual([workspace, workspace]);
      expect(store.get("tasks", first.id)?.workspace).toBe(workspace);
      expect(store.get("tasks", second.id)?.workspace).toBe(workspace);
      // A review workspace belongs to the task; it must not become a coding
      // session workspace which could later authorize writes to another tree.
      expect(store.get("sessions", first.sessionId)?.workspace).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
  it("cancels a running task without completing it", async () => {
    const { engine, store, cleanup } = await setup(
      (input: any) =>
        new Promise((_resolve, reject) =>
          input.signal.addEventListener(
            "abort",
            () => reject(input.signal.reason),
            { once: true },
          ),
        ),
    );
    try {
      engine.start();
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "wait",
        title: "Wait",
      });
      await waitFor(() => store.get("tasks", task.id)?.status === "running");
      engine.cancelTask(task.id);
      expect(store.get("tasks", task.id)?.status).toBe("cancelled");
    } finally {
      await cleanup();
    }
  });
  it("does not dispatch a task cancelled by its started event", async () => {
    let calls = 0;
    const { engine, store, cleanup } = await setup(async () => {
      calls++;
      return { output: "must not run" };
    });
    try {
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "cancel before dispatch",
      });
      engine.emitter.on("event", (event) => {
        if (event.type === "task.started" && event.taskId === task.id)
          engine.cancelTask(task.id);
      });
      engine.start();
      await waitFor(() => store.get("tasks", task.id)?.status === "cancelled");
      await engine.stop();
      expect(calls).toBe(0);
      expect(store.list("artifacts")).toHaveLength(0);
      expect(store.list("usage_records")).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
  it("rechecks queued tasks after event listeners cancel scheduling snapshots", async () => {
    let calls = 0;
    const { engine, store, cleanup } = await setup(async () => {
      calls++;
      return { output: "must not run" };
    });
    try {
      const parent = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "cancelled dependency",
      });
      engine.cancelTask(parent.id);
      const dependent = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "dependent",
        priority: 10,
        dependencies: [parent.id],
      });
      const victim = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "cancelled in listener",
      });
      engine.emitter.on("event", (event) => {
        if (event.type === "task.failed" && event.taskId === dependent.id)
          engine.cancelTask(victim.id);
      });
      engine.start();
      await engine.stop();
      expect(store.get("tasks", victim.id)?.status).toBe("cancelled");
      expect(store.get("tasks", victim.id)?.attempts).toBe(0);
      expect(calls).toBe(0);
    } finally {
      await cleanup();
    }
  });
  it("rejects cyclic workflows and fails interrupted executions", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      expect(() =>
        engine.createWorkflow({
          projectId: "project",
          name: "Cycle",
          nodes: [
            { key: "a", agentId: "agent", prompt: "a", dependsOn: ["b"] },
            { key: "b", agentId: "agent", prompt: "b", dependsOn: ["a"] },
          ],
        }),
      ).toThrow("cycle");
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "wait",
        title: "Wait",
      });
      store.update("tasks", task.id, { status: "running" });
      engine.start();
      expect(store.get("tasks", task.id)?.error.code).toBe(
        "EXECUTION_INTERRUPTED",
      );
    } finally {
      await cleanup();
    }
  });
  it("rolls back terminal task and workflow changes when event persistence fails", async () => {
    const { engine, store, cleanup } = await setup();
    const persistEvent = store.event.bind(store);
    const persistUpdate = store.update.bind(store);
    try {
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Atomic finish",
        nodes: [{ key: "only", agentId: "agent", prompt: "hello" }],
      });
      engine.runWorkflow(workflow.id);
      const task = store.list("tasks", { workflowId: workflow.id })[0];
      const observed: string[] = [];
      engine.emitter.on("event", (event) => observed.push(event.type));
      store.event = (...args: Parameters<typeof store.event>) => {
        const event = persistEvent(...args);
        if (args[0] === "task.cancelled") throw new Error("event disk failure");
        return event;
      };
      expect(() => engine.cancelTask(task.id)).toThrow("event disk failure");
      expect(store.get("tasks", task.id)?.status).toBe("queued");
      expect(store.get("tasks", task.id)?.completedAt).toBeUndefined();
      expect(store.get("workflows", workflow.id)?.status).toBe("running");
      expect(store.events(0, task.id).map((event) => event.type)).not.toContain(
        "task.cancelled",
      );
      expect(observed).not.toContain("task.cancelled");
      store.event = persistEvent;
      store.update = (...args: Parameters<typeof store.update>) => {
        const row = persistUpdate(...args);
        if (args[0] === "workflows") throw new Error("workflow disk failure");
        return row;
      };
      expect(() => engine.cancelTask(task.id)).toThrow("workflow disk failure");
      expect(store.get("tasks", task.id)?.status).toBe("queued");
      expect(store.get("workflows", workflow.id)?.status).toBe("running");
      expect(store.events(0, task.id).map((event) => event.type)).not.toContain(
        "task.cancelled",
      );
      expect(observed).not.toContain("task.cancelled");
      store.update = persistUpdate;
      engine.cancelTask(task.id);
      expect(store.get("tasks", task.id)?.status).toBe("cancelled");
      expect(store.get("workflows", workflow.id)?.status).toBe("failed");
    } finally {
      store.event = persistEvent;
      store.update = persistUpdate;
      await cleanup();
    }
  });
  it("keeps running execution alive when cancellation persistence fails", async () => {
    let signal: AbortSignal | undefined;
    let complete!: (value: { output: string }) => void;
    const { engine, store, cleanup } = await setup(async (input: any) => {
      signal = input.signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const persistEvent = store.event.bind(store);
    try {
      engine.start();
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "hello",
      });
      await waitFor(() => !!signal);
      store.event = (...args: Parameters<typeof store.event>) => {
        if (args[0] === "task.cancelled") throw new Error("disk failure");
        return persistEvent(...args);
      };
      expect(() => engine.cancelTask(task.id)).toThrow("disk failure");
      expect(signal!.aborted).toBe(false);
      expect(store.get("tasks", task.id)?.status).toBe("running");
      store.event = persistEvent;
      complete({ output: "completed after failed cancellation" });
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
    } finally {
      store.event = persistEvent;
      complete?.({ output: "cleanup" });
      await cleanup();
    }
  });
  it("rolls back every workflow cancellation when the final write fails", async () => {
    const { engine, store, cleanup } = await setup();
    const persistUpdate = store.update.bind(store);
    try {
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Atomic cancel",
        nodes: [
          { key: "first", agentId: "agent", prompt: "one" },
          {
            key: "second",
            agentId: "agent",
            prompt: "two",
            dependencies: ["first"],
          },
        ],
      });
      engine.runWorkflow(workflow.id);
      const observed: string[] = [];
      engine.emitter.on("event", (event) => observed.push(event.type));
      store.update = (...args: Parameters<typeof store.update>) => {
        const row = persistUpdate(...args);
        if (args[0] === "workflows" && args[2].status === "cancelled")
          throw new Error("disk failure");
        return row;
      };
      expect(() => engine.cancelWorkflow(workflow.id)).toThrow("disk failure");
      expect(
        store
          .list("tasks", { workflowId: workflow.id })
          .every((task) => task.status === "queued"),
      ).toBe(true);
      expect(store.get("workflows", workflow.id)?.status).toBe("running");
      expect(observed).not.toContain("task.cancelled");
      store.update = persistUpdate;
      engine.cancelWorkflow(workflow.id);
      expect(
        store
          .list("tasks", { workflowId: workflow.id })
          .every((task) => task.status === "cancelled"),
      ).toBe(true);
      expect(store.get("workflows", workflow.id)?.status).toBe("cancelled");
    } finally {
      store.update = persistUpdate;
      await cleanup();
    }
  });
  it("reconciles terminal tasks into stale running workflows on startup", async () => {
    const { engine, store, cleanup } = await setup();
    try {
      const workflow = engine.createWorkflow({
        projectId: "project",
        name: "Interrupted summary",
        nodes: [{ key: "only", agentId: "agent", prompt: "hello" }],
      });
      engine.runWorkflow(workflow.id);
      const task = store.list("tasks", { workflowId: workflow.id })[0];
      store.update("tasks", task.id, {
        status: "completed",
        result: "persisted output",
      });
      engine.start();
      expect(store.get("workflows", workflow.id)?.status).toBe("completed");
      expect(store.get("workflows", workflow.id)?.result[0].result).toBe(
        "persisted output",
      );
      expect(store.get("tasks", task.id)?.attempts).toBe(0);
    } finally {
      await cleanup();
    }
  });
  it("times out abortable executions and retries only transient inference", async () => {
    let calls = 0;
    const { engine, store, cleanup } = await setup(async (input: any) => {
      calls++;
      if (input.prompt === "retry" && calls === 1)
        throw Object.assign(new Error("busy"), { transient: true });
      if (input.prompt === "retry") return { output: "success" };
      return new Promise((_resolve, reject) =>
        input.signal.addEventListener(
          "abort",
          () => reject(input.signal.reason),
          { once: true },
        ),
      );
    });
    try {
      engine.start();
      const retry = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Retry",
        prompt: "retry",
        maxRetries: 1,
      });
      await waitFor(() => store.get("tasks", retry.id)?.status === "completed");
      expect(store.get("tasks", retry.id)?.attempts).toBe(2);
      const timeout = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Timeout",
        prompt: "timeout",
        timeoutMs: 20,
      });
      await waitFor(() => store.get("tasks", timeout.id)?.status === "failed");
      expect(store.get("tasks", timeout.id)?.error.code).toBe("TASK_TIMEOUT");
    } finally {
      await cleanup();
    }
  });
  it("uses configured task defaults while honoring explicit overrides", async () => {
    const { engine, store, cleanup } = await setup(undefined, {
      taskTimeoutMs: 1234,
      maxRetries: 2,
    });
    try {
      const defaults = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "defaults",
      });
      expect(store.get("tasks", defaults.id)?.timeoutMs).toBe(1234);
      expect(store.get("tasks", defaults.id)?.maxRetries).toBe(2);
      const override = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "override",
        timeoutMs: 5678,
        maxRetries: 0,
      });
      expect(store.get("tasks", override.id)?.timeoutMs).toBe(5678);
      expect(store.get("tasks", override.id)?.maxRetries).toBe(0);
    } finally {
      await cleanup();
    }
  });
  it("runs independent tasks concurrently but serializes a shared session", async () => {
    let active = 0;
    let peak = 0;
    const { engine, store, cleanup } = await setup(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return { output: "done" };
    });
    try {
      engine.start();
      const a = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "A",
        prompt: "a",
      });
      const b = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "B",
        prompt: "b",
      });
      await waitFor(() =>
        [a, b].every((t) => store.get("tasks", t.id)?.status === "completed"),
      );
      expect(peak).toBe(2);
      peak = 0;
      const c = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        sessionId: a.sessionId,
        title: "C",
        prompt: "c",
      });
      const d = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        sessionId: a.sessionId,
        title: "D",
        prompt: "d",
      });
      await waitFor(() =>
        [c, d].every((t) => store.get("tasks", t.id)?.status === "completed"),
      );
      expect(peak).toBe(1);
    } finally {
      await cleanup();
    }
  });
  it("enforces provider limits and stops without dispatching queued work", async () => {
    const started: string[] = [];
    const { engine, store, cleanup } = await setup((input: any) => {
      started.push(input.taskId);
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => reject(input.signal.reason),
          { once: true },
        );
      });
    });
    try {
      store.update("providers", "provider", { concurrency: 1 });
      const first = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "active",
      });
      const queued = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        prompt: "queued",
      });
      engine.start();
      await waitFor(() => started.length === 1);
      expect(store.get("tasks", queued.id)?.status).toBe("queued");
      await engine.stop();
      expect(started).toEqual([first.id]);
      expect(store.get("tasks", first.id)?.status).toBe("failed");
      expect(store.get("tasks", queued.id)?.status).toBe("queued");
      expect(store.get("tasks", queued.id)?.attempts).toBe(0);
    } finally {
      await cleanup();
    }
  });
  it("redacts secrets before output, event and artifact persistence", async () => {
    process.env.GHOSTGRID_TEST_SECRET = "secret-value-123";
    const { engine, store, cleanup } = await setup(
      async (_input: any, emit: any) => {
        emit("agent.output", { text: "secret-value-123" });
        return { output: "secret-value-123" };
      },
    );
    try {
      engine.start();
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Redact",
        prompt: "hello",
      });
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      expect(store.get("tasks", task.id)?.result).toBe("[REDACTED]");
      expect(JSON.stringify(store.events())).not.toContain("secret-value-123");
    } finally {
      delete process.env.GHOSTGRID_TEST_SECRET;
      await cleanup();
    }
  });
  it("propagates failed dependencies and rejects missing context references", async () => {
    const { engine, store, cleanup } = await setup(async () => {
      throw new Error("provider unavailable");
    });
    try {
      expect(() =>
        engine.submitTask({
          projectId: "project",
          agentId: "agent",
          prompt: "bad",
          title: "Bad",
          contextIds: ["missing"],
        }),
      ).toThrow("Context");
      const parent = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Parent",
        prompt: "parent",
      });
      const child = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Child",
        prompt: "child",
        dependencies: [parent.id],
      });
      engine.start();
      await waitFor(() => store.get("tasks", child.id)?.status === "failed");
      expect(store.get("tasks", child.id)?.error.code).toBe(
        "DEPENDENCY_FAILED",
      );
      expect(store.get("tasks", child.id)?.attempts).toBe(0);
    } finally {
      await cleanup();
    }
  });
  it("estimates configured prices while keeping billed costs and missing usage unknown", async () => {
    const { engine, store, cleanup } = await setup(async (input: any) =>
      input.prompt === "known"
        ? { output: "done", usage: { inputTokens: 1000, outputTokens: 2000 } }
        : { output: "done" },
    );
    try {
      store.update("providers", "provider", {
        pricing: { inputPerMillion: 2, outputPerMillion: 4 },
      });
      engine.start();
      const known = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Known",
        prompt: "known",
      });
      const missing = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        title: "Missing",
        prompt: "missing",
      });
      await waitFor(() =>
        [known, missing].every(
          (t) => store.get("tasks", t.id)?.status === "completed",
        ),
      );
      const usage = store.get("tasks", known.id)?.usage;
      expect(usage.estimatedCostUsd).toBe(0.01);
      expect(usage.costUsd).toBeNull();
      expect(usage.costSource).toBe("estimated");
      expect(store.get("tasks", missing.id)?.usage).toEqual({
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        costUsd: null,
        estimatedCostUsd: null,
        costSource: "unknown",
        pricingSource: "provider",
      });
      expect(store.list("usage_records")).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });
  it("reuses a coding session worktree across turns without changing the original", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-git-"));
    const repository = join(root, "repository");
    await mkdir(repository);
    await git("git", ["init", repository]);
    await writeFile(join(repository, "file.txt"), "original");
    await git("git", ["-C", repository, "add", "."]);
    await git("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
    const store = new Store(":memory:");
    store.insert("projects", { id: "p", workspace: repository });
    store.insert("providers", { id: "provider", type: "codex" });
    store.insert("agents", {
      id: "agent",
      projectId: "p",
      providerId: "provider",
      permissions: ["read", "write"],
    });
    const received: string[] = [];
    const engine = new Engine(
      store,
      {
        get: () => ({
          executeTask: async (input: any) => {
            received.push(
              await readFile(join(input.workspace, "file.txt"), "utf8"),
            );
            await writeFile(join(input.workspace, "file.txt"), input.prompt);
            return { output: "done", sessionId: "native-session" };
          },
        }),
      },
      {
        artifactsDir: join(root, "artifacts"),
        allowedWorkspaces: [repository],
      },
    );
    try {
      engine.start();
      const first = engine.submitTask({
        projectId: "p",
        agentId: "agent",
        title: "First",
        prompt: "first change",
      });
      await waitFor(() => store.get("tasks", first.id)?.status === "completed");
      const second = engine.submitTask({
        projectId: "p",
        agentId: "agent",
        sessionId: first.sessionId,
        title: "Second",
        prompt: "second change",
      });
      await waitFor(
        () => store.get("tasks", second.id)?.status === "completed",
      );
      expect(received).toEqual(["original", "first change"]);
      expect(store.get("tasks", second.id)?.workspace).toBe(
        store.get("tasks", first.id)?.workspace,
      );
      expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(
        "original",
      );
    } finally {
      await engine.stop();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("preserves connected native sessions when a provider fails and bounds selected history", async () => {
    let history: any[] = [];
    const { engine, store, cleanup } = await setup(
      async (input: any, emit: any) => {
        history = input.messages;
        emit("agent.connected", { sessionId: "recoverable-native" });
        throw new Error("provider interrupted");
      },
    );
    try {
      const session = store.insert("sessions", {
        projectId: "project",
        agentId: "agent",
        messages: Array.from({ length: 40 }, (_, i) => ({
          role: "user",
          content: String(i).padEnd(2000, "x"),
        })),
      });
      engine.start();
      const task = engine.submitTask({
        projectId: "project",
        agentId: "agent",
        sessionId: session.id,
        title: "Fail",
        prompt: "hello",
      });
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      expect(store.get("sessions", session.id)?.providerSessionId).toBe(
        "recoverable-native",
      );
      expect(history).toHaveLength(16);
      expect(history.map((m) => m.content).join("").length).toBe(32000);
      expect(history[0].content).toContain("24");
    } finally {
      await cleanup();
    }
  });
});

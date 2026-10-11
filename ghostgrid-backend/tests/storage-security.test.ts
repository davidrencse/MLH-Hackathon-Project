import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/db/store.js";
import { DatabaseSync } from "node:sqlite";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../src/db/schema.js";
import {
  assertWorkspace,
  redact,
  safePath,
  tokenMatches,
  registerSecret,
} from "../src/security/index.js";
import { loadConfig } from "../src/config.js";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("persistent storage", () => {
  it("handles prototype-named filters as ordinary fields", () => {
    const store = new Store(":memory:");
    try {
      store.insert("projects", { name: "project" });
      for (const key of ["constructor", "toString", "__proto__"]) {
        const filters = Object.fromEntries([[key, "unexpected"]]);
        expect(store.list("projects", filters)).toEqual([]);
        expect(store.page("projects", filters)).toEqual({
          items: [],
          total: 0,
        });
      }
    } finally {
      store.close();
    }
  });
  it("rejects asynchronous transactions and rolls back synchronous writes", () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.transaction(() => {
          store.insert("projects", { id: "must-rollback" });
          return Promise.resolve("result");
        }),
      ).toThrow("synchronous callbacks");
      expect(store.get("projects", "must-rollback")).toBeUndefined();
      store.transaction(() => store.insert("projects", { id: "next" }));
      expect(store.get("projects", "next")).toBeDefined();
    } finally {
      store.close();
    }
  });
  it("rejects event pagination that could silently remove query bounds", () => {
    const store = new Store(":memory:");
    try {
      for (const [after, limit] of [
        [-1, 1],
        [0, -1],
        [0, 1.5],
        [NaN, 1],
        [0, Infinity],
      ])
        expect(() => store.events(after, undefined, limit)).toThrow(
          "Invalid event pagination",
        );
      expect(store.events(0, undefined, 0)).toEqual([]);
    } finally {
      store.close();
    }
  });
  it("rolls back incomplete events instead of leaving a missing replay cursor", () => {
    const store = new Store(":memory:");
    const update = vi.spyOn(store, "update").mockImplementationOnce(() => {
      throw new Error("simulated sequence persistence failure");
    });
    try {
      expect(() => store.event("project.created", null, {})).toThrow(
        "sequence persistence failure",
      );
      expect(store.events()).toHaveLength(0);
      update.mockRestore();
      const event = store.event("project.created", null, {});
      expect(event.seq).toBeGreaterThan(0);
      expect(store.events()[0].seq).toBe(event.seq);
    } finally {
      update.mockRestore();
      store.close();
    }
  });
  it("filters indexed task history in SQLite before decoding unrelated rows", () => {
    const store = new Store(":memory:");
    try {
      const project = store.insert("projects", {});
      const provider = store.insert("providers", {});
      const agent = store.insert("agents", {
        projectId: project.id,
        providerId: provider.id,
      });
      for (let i = 0; i < 100; i++)
        store.insert("tasks", {
          projectId: project.id,
          agentId: agent.id,
          status: i === 99 ? "queued" : "completed",
        });
      const parse = vi.spyOn(JSON, "parse");
      try {
        expect(
          store.list("tasks", { status: "queued", agentId: agent.id }),
        ).toHaveLength(1);
        expect(parse).toHaveBeenCalledTimes(1);
      } finally {
        parse.mockRestore();
      }
      const plan = store.db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT data FROM tasks WHERE json_extract(data,'$.status')=? ORDER BY rowid",
        )
        .all("queued");
      expect(
        plan.some((row) => String(row.detail).includes("tasks_status_idx")),
      ).toBe(true);
      expect(
        store.list("tasks", { status: "completed", agentId: agent.id }),
      ).toHaveLength(99);
      expect(store.list("tasks", { status: undefined })).toHaveLength(100);
      expect(store.list("tasks", { status: null })).toHaveLength(0);
      expect(
        store.list("tasks", { projectId: project.id, missing: "value" }),
      ).toHaveLength(0);
    } finally {
      store.close();
    }
  });
  it("upgrades existing version-one databases without losing history and reopens idempotently", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghostgrid-migration-"));
    const path = join(dir, "db.sqlite");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(
        readFileSync(
          new URL("../src/db/migrations/0001.sql", import.meta.url),
          "utf8",
        ).replace(/^CREATE INDEX.*tasks_status_idx.*\n?/m, ""),
      );
      legacy.exec(
        "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'legacy')",
      );
      legacy
        .prepare("INSERT INTO projects VALUES(?,?)")
        .run(
          "old-project",
          JSON.stringify({ id: "old-project", name: "preserved" }),
        );
      legacy.close();
      for (let iteration = 0; iteration < 2; iteration++) {
        const store = new Store(path);
        try {
          expect(store.get("projects", "old-project")?.name).toBe("preserved");
          expect(
            store.db
              .prepare("SELECT version FROM schema_migrations ORDER BY version")
              .all()
              .map((row) => row.version),
          ).toEqual([1, 2, 3]);
          const indices = store.db
            .prepare("SELECT name FROM sqlite_master WHERE type='index'")
            .all()
            .map((row) => row.name);
          expect(indices).toContain("tasks_status_idx");
          expect(indices).toContain("events_session_idx");
          expect(indices).toContain("usage_task_idx");
          expect(indices).toContain("usage_created_at_idx");
        } finally {
          store.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps runtime and Drizzle indexes, uniqueness and foreign-key actions aligned", () => {
    const store = new Store(":memory:");
    try {
      const declared = Object.values(schema)
        .flatMap((table) =>
          getTableConfig(table).indexes.map((index) => index.config.name),
        )
        .sort();
      const actual = store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%'",
        )
        .all()
        .map((row) => String(row.name))
        .sort();
      expect(actual).toEqual(declared);
      for (const table of Object.values(schema)) {
        const config = getTableConfig(table);
        const actions = store.db
          .prepare(`PRAGMA foreign_key_list(${config.name})`)
          .all();
        for (const foreignKey of config.foreignKeys) {
          const column = foreignKey.reference().columns[0].name;
          expect(
            actions.find((action) => action.from === column)?.on_delete,
          ).toBe(foreignKey.onDelete!.toUpperCase());
        }
      }
      const config = getTableConfig(schema.taskDependencies);
      expect(
        config.uniqueConstraints[0].columns.map((column) => column.name),
      ).toEqual(["task_id", "depends_on_task_id"]);
      const uniqueIndex = store.db
        .prepare("PRAGMA index_list(task_dependencies)")
        .all()
        .find((index) => index.origin === "u");
      expect(
        store.db
          .prepare(`PRAGMA index_info(${String(uniqueIndex!.name)})`)
          .all()
          .map((column) => column.name),
      ).toEqual(["task_id", "depends_on_task_id"]);
    } finally {
      store.close();
    }
  });
  it("pages and aggregates history without decoding unrelated task outputs", () => {
    const store = new Store(":memory:");
    try {
      store.insert("projects", { id: "project" });
      store.insert("projects", { id: "other" });
      store.insert("providers", { id: "provider" });
      store.insert("agents", {
        id: "agent",
        projectId: "project",
        providerId: "provider",
      });
      store.insert("agents", {
        id: "other-agent",
        projectId: "other",
        providerId: "provider",
      });
      store.insert("sessions", {
        id: "session",
        projectId: "project",
        agentId: "agent",
      });
      for (let i = 0; i < 100; i++) {
        store.insert("tasks", {
          id: `task-${i}`,
          projectId: i < 90 ? "other" : "project",
          agentId: i < 90 ? "other-agent" : "agent",
          sessionId: i >= 90 ? "session" : undefined,
          status: i === 99 ? "running" : "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: i === 99 ? undefined : "2026-01-01T00:00:01.123Z",
          result: "large output ".repeat(100),
        });
        store.insert("usage_records", {
          id: `usage-${i}`,
          taskId: `task-${i}`,
          costUsd: i,
        });
      }
      store.insert("workflows", { projectId: "project", status: "completed" });
      store.insert("workflows", { projectId: "project", status: "failed" });
      store.insert("workflows", { projectId: "project", status: "running" });
      const parse = vi.spyOn(JSON, "parse");
      try {
        const page = store.page(
          "tasks",
          { projectId: "project" },
          { limit: 2, offset: 3 },
        );
        expect(page.total).toBe(10);
        expect(page.items.map((item) => item.id)).toEqual([
          "task-93",
          "task-94",
        ]);
        expect(parse).toHaveBeenCalledTimes(2);
        parse.mockClear();
        const usage = store.usagePage(
          { projectId: "project", agentId: "agent" },
          2,
          3,
        );
        expect(usage.total).toBe(10);
        expect(usage.items.map((item) => item.id)).toEqual([
          "usage-93",
          "usage-94",
        ]);
        expect(parse).toHaveBeenCalledTimes(2);
        parse.mockClear();
        expect(
          store.taskCountsBySession(["session", "empty"]).get("session"),
        ).toEqual({ completed: 9, running: 1 });
        const metrics = store.metrics();
        expect(metrics.tasks.completed).toBe(99);
        expect(metrics.tasks.running).toBe(1);
        expect(metrics.activeAgents).toBe(1);
        expect(metrics.workflowCompletionRate).toBe(0.5);
        expect(metrics.durations).toHaveLength(99);
        expect(metrics.durations[0].durationMs).toBe(1123);
        expect(metrics.durationsTotal).toBe(99);
        expect(metrics.durationLimit).toBe(100);
        const durationPage = store.metrics(3, 90);
        expect(
          durationPage.durations.map((duration) => duration.taskId),
        ).toEqual(["task-90", "task-91", "task-92"]);
        expect(durationPage.durationsTotal).toBe(99);
        expect(durationPage.durationLimit).toBe(3);
        expect(durationPage.durationOffset).toBe(90);
        expect(durationPage.tasks).toEqual(metrics.tasks);
        expect(durationPage.activeAgents).toBe(metrics.activeAgents);
        expect(durationPage.workflowCompletionRate).toBe(
          metrics.workflowCompletionRate,
        );
        expect(store.metrics(3, 150).durations).toEqual([]);
        expect(store.metrics(3, 150).durationsTotal).toBe(99);
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
      for (const [limit, offset] of [
        [0, 0],
        [501, 0],
        [1, -1],
        [1.5, 0],
        [1, Number.MAX_SAFE_INTEGER + 1],
      ])
        expect(() => store.metrics(limit, offset)).toThrow(
          "Invalid metrics pagination",
        );
      expect(
        store.page("tasks", { status: "running" }, { limit: 1, offset: 0 })
          .total,
      ).toBe(1);
      expect(
        store.page("tasks", { missing: "field" }, { limit: 1, offset: 0 })
          .total,
      ).toBe(0);
      expect(() => store.page("tasks", {}, { limit: -1, offset: 0 })).toThrow(
        "Invalid pagination",
      );
    } finally {
      store.close();
    }
  });
  it("uses indexed ownership for event replay and repairs legacy JSON cursors", () => {
    const store = new Store(":memory:");
    try {
      for (let i = 0; i < 100; i++)
        store.event(
          "session.updated",
          null,
          {},
          {
            sessionId: i < 90 ? "other" : "session",
            projectId: i < 90 ? "other-project" : "project",
            agentId: "agent",
          },
        );
      const parse = vi.spyOn(JSON, "parse");
      try {
        const items = store.events(0, undefined, 2, {
          sessionId: "session",
          projectId: "project",
          agentId: "agent",
        });
        expect(items.map((item) => item.seq)).toEqual([91, 92]);
        expect(parse).toHaveBeenCalledTimes(2);
      } finally {
        parse.mockRestore();
      }
      for (const [key, index] of [
        ["sessionId", "events_session_idx"],
        ["projectId", "events_project_idx"],
        ["agentId", "events_agent_idx"],
      ]) {
        const plan = store.db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT data FROM execution_events WHERE seq>? AND json_extract(data,'$.${key}')=? ORDER BY seq LIMIT ?`,
          )
          .all(0, "session", 2);
        expect(plan.some((row) => String(row.detail).includes(index))).toBe(
          true,
        );
      }
      store.db
        .prepare(
          "UPDATE execution_events SET data=json_remove(data,'$.seq') WHERE seq=91",
        )
        .run();
      const legacyEvent = store.events(90, undefined, 1, {
        sessionId: "session",
      })[0];
      expect(legacyEvent.seq).toBe(91);
      expect(store.get("execution_events", legacyEvent.id)?.seq).toBe(91);
      expect(
        store.events(91, undefined, 1, { sessionId: "session" })[0].seq,
      ).toBe(92);
    } finally {
      store.close();
    }
  });
  it("keeps transaction state usable after BEGIN fails", () => {
    const store = new Store(":memory:");
    try {
      store.db.exec("BEGIN");
      expect(() => store.transaction(() => {})).toThrow();
      store.db.exec("ROLLBACK");
      expect(() =>
        store.transaction(() => {
          store.insert("projects", { id: "rolled-back" });
          throw new Error("abort");
        }),
      ).toThrow("abort");
      expect(store.get("projects", "rolled-back")).toBeUndefined();
      store.transaction(() => store.insert("projects", { id: "committed" }));
      expect(store.get("projects", "committed")).toBeDefined();
    } finally {
      store.close();
    }
  });
  it("retains task history after restart and enforces foreign keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghostgrid-storage-"));
    const path = join(dir, "db.sqlite");
    try {
      let store = new Store(path);
      const project = store.insert("projects", { name: "project" });
      const provider = store.insert("providers", { type: "mock" });
      const agent = store.insert("agents", {
        projectId: project.id,
        providerId: provider.id,
      });
      const task = store.insert("tasks", {
        projectId: project.id,
        agentId: agent.id,
        status: "queued",
      });
      store.event("task.queued", task.id, {});
      store.update("tasks", task.id, { status: "completed" });
      store.event("task.completed", task.id, { result: "output" });
      expect(() => store.delete("projects", project.id)).toThrow();
      store.close();
      store = new Store(path);
      expect(store.get("tasks", task.id)?.status).toBe("completed");
      expect(store.events(1, task.id).map((event) => event.type)).toEqual([
        "task.completed",
      ]);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("allows one database owner and safely recovers a dead owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghostgrid-lock-"));
    const path = join(dir, "db.sqlite");
    try {
      let first = new Store(path);
      expect(() => new Store(path)).toThrow(/already owned/);
      first.close();
      first = new Store(path);
      first.close();
      writeFileSync(
        `${path}.lock`,
        JSON.stringify({ pid: 2147483647, token: "stale-owner" }),
      );
      const recovered = new Store(path);
      recovered.close();
      writeFileSync(`${path}.lock`, "malformed");
      expect(() => new Store(path)).toThrow(/malformed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rolls back failed transactions", () => {
    const store = new Store(":memory:");
    expect(() =>
      store.transaction(() => {
        store.insert("projects", { id: "p" });
        throw Error("abort");
      }),
    ).toThrow();
    expect(store.list("projects")).toHaveLength(0);
    store.close();
  });
});
describe("security boundaries", () => {
  it("rejects empty, whitespace and control characters in API tokens", () => {
    for (const token of ["", "   ", "a b", "a\nb", "a\0b"])
      expect(() => loadConfig({ GHOSTGRID_API_TOKEN: token })).toThrow(/TOKEN/);
  });
  it("redacts common credential key spellings without hiding environment references", () => {
    expect(
      redact(
        {
          api_key: "raw",
          "api-key": "raw",
          refresh_token: "raw",
          clientSecret: "raw",
          cookie: "raw",
          apiKeyEnv: "MY_KEY",
        },
        {},
      ),
    ).toEqual({
      api_key: "[REDACTED]",
      "api-key": "[REDACTED]",
      refresh_token: "[REDACTED]",
      clientSecret: "[REDACTED]",
      cookie: "[REDACTED]",
      apiKeyEnv: "MY_KEY",
    });
  });
  it("rejects dangling symlinks to new files and directories outside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghostgrid-dangling-"));
    const inside = join(dir, "inside");
    mkdirSync(inside);
    symlinkSync(join(dir, "missing.txt"), join(inside, "file"));
    symlinkSync(join(dir, "missing-dir"), join(inside, "directory"));
    try {
      for (const path of ["file", "directory/new.txt"])
        expect(() => safePath(inside, path)).toThrow(/Dangling symlink/);
      expect(safePath(inside, "new/nested.txt")).toBe(
        join(inside, "new/nested.txt"),
      );
      expect(() => safePath(inside, "bad\0path")).toThrow(
        /Invalid filesystem path/,
      );
      expect(() => assertWorkspace(join(inside, "missing"), [inside])).toThrow(
        /Workspace must exist/,
      );
      expect(() => assertWorkspace("bad\0path", [inside])).toThrow(
        /Invalid workspace path/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("requires authentication when binding remotely", () => {
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow(/TOKEN/);
    expect(
      loadConfig({ HOST: "0.0.0.0", GHOSTGRID_API_TOKEN: "test" }).apiToken,
    ).toBe("test");
  });
  it("redacts known secret values and sensitive keys", () => {
    expect(
      redact(
        { output: "key abcdef", apiKey: "abcdef" },
        { PROVIDER_API_KEY: "abcdef" },
      ),
    ).toEqual({ output: "key [REDACTED]", apiKey: "[REDACTED]" });
    expect(tokenMatches("a", "a")).toBe(true);
    expect(tokenMatches("a", "ab")).toBe(false);
  });
  it("redacts credentials registered through arbitrary environment references", () => {
    registerSecret("value-from-arbitrary-env");
    expect(redact("output value-from-arbitrary-env")).toBe("output [REDACTED]");
  });
  it("bounds resource configuration", () => {
    for (const env of [
      { PORT: "65536" },
      { GHOSTGRID_CONCURRENCY: "33" },
      { GHOSTGRID_TASK_TIMEOUT_MS: "3600001" },
    ])
      expect(() => loadConfig(env)).toThrow();
  });
  it("rejects traversal and new files beneath escaping symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "ghostgrid-paths-"));
    const inside = join(dir, "inside");
    const outside = join(dir, "outside");
    mkdirSync(inside);
    mkdirSync(outside);
    symlinkSync(outside, join(inside, "link"));
    try {
      expect(assertWorkspace(inside, [inside])).toBe(inside);
      expect(() => assertWorkspace(outside, [inside])).toThrow();
      expect(() => safePath(inside, "../outside")).toThrow();
      expect(() => safePath(inside, "link/new.txt")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

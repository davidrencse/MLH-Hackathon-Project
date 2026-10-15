// `usageSummary` runs five aggregate scans over usage_records joined to tasks, json_extract-ing
// its way across every row — 13ms at 200 usage rows, 480ms at 20 000, all of it blocking the one
// thread that serves every request. The credits screen asks for it on a timer, so the answer is
// cached. These tests hold the two halves of that bargain: the scan is skipped when nothing could
// have changed, and never when something did.
import { describe, expect, it, vi } from "vitest";
import { Store } from "../src/db/store.js";

/** Counts how often a summary actually hit the database. */
function countScans(store: Store) {
  // Every aggregate goes through the private statement cache, so spy there rather than on sqlite.
  const sql = Reflect.get(store, "sql") as (query: string) => unknown;
  let scans = 0;
  const spy = vi.fn((query: string) => {
    if (query.includes("FROM usage_records u JOIN tasks t")) scans += 1;
    return sql.call(store, query);
  });
  Reflect.set(store, "sql", spy);
  return () => scans;
}

function seed(store: Store) {
  const project = store.insert("projects", { name: "p" });
  const provider = store.insert("providers", { name: "Mock", type: "mock" });
  const agent = store.insert("agents", { name: "a", projectId: project.id, providerId: provider.id });
  const session = store.insert("sessions", { projectId: project.id, agentId: agent.id, name: "s" });
  return { project, provider, agent, session };
}

function addUsage(store: Store, ids: ReturnType<typeof seed>, inputTokens: number) {
  const task = store.insert("tasks", {
    projectId: ids.project.id,
    agentId: ids.agent.id,
    sessionId: ids.session.id,
    status: "completed",
    prompt: "x",
  });
  store.insert("usage_records", {
    taskId: task.id,
    providerId: ids.provider.id,
    inputTokens,
    outputTokens: 1,
    createdAt: new Date().toISOString(),
  });
}

describe("usage summary cache", () => {
  it("answers repeat callers without rescanning", () => {
    const store = new Store(":memory:");
    const ids = seed(store);
    addUsage(store, ids, 10);
    const scans = countScans(store);

    const first = store.usageSummary();
    const second = store.usageSummary();

    expect(scans()).toBe(5); // totals, today, providers, agents, last minute — once, not twice
    expect(second).toBe(first);
    store.close();
  });

  it("rescans as soon as a usage record lands", () => {
    const store = new Store(":memory:");
    const ids = seed(store);
    addUsage(store, ids, 10);
    const scans = countScans(store);

    expect(store.usageSummary().totals).toMatchObject({ requests: 1, inputTokens: 10 });
    addUsage(store, ids, 25);
    expect(store.usageSummary().totals).toMatchObject({ requests: 2, inputTokens: 35 });

    expect(scans()).toBe(10);
    store.close();
  });

  it("rescans when a provider or agent is renamed, since the groups carry those names", () => {
    const store = new Store(":memory:");
    const ids = seed(store);
    addUsage(store, ids, 10);

    expect(store.usageSummary().agents[0]).toMatchObject({ name: "a" });
    store.update("agents", ids.agent.id, { name: "renamed" });
    expect(store.usageSummary().agents[0]).toMatchObject({ name: "renamed" });
    store.close();
  });

  it("holds through the event writes a running task produces", () => {
    const store = new Store(":memory:");
    const ids = seed(store);
    addUsage(store, ids, 10);
    const scans = countScans(store);

    store.usageSummary();
    // An active task writes events constantly; none of them can move a usage total, and the
    // cache would be worthless if they dropped it.
    for (let i = 0; i < 20; i++) store.event("agent.output", null, { i });
    store.usageSummary();

    expect(scans()).toBe(5);
    store.close();
  });

  it("recomputes once the TTL passes, so the live token rate stays honest", () => {
    vi.useFakeTimers();
    try {
      const store = new Store(":memory:");
      const ids = seed(store);
      addUsage(store, ids, 10);
      const scans = countScans(store);

      store.usageSummary();
      vi.advanceTimersByTime(2_000);
      store.usageSummary();

      expect(scans()).toBe(10);
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches each project separately", () => {
    const store = new Store(":memory:");
    const ids = seed(store);
    addUsage(store, ids, 10);
    const other = store.insert("projects", { name: "other" });
    const scans = countScans(store);

    expect(store.usageSummary().totals).toMatchObject({ requests: 1 });
    expect(store.usageSummary(other.id).totals).toMatchObject({ requests: 0 });
    expect(store.usageSummary().totals).toMatchObject({ requests: 1 });

    expect(scans()).toBe(10); // two distinct keys, one scan set each
    store.close();
  });
});

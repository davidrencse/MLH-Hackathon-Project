import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db/store.js";

const cleanup: Array<() => Promise<void>> = [];
it("summarizes all persisted usage, separates estimates and unknowns, and scopes projects", async () => {
  const f = await fixture(false);
  const task = f.store.insert("tasks", { projectId: f.project.id, agentId: f.agent.id, status: "completed" });
  const record = (usage: Record<string, unknown>) => f.store.insert("usage_records", {
    taskId: task.id, projectId: f.project.id, agentId: f.agent.id, providerId: f.provider.id,
    createdAt: new Date().toISOString(), inputTokens: 10, outputTokens: 5,
    costUsd: null, estimatedCostUsd: null, ...usage,
  });
  // Beyond the list endpoint's maximum page size; estimates must never double-count reported costs.
  for (let i = 0; i < 501; i++) record({ costUsd: 0 });
  record({ costUsd: 2, estimatedCostUsd: 9 });
  record({ estimatedCostUsd: 0.5 });
  record({ inputTokens: null, outputTokens: null });
  record({ createdAt: "2000-01-01T00:00:00.000Z", costUsd: 1 });
  const response = await f.request("GET", `/api/v1/usage/summary?projectId=${f.project.id}`);
  expect(response.statusCode).toBe(200);
  const summary = response.json();
  expect(summary.totals).toEqual({ requests: 505, inputTokens: 5040, outputTokens: 2520, cachedInputTokens: 0,
    reportedCostUsd: 3, estimatedCostUsd: 0.5, unknownCostRequests: 1, unknownTokenRequests: 1 });
  // Cache reads ride inside inputTokens; the summary reports them alongside so a caller can say
  // how much of the input was not fresh, and must not add them a second time.
  record({ inputTokens: 40, outputTokens: 1, cachedInputTokens: 30, costUsd: 0 });
  const withCache = (await f.request("GET", `/api/v1/usage/summary?projectId=${f.project.id}`)).json();
  expect(withCache.totals.cachedInputTokens).toBe(30);
  expect(withCache.totals.inputTokens).toBe(5080);
  expect(summary.today.requests).toBe(504);
  expect(summary.today.reportedCostUsd).toBe(2);
  expect(summary.tokensLastMinute).toBe(7545);
  expect(summary.providers[0].providerId).toBe(f.provider.id);
  const other = f.store.insert("projects", { name: "Empty district" });
  const empty = (await f.request("GET", `/api/v1/usage/summary?projectId=${other.id}`)).json();
  expect(empty.totals.requests).toBe(0);
  expect(empty.providers).toEqual([]);
  expect((await f.request("GET", "/api/v1/usage/summary?projectId=invalid")).statusCode).toBe(400);
  expect((await f.request("GET", `/api/v1/usage/summary?projectId=${randomUUID()}`)).statusCode).toBe(404);
});
it("groups usage by agent and carries each agent's building, so the city can attribute spend", async () => {
  const f = await fixture(false);
  const house = await f.create("/api/v1/agents", {
    name: "Muse", buildingId: "agent_muse", projectId: f.project.id, providerId: f.provider.id,
  });
  const record = (agentId: string, usage: Record<string, unknown>) => {
    const task = f.store.insert("tasks", { projectId: f.project.id, agentId, status: "completed" });
    f.store.insert("usage_records", {
      taskId: task.id, projectId: f.project.id, agentId, providerId: f.provider.id,
      createdAt: new Date().toISOString(), costUsd: null, estimatedCostUsd: null, ...usage,
    });
  };
  record(f.agent.id, { inputTokens: 100, outputTokens: 20, costUsd: 0.5 });
  record(house.id, { inputTokens: 7, outputTokens: 3, costUsd: 0.25 });
  record(house.id, { inputTokens: 1, outputTokens: 1, costUsd: null });
  const summary = (await f.request("GET", `/api/v1/usage/summary?projectId=${f.project.id}`)).json();
  const byBuilding = new Map(summary.agents.map((row: Record<string, unknown>) => [row.buildingId, row]));
  expect(byBuilding.get("tower")).toMatchObject({ agentId: f.agent.id, name: "Tower", requests: 1, inputTokens: 100, outputTokens: 20, reportedCostUsd: 0.5 });
  expect(byBuilding.get("agent_muse")).toMatchObject({ agentId: house.id, name: "Muse", requests: 2, inputTokens: 8, outputTokens: 4, reportedCostUsd: 0.25, unknownCostRequests: 1 });
  // The per-agent rows must add up to the same traffic the totals report.
  const agentRequests = summary.agents.reduce((sum: number, row: { requests: number }) => sum + row.requests, 0);
  expect(agentRequests).toBe(summary.totals.requests);
  const other = f.store.insert("projects", { name: "Empty district" });
  expect((await f.request("GET", `/api/v1/usage/summary?projectId=${other.id}`)).json().agents).toEqual([]);
});
it("carries a building's id from agent creation into the usage summary, and still names building-less spend", async () => {
  const f = await fixture(false);
  const housed = await f.create("/api/v1/agents", {
    name: "SignalBot", buildingId: "signal", projectId: f.project.id, providerId: f.provider.id,
  });
  expect(housed.buildingId).toBe("signal");
  // The city looks its agent up by the building id it owns, so that lookup must agree.
  expect((await f.request("GET", `/api/v1/agents?projectId=${f.project.id}&buildingId=signal`))
    .json().items.map((agent: { id: string }) => agent.id)).toEqual([housed.id]);
  // An API client's own agent belongs to no building: null is recorded, not a missing field.
  const unhoused = await f.create("/api/v1/agents", {
    name: "Script runner", projectId: f.project.id, providerId: f.provider.id,
  });
  expect(unhoused.buildingId).toBeNull();
  const record = (agentId: string, usage: Record<string, unknown>) => {
    const task = f.store.insert("tasks", { projectId: f.project.id, agentId, status: "completed" });
    f.store.insert("usage_records", {
      taskId: task.id, projectId: f.project.id, agentId, providerId: f.provider.id,
      createdAt: new Date().toISOString(), costUsd: null, estimatedCostUsd: null, ...usage,
    });
  };
  record(housed.id, { inputTokens: 40, outputTokens: 7, costUsd: 0.5 });
  record(unhoused.id, { inputTokens: 5, outputTokens: 2, costUsd: 0.25 });
  record(unhoused.id, { inputTokens: 1, outputTokens: 1, costUsd: 0.25 });
  const summary = (await f.request("GET", `/api/v1/usage/summary?projectId=${f.project.id}`)).json();
  const byAgent = new Map(summary.agents.map((row: { agentId: string }) => [row.agentId, row]));
  expect(byAgent.get(housed.id)).toMatchObject({
    buildingId: "signal", name: "SignalBot", requests: 1, inputTokens: 40, outputTokens: 7,
  });
  // Unattributed spend keeps its identity instead of vanishing from the report.
  expect(byAgent.get(unhoused.id)).toMatchObject({
    buildingId: null, name: "Script runner", requests: 2, inputTokens: 6, outputTokens: 3,
  });
  expect(summary.agents.reduce((sum: number, row: { requests: number }) => sum + row.requests, 0))
    .toBe(summary.totals.requests);
});
it("backfills an explicit null building onto agents stored before the field was normalised", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ghostgrid-building-id-"));
  cleanup.push(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, "ghostgrid.sqlite");
  const before = new Store(path);
  const project = before.insert("projects", { name: "District" });
  const provider = before.insert("providers", { name: "Mock", type: "mock" });
  // The pre-0004 shape: the key is absent, so "no building" is indistinguishable from lost data.
  const orphan = before.insert("agents", {
    name: "SignalBot", projectId: project.id, providerId: provider.id, permissions: ["read"],
  });
  const housed = before.insert("agents", {
    name: "Signal Lab", buildingId: "signal", projectId: project.id, providerId: provider.id, permissions: ["read"],
  });
  expect(Object.hasOwn(before.get("agents", orphan.id)!, "buildingId")).toBe(false);
  before.db.exec("DELETE FROM schema_migrations WHERE version=4");
  before.close();
  const after = new Store(path);
  cleanup.push(async () => after.close());
  const migrated = after.get("agents", orphan.id)!;
  expect(Object.hasOwn(migrated, "buildingId")).toBe(true);
  expect(migrated.buildingId).toBeNull();
  // An explicit building is untouched, and each agent still resolves to exactly one building.
  expect(after.get("agents", housed.id)!.buildingId).toBe("signal");
  expect(after.agentsForBuilding(project.id, "signal").map((agent) => agent.id)).toEqual([housed.id]);
  expect(after.agentsForBuilding(project.id, orphan.id).map((agent) => agent.id)).toEqual([orphan.id]);
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(startWorker = true) {
  const directory = await mkdtemp(join(tmpdir(), "ghostgrid-features-"));
  const instance = await buildApp({
    config: loadConfig({ GHOSTGRID_DATA_DIR: directory }),
    startWorker,
    logger: false,
  });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ) =>
    instance.app.inject({
      method,
      url,
      ...(payload === undefined
        ? {}
        : {
            payload: JSON.stringify(payload),
            headers: { "content-type": "application/json" },
          }),
    });
  const create = async (url: string, payload: unknown) => {
    const response = await request("POST", url, payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const project = await create("/api/v1/projects", {
    name: "Validation district",
  });
  const provider = await create("/api/v1/providers", {
    name: "Deterministic test model",
    type: "mock",
  });
  const agent = await create("/api/v1/agents", {
    name: "Tower",
    buildingId: "tower",
    projectId: project.id,
    providerId: provider.id,
  });
  const session = await create(`/api/v1/agents/${agent.id}/sessions`, {
    name: "Mission",
  });
  return {
    ...instance,
    directory,
    request,
    create,
    project,
    provider,
    agent,
    session,
  };
}
async function completed(
  request: Awaited<ReturnType<typeof fixture>>["request"],
  id: string,
) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await request("GET", `/api/v1/tasks/${id}`);
    expect(response.statusCode).toBe(200);
    const task = response.json();
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      expect(task.status, JSON.stringify(task.error)).toBe("completed");
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Task did not finish");
}

describe("feature validation through the public API", () => {
  it("replays scoped global history and publishes context/library changes without their contents", async () => {
    const f = await fixture(false);
    const delivered: any[] = [];
    f.engine.emitter.on("event", (event) => delivered.push(event));
    const context = await f.create(`/api/v1/projects/${f.project.id}/context`, {
      title: "Saved context",
      content: "Do not copy context content into audit events",
    });
    expect(delivered.at(-1)).toMatchObject({
      type: "context.created",
      projectId: f.project.id,
      data: { id: context.id },
    });
    expect(JSON.stringify(delivered.at(-1))).not.toContain("Do not copy");
    const connection = await f.request(
      "PUT",
      `/api/v1/projects/${f.project.id}/library`,
      { baseUrl: "http://127.0.0.1:8765", buildingId: "library" },
    );
    expect(connection.statusCode).toBe(200);
    expect(delivered.at(-1)).toMatchObject({
      type: "library.connected",
      projectId: f.project.id,
      buildingId: "library",
    });
    expect(JSON.stringify(delivered.at(-1))).not.toContain("127.0.0.1:8765");
    const scoped = f.store.events(0, undefined, 1000, {
      projectId: f.project.id,
    });
    const first = await f.request(
      "GET",
      `/api/v1/events?projectId=${f.project.id}&limit=2`,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().items.map((event: any) => event.id)).toEqual(
      scoped.slice(0, 2).map((event) => event.id),
    );
    const next = await f.request(
      "GET",
      `/api/v1/events?projectId=${f.project.id}&after=${first.json().nextCursor}`,
    );
    expect(next.json().items.map((event: any) => event.id)).toEqual(
      scoped.slice(2).map((event) => event.id),
    );
    const empty = await f.request(
      "GET",
      `/api/v1/events?projectId=${randomUUID()}&after=${next.json().nextCursor}`,
    );
    expect(empty.json()).toEqual({
      items: [],
      nextCursor: next.json().nextCursor,
    });
    for (const query of [
      "limit=0",
      "limit=1001",
      "after=-1",
      "projectId=invalid",
      "unknown=field",
    ])
      expect(
        (await f.request("GET", `/api/v1/events?${query}`)).statusCode,
      ).toBe(400);
    expect(
      (await f.request("DELETE", `/api/v1/projects/${f.project.id}/library`))
        .statusCode,
    ).toBe(204);
    expect(delivered.at(-1)).toMatchObject({
      type: "library.disconnected",
      projectId: f.project.id,
    });
    const events = vi.spyOn(f.store, "event").mockImplementationOnce(() => {
      throw new Error("Injected context audit failure");
    });
    expect(
      (
        await f.request("POST", `/api/v1/projects/${f.project.id}/context`, {
          title: "Must roll back",
          content: "Uncommitted",
        })
      ).statusCode,
    ).toBe(500);
    expect(
      f.store.list("context_entries", { projectId: f.project.id }),
    ).toHaveLength(1);
    events.mockRestore();
  });
  it("audits configuration changes atomically with project-scoped topology events", async () => {
    const f = await fixture(false);
    const delivered: any[] = [];
    f.engine.emitter.on("event", (event) => delivered.push(event));
    const agent = await f.create("/api/v1/agents", {
      name: "New building",
      buildingId: "new-building",
      projectId: f.project.id,
      providerId: f.provider.id,
    });
    expect(delivered.at(-1)).toMatchObject({
      type: "agent.created",
      agentId: agent.id,
      projectId: f.project.id,
    });
    expect(
      (
        await f.request("PATCH", `/api/v1/agents/${agent.id}`, {
          name: "Renamed building",
        })
      ).statusCode,
    ).toBe(200);
    expect(delivered.at(-1)).toMatchObject({
      type: "agent.updated",
      data: { id: agent.id, changedFields: ["name"] },
    });
    const scoped = f.store.events(0, undefined, 1000, {
      projectId: f.project.id,
    });
    expect(
      scoped
        .filter((event) => event.agentId === agent.id)
        .map((event) => event.type),
    ).toEqual(["agent.created", "agent.updated"]);
    const originalEvent = f.store.event.bind(f.store);
    const events = vi.spyOn(f.store, "event").mockImplementationOnce(() => {
      throw new Error("Injected audit failure");
    });
    const before = delivered.length;
    expect(
      (
        await f.request("PATCH", `/api/v1/agents/${agent.id}`, {
          name: "Must roll back",
        })
      ).statusCode,
    ).toBe(500);
    expect(f.store.get("agents", agent.id)?.name).toBe("Renamed building");
    expect(delivered).toHaveLength(before);
    events.mockImplementationOnce(() => {
      throw new Error("Injected audit failure");
    });
    const previousCount = f.store.list("projects").length;
    expect(
      (
        await f.request("POST", "/api/v1/projects", {
          name: "Must not survive",
        })
      ).statusCode,
    ).toBe(500);
    expect(f.store.list("projects")).toHaveLength(previousCount);
    events.mockImplementationOnce(() => {
      throw new Error("Injected audit failure");
    });
    expect(
      (await f.request("DELETE", `/api/v1/agents/${agent.id}`)).statusCode,
    ).toBe(500);
    expect(f.store.get("agents", agent.id)).toBeDefined();
    events.mockImplementation(originalEvent);
    expect(
      (await f.request("DELETE", `/api/v1/agents/${agent.id}`)).statusCode,
    ).toBe(204);
    expect(delivered.at(-1)).toMatchObject({
      type: "agent.deleted",
      agentId: agent.id,
      projectId: f.project.id,
    });
    events.mockRestore();
  });
  const cases = [
    [
      "provider credentials",
      "POST",
      "/providers",
      () => ({ name: "Leak", type: "mock", apiKey: "never-store-plaintext" }),
    ],
    [
      "provider type",
      "POST",
      "/providers",
      () => ({ name: "Unknown", type: "invented" }),
    ],
    [
      "provider concurrency",
      "POST",
      "/providers",
      () => ({ name: "Invalid", type: "mock", concurrency: 0 }),
    ],
    ["project name", "POST", "/projects", () => ({ name: " " })],
    [
      "project workspace allowlist",
      "POST",
      "/projects",
      () => ({ name: "Invalid workspace", workspace: "/tmp" }),
    ],
    [
      "agent permission",
      "POST",
      "/agents",
      (f: any) => ({
        name: "Unsafe",
        projectId: f.project.id,
        providerId: f.provider.id,
        permissions: ["shell"],
      }),
    ],
    [
      "write agent without workspace",
      "POST",
      "/agents",
      (f: any) => ({
        name: "Unsafe",
        projectId: f.project.id,
        providerId: f.provider.id,
        permissions: ["write"],
      }),
    ],
    [
      "session name",
      "PATCH",
      (f: any) => `/sessions/${f.session.id}`,
      () => ({ name: " " }),
    ],
    [
      "session status",
      "PATCH",
      (f: any) => `/sessions/${f.session.id}`,
      () => ({ status: "running" }),
    ],
    [
      "session message",
      "POST",
      (f: any) => `/sessions/${f.session.id}/messages`,
      () => ({ prompt: "" }),
    ],
    [
      "session context ownership",
      "POST",
      (f: any) => `/sessions/${f.session.id}/messages`,
      () => ({ prompt: "hello", contextIds: [randomUUID()] }),
    ],
    [
      "task timeout",
      "POST",
      "/tasks",
      (f: any) => ({
        projectId: f.project.id,
        agentId: f.agent.id,
        prompt: "hello",
        timeoutMs: 0,
      }),
    ],
    [
      "task retry bound",
      "POST",
      "/tasks",
      (f: any) => ({
        projectId: f.project.id,
        agentId: f.agent.id,
        prompt: "hello",
        maxRetries: 4,
      }),
    ],
    [
      "task dependency ownership",
      "POST",
      "/tasks",
      (f: any) => ({
        projectId: f.project.id,
        agentId: f.agent.id,
        prompt: "hello",
        dependencies: [randomUUID()],
      }),
    ],
    [
      "workflow cycle",
      "POST",
      "/workflows",
      (f: any) => ({
        projectId: f.project.id,
        name: "Cycle",
        nodes: [
          {
            key: "cycle",
            agentId: f.agent.id,
            prompt: "hello",
            dependsOn: ["cycle"],
          },
        ],
      }),
    ],
    [
      "workflow missing dependency",
      "POST",
      "/workflows",
      (f: any) => ({
        projectId: f.project.id,
        name: "Invalid",
        nodes: [
          {
            key: "review",
            agentId: f.agent.id,
            prompt: "hello",
            dependsOn: ["missing"],
          },
        ],
      }),
    ],
    [
      "workflow session ownership",
      "POST",
      "/workflows",
      (f: any) => ({
        projectId: f.project.id,
        name: "Invalid",
        nodes: [
          {
            key: "review",
            agentId: f.agent.id,
            sessionId: randomUUID(),
            prompt: "hello",
          },
        ],
      }),
    ],
    [
      "workflow context ownership",
      "POST",
      "/workflows",
      (f: any) => ({
        projectId: f.project.id,
        name: "Invalid",
        nodes: [
          {
            key: "review",
            agentId: f.agent.id,
            contextIds: [randomUUID()],
            prompt: "hello",
          },
        ],
      }),
    ],
    [
      "context title",
      "POST",
      (f: any) => `/projects/${f.project.id}/context`,
      () => ({ title: "", content: "notes" }),
    ],
    [
      "context source",
      "POST",
      (f: any) => `/projects/${f.project.id}/context`,
      () => ({ title: "Notes", content: "notes", sourceTaskId: "invalid" }),
    ],
    [
      "context file without workspace",
      "POST",
      (f: any) => `/projects/${f.project.id}/context`,
      () => ({ title: "File", content: "notes", fileReference: "../secret" }),
    ],
    [
      "library credentials in URL",
      "PUT",
      (f: any) => `/projects/${f.project.id}/library`,
      () => ({ baseUrl: "https://user:secret@example.com" }),
    ],
    ["usage pagination", "GET", "/usage?limit=0", () => undefined],
    ["metrics pagination", "GET", "/metrics?offset=-1", () => undefined],
    [
      "SSE scope identifier",
      "GET",
      "/events/stream?sessionId=invalid",
      () => undefined,
    ],
  ] as const;
  it.each(cases)(
    "rejects invalid %s without creating execution state",
    async (feature, method, path, payload) => {
      const f = await fixture(false);
      const url = `/api/v1${typeof path === "function" ? path(f) : path}`;
      const response = await f.request(method, url, payload(f));
      expect(response.statusCode, response.body).toBe(
        feature === "project workspace allowlist" ? 403 : 400,
      );
      expect(response.json().error).toMatchObject({
        message: expect.any(String),
        requestId: expect.any(String),
      });
      expect(f.store.list("tasks")).toHaveLength(0);
      expect(f.store.list("workflows")).toHaveLength(0);
    },
  );

  it("resolves each building's sessions and task history with pagination and rename", async () => {
    const f = await fixture(false);
    const other = await f.create("/api/v1/agents", {
      name: "Other tower",
      buildingId: "other",
      projectId: f.project.id,
      providerId: f.provider.id,
    });
    await f.create(`/api/v1/agents/${other.id}/sessions`, {
      name: "Other mission",
    });
    const second = await f.create(`/api/v1/agents/${f.agent.id}/sessions`, {
      name: "Second mission",
    });
    const task = (
      await f.request("POST", `/api/v1/sessions/${second.id}/messages`, {
        prompt: "Queued",
      })
    ).json();
    const sessions = (
      await f.request(
        "GET",
        `/api/v1/sessions?projectId=${f.project.id}&buildingId=tower&limit=1&offset=1`,
      )
    ).json();
    expect(sessions.total).toBe(2);
    expect(sessions.items.map((s: any) => s.id)).toEqual([second.id]);
    const tasks = (
      await f.request("GET", "/api/v1/tasks?buildingId=tower")
    ).json();
    expect(tasks.items.map((t: any) => t.id)).toEqual([task.id]);
    expect(
      (await f.request("GET", "/api/v1/tasks?buildingId=other")).json().total,
    ).toBe(0);
    await f.request("POST", `/api/v1/tasks/${task.id}/cancel`);
    expect(
      (
        await f.request("PATCH", `/api/v1/agents/${f.agent.id}`, {
          buildingId: "renamed-tower",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.request("GET", "/api/v1/sessions?buildingId=tower")).json()
        .total,
    ).toBe(0);
    expect(
      (
        await f.request("GET", "/api/v1/sessions?buildingId=renamed-tower")
      ).json().total,
    ).toBe(2);
    const implicit = await f.create("/api/v1/agents", {
      name: "Implicit building",
      projectId: f.project.id,
      providerId: f.provider.id,
    });
    const implicitSession = await f.create(
      `/api/v1/agents/${implicit.id}/sessions`,
      {},
    );
    expect(
      (
        await f.request("GET", `/api/v1/sessions?buildingId=${implicit.id}`)
      ).json().items[0].id,
    ).toBe(implicitSession.id);
  });

  it("passes selected context through session messages and workflow nodes while retaining histories", async () => {
    const f = await fixture();
    const context = await f.create(`/api/v1/projects/${f.project.id}/context`, {
      title: "Selected instructions",
      content: "Context integration sentinel",
    });
    const other = await f.create("/api/v1/agents", {
      name: "Reviewer",
      buildingId: "review-tower",
      projectId: f.project.id,
      providerId: f.provider.id,
    });
    const otherSession = await f.create(`/api/v1/agents/${other.id}/sessions`, {
      name: "Review",
    });
    const first = await f.request(
      "POST",
      `/api/v1/sessions/${f.session.id}/messages`,
      {
        prompt: "Plan the work",
        contextIds: [context.id],
        priority: 2,
        timeoutMs: 1000,
        maxRetries: 0,
      },
    );
    expect(first.statusCode).toBe(202);
    expect((await completed(f.request, first.json().id)).result).toContain(
      "Context integration sentinel",
    );
    const workflow = await f.create("/api/v1/workflows", {
      name: "Session-aware handoff",
      projectId: f.project.id,
      nodes: [
        {
          key: "plan",
          agentId: f.agent.id,
          sessionId: f.session.id,
          prompt: "Continue the plan",
          contextIds: [context.id],
          priority: 3,
          timeoutMs: 1000,
          maxRetries: 0,
        },
        {
          key: "review",
          agentId: other.id,
          sessionId: otherSession.id,
          prompt: "Review the plan",
          dependsOn: ["plan"],
        },
      ],
    });
    expect(
      (await f.request("POST", `/api/v1/workflows/${workflow.id}/run`))
        .statusCode,
    ).toBe(200);
    let tasks: any[] = [];
    for (let attempt = 0; attempt < 150; attempt++) {
      tasks = f.store.list("tasks", { workflowId: workflow.id });
      if (
        tasks.length === 2 &&
        tasks.every((t) => ["completed", "failed"].includes(t.status))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(tasks.map((t) => t.status)).toEqual(["completed", "completed"]);
    expect(tasks[0]).toMatchObject({
      sessionId: f.session.id,
      contextIds: [context.id],
      priority: 3,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    expect(tasks[1].result).toContain("Context integration sentinel");
    const session = (
      await f.request("GET", `/api/v1/sessions/${f.session.id}`)
    ).json();
    expect(session.messages.filter((m: any) => m.role === "user")).toHaveLength(
      2,
    );
    const review = (
      await f.request("GET", `/api/v1/sessions/${otherSession.id}`)
    ).json();
    expect(review.messages.filter((m: any) => m.role === "user")).toHaveLength(
      1,
    );
    expect(review.providerSessionId).not.toBe(session.providerSessionId);
    expect(
      (await f.request("GET", `/api/v1/workflows/${workflow.id}`)).json()
        .status,
    ).toBe("completed");
    const events = (
      await f.request("GET", `/api/v1/tasks/${tasks[1].id}/events`)
    ).json();
    expect(events.nextCursor).toBe(events.items.at(-1).seq);
    expect(
      (
        await f.request(
          "GET",
          `/api/v1/tasks/${tasks[1].id}/events?after=${events.nextCursor}`,
        )
      ).json(),
    ).toEqual({ items: [], nextCursor: events.nextCursor });
    const artifacts = (
      await f.request("GET", `/api/v1/tasks/${tasks[1].id}/artifacts`)
    ).json();
    const output = await f.request(
      "GET",
      `/api/v1/artifacts/${artifacts.items[0].id}/content`,
    );
    expect(output.body).toBe(tasks[1].result);
    expect((await f.request("GET", "/api/v1/usage")).json().total).toBe(3);
  });
});

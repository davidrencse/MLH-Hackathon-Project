import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(token?: string, env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ghostgrid-api-"));
  const instance = await buildApp({
    config: loadConfig({
      ...env,
      GHOSTGRID_DATA_DIR: dir,
      ...(token ? { GHOSTGRID_API_TOKEN: token } : {}),
    }),
    logger: false,
  });
  cleanups.push(async () => {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
  ) =>
    instance.app.inject({
      method,
      url,
      ...(payload ? { payload } : {}),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const create = async (url: string, payload: unknown) => {
    const response = await request("POST", url, payload);
    expect(response.statusCode).toBe(201);
    return response.json();
  };
  const project = await create("/api/v1/projects", { name: "API test" });
  const provider = await create("/api/v1/providers", {
    name: "Mock",
    type: "mock",
  });
  const agent = await create("/api/v1/agents", {
    name: "Worker",
    projectId: project.id,
    providerId: provider.id,
  });
  return { ...instance, request, create, project, provider, agent };
}
async function waitFor(
  request: (method: "GET", url: string) => Promise<any>,
  path: string,
  status: string,
) {
  for (let i = 0; i < 150; i++) {
    const response = await request("GET", path);
    expect(response.statusCode).toBe(200);
    const record = response.json();
    if (record.status === status) return record;
    if (record.status === "failed") throw Error(JSON.stringify(record.error));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error(`Timeout waiting for ${status}`);
}
describe("backend API", () => {
  it("rejects DNS rebinding hosts on the tokenless local server", async () => {
    const { app } = await setup();
    for (const host of ["attacker.example:3001", "localhost.attacker.example", "127.0.0.1.attacker.example"])
      expect((await app.inject({ url: "/health", headers: { host } })).statusCode).toBe(403);
    for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001"])
      expect((await app.inject({ url: "/health", headers: { host } })).statusCode).toBe(200);
    const authenticated = await setup("host-check-token");
    expect((await authenticated.app.inject({ url: "/health", headers: { host: "proxy.example", authorization: "Bearer host-check-token" } })).statusCode).toBe(200);
  });
  it("validates path IDs and keeps unknown-route errors free of request URLs", async () => {
    const { request } = await setup();
    const invalid = await request("GET", "/api/v1/projects/not-a-uuid");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
    const missing = await request("GET", "/missing?token=should-not-be-echoed");
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain("should-not-be-echoed");
    expect(missing.headers["x-content-type-options"]).toBe("nosniff");
    expect(missing.headers["cache-control"]).toBe("no-store");
  });
  it("paginates usage by task ownership and computes metrics without loading task output", async () => {
    const { request, project, agent, store, engine } = await setup();
    await engine.stop();
    const secondProject = store.insert("projects", { name: "Other" });
    const otherAgent = store.insert("agents", { projectId: secondProject.id, providerId: agent.providerId, permissions: [] });
    const first = store.insert("tasks", { projectId: project.id, agentId: agent.id, status: "completed", result: "x".repeat(100000), startedAt: "2026-10-11T12:00:00.000Z", completedAt: "2026-10-11T12:00:01.234Z" });
    const running = store.insert("tasks", { projectId: project.id, agentId: agent.id, status: "running" });
    const other = store.insert("tasks", { projectId: secondProject.id, agentId: otherAgent.id, status: "failed" });
    for (const task of [first, running, other]) store.insert("usage_records", { taskId: task.id, inputTokens: null, outputTokens: null });
    store.insert("workflows", { projectId: project.id, status: "completed" });
    store.insert("workflows", { projectId: project.id, status: "failed" });
    store.insert("workflows", { projectId: project.id, status: "running" });
    const get = vi.spyOn(store, "get");
    const list = vi.spyOn(store, "list");
    const usage = (await request("GET", `/api/v1/usage?projectId=${project.id}&agentId=${agent.id}&limit=1&offset=1`)).json();
    expect(usage.total).toBe(2);
    expect(usage.items.map((item: any) => item.taskId)).toEqual([running.id]);
    expect(get.mock.calls.filter(([table]) => table === "tasks")).toHaveLength(0);
    const metrics = (await request("GET", "/api/v1/metrics")).json();
    expect(metrics.tasks).toMatchObject({ completed: 1, running: 1, failed: 1, queued: 0 });
    expect(metrics.activeAgents).toBe(1);
    expect(metrics.workflowCompletionRate).toBe(0.5);
    expect(metrics.durations).toEqual([{ taskId: first.id, durationMs: 1234 }]);
    expect(list.mock.calls.filter(([table]) => ["tasks", "workflows", "usage_records"].includes(table))).toHaveLength(0);
    get.mockRestore(); list.mockRestore();
  });
  it("bounds and pages duration history while keeping metric counts global", async () => {
    const { request, project, agent, store, engine } = await setup();
    await engine.stop();
    const completed = Array.from({ length: 105 }, (_, index) => store.insert("tasks", {
      projectId: project.id, agentId: agent.id, status: "completed",
      startedAt: "2026-10-11T12:00:00.000Z", completedAt: "2026-10-11T12:00:01.000Z",
      result: "Large output ".repeat(1000), title: `Task ${index}`,
    }));
    store.insert("tasks", { projectId: project.id, agentId: agent.id, status: "queued" });
    const defaults = (await request("GET", "/api/v1/metrics")).json();
    expect(defaults.tasks).toMatchObject({ completed: 105, queued: 1 });
    expect(defaults.durations).toHaveLength(100);
    expect(defaults).toMatchObject({ durationsTotal: 105, durationLimit: 100, durationOffset: 0 });
    const page = (await request("GET", "/api/v1/metrics?limit=3&offset=101")).json();
    expect(page.tasks).toEqual(defaults.tasks);
    expect(page.durations.map((duration: any) => duration.taskId)).toEqual(completed.slice(101, 104).map((task) => task.id));
    expect(page).toMatchObject({ durationsTotal: 105, durationLimit: 3, durationOffset: 101 });
    const empty = (await request("GET", "/api/v1/metrics?offset=105")).json();
    expect(empty.durations).toEqual([]);
    expect(empty.durationsTotal).toBe(105);
    for (const query of ["limit=0", "limit=501", "offset=-1", "limit=not-a-number", "projectId=unknown"])
      expect((await request("GET", `/api/v1/metrics?${query}`)).statusCode).toBe(400);
  });
  it("summarizes only the requested session page without loading task history", async () => {
    const { request, create, project, agent, store, engine } = await setup();
    await engine.stop();
    const first = await create("/api/v1/sessions", { projectId: project.id, agentId: agent.id });
    const second = await create("/api/v1/sessions", { projectId: project.id, agentId: agent.id });
    store.insert("tasks", { projectId: project.id, agentId: agent.id, sessionId: first.id, status: "completed", result: "x".repeat(100000) });
    store.insert("tasks", { projectId: project.id, agentId: agent.id, sessionId: second.id, status: "queued" });
    const list = vi.spyOn(store, "list");
    const counts = vi.spyOn(store, "taskCountsBySession");
    const response = await request("GET", `/api/v1/sessions?agentId=${agent.id}&limit=1&offset=1`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 2, items: [{ id: second.id, taskCount: 1, activeTaskCount: 1, taskCounts: { queued: 1 } }] });
    expect(response.json().items).toHaveLength(1);
    expect(counts).toHaveBeenCalledOnce();
    expect(counts).toHaveBeenCalledWith([second.id]);
    expect(list.mock.calls.filter(([table]) => ["tasks", "sessions"].includes(table))).toHaveLength(0);
    list.mockRestore(); counts.mockRestore();
  });
  it("gives session messages the same default task title as direct task submission", async () => {
    const { request, create, project, agent } = await setup();
    const session = await create("/api/v1/sessions", { projectId: project.id, agentId: agent.id });
    const response = await request("POST", `/api/v1/sessions/${session.id}/messages`, { prompt: "hello" });
    expect(response.statusCode).toBe(202);
    expect(response.json().title).toBe("Task");
    const named = await request("POST", `/api/v1/sessions/${session.id}/messages`, { prompt: "hello again", title: "Follow-up" });
    expect(named.json().title).toBe("Follow-up");
  });
  it("allows configured browser origins while preserving authentication", async () => {
    const { app } = await setup("audit-token", { GHOSTGRID_ALLOWED_ORIGINS: "http://localhost:5173" });
    for (const origin of ["http://localhost:5173"]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/projects", headers: { origin, authorization: "Bearer audit-token" }, payload: { name: "Browser project" } });
      expect(response.statusCode).toBe(201);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
    const preflight = await app.inject({ method: "OPTIONS", url: "/api/v1/projects", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-headers"]).toContain("authorization");
    expect(preflight.headers["access-control-allow-methods"]).toContain("PUT");
    expect((await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:5173" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "OPTIONS", url: "/api/v1/projects", headers: { origin: "https://untrusted.example" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/health", headers: { origin: "http://localhost:80", authorization: "Bearer audit-token" } })).statusCode).toBe(403);
    const stream = app.inject({ url: "/api/v1/events/stream", headers: { origin: "http://localhost:5173", authorization: "Bearer audit-token" } });
    const closing = setTimeout(() => { void app.close(); }, 50);
    try {
      const response = await stream;
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      expect(response.headers.vary).toBe("Origin");
    } finally { clearTimeout(closing); }
  });
  it("applies global retry and timeout defaults and preserves explicit overrides", async () => {
    const { request, project, agent } = await setup(undefined, {
      GHOSTGRID_TASK_TIMEOUT_MS: "12345",
      GHOSTGRID_MAX_ATTEMPTS: "3",
    });
    const base = { projectId: project.id, agentId: agent.id, prompt: "hello" };
    const defaults = await request("POST", "/api/v1/tasks", base);
    expect(defaults.statusCode).toBe(202);
    expect(defaults.json()).toMatchObject({ timeoutMs: 12345, maxRetries: 2 });
    const explicit = await request("POST", "/api/v1/tasks", {
      ...base,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    expect(explicit.statusCode).toBe(202);
    expect(explicit.json()).toMatchObject({ timeoutMs: 1000, maxRetries: 0 });
  });
  it("keeps message title validation aligned with its OpenAPI schema", async () => {
    const { request, create, project, agent } = await setup();
    const session = await create("/api/v1/sessions", {
      projectId: project.id,
      agentId: agent.id,
    });
    for (const title of [" ", "x".repeat(161)]) {
      expect(
        (
          await request("POST", `/api/v1/sessions/${session.id}/messages`, {
            prompt: "hello",
            title,
          })
        ).statusCode,
      ).toBe(400);
    }
    const spec = (await request("GET", "/api/v1/openapi.json")).json();
    const title =
      spec.paths["/api/v1/sessions/{id}/messages"].post.requestBody.content[
        "application/json"
      ].schema.properties.title;
    expect(title).toMatchObject({ minLength: 1, maxLength: 160 });
  });
  it("executes a mock task asynchronously and exposes output, events and unknown usage", async () => {
    const { request, project, agent } = await setup();
    const submitted = await request("POST", "/api/v1/tasks", {
      projectId: project.id,
      agentId: agent.id,
      prompt: "Write a summary",
    });
    expect(submitted.statusCode).toBe(202);
    const task = submitted.json();
    expect(task.status).toBe("queued");
    const done = await waitFor(
      request,
      `/api/v1/tasks/${task.id}`,
      "completed",
    );
    expect(done.result).toContain("Write a summary");
    const events = (
      await request("GET", `/api/v1/tasks/${task.id}/events`)
    ).json().items;
    expect(events.map((event: any) => event.type)).toEqual(
      expect.arrayContaining([
        "task.created",
        "task.started",
        "agent.output",
        "task.completed",
      ]),
    );
    const cursor = events.find(
      (event: any) => event.type === "task.started",
    ).seq;
    expect(
      (await request("GET", `/api/v1/tasks/${task.id}/events?after=${cursor}`))
        .json()
        .items.every((event: any) => event.seq > cursor),
    ).toBe(true);
    expect(
      (await request("GET", `/api/v1/tasks/${task.id}/artifacts`)).json().items
        .length,
    ).toBeGreaterThan(0);
    const usage = (await request("GET", "/api/v1/usage")).json().items[0];
    expect(usage.inputTokens).toBeNull();
  });
  it("persists messages and native session identifiers between requests", async () => {
    const { request, create, project, agent, store } = await setup();
    const session = await create("/api/v1/sessions", {
      projectId: project.id,
      agentId: agent.id,
    });
    for (const prompt of ["First message", "Follow-up"]) {
      const submitted = (
        await request("POST", `/api/v1/sessions/${session.id}/messages`, {
          prompt,
        })
      ).json();
      await waitFor(request, `/api/v1/tasks/${submitted.id}`, "completed");
    }
    const record = (
      await request("GET", `/api/v1/sessions/${session.id}`)
    ).json();
    expect(record.messages).toHaveLength(4);
    expect(record.providerSessionId).toBeTruthy();
    expect(store.get("sessions", session.id)?.messages).toHaveLength(4);
  });
  it("runs DAG workflows and passes dependency output to subsequent agents", async () => {
    const { request, create, project, agent } = await setup();
    const workflow = await create("/api/v1/workflows", {
      projectId: project.id,
      name: "Plan and review",
      nodes: [
        { key: "plan", agentId: agent.id, prompt: "Create plan" },
        {
          key: "review",
          agentId: agent.id,
          prompt: "Review plan",
          dependsOn: ["plan"],
        },
      ],
    });
    expect(
      (await request("POST", `/api/v1/workflows/${workflow.id}/run`))
        .statusCode,
    ).toBe(200);
    const done = await waitFor(
      request,
      `/api/v1/workflows/${workflow.id}`,
      "completed",
    );
    expect(done.result).toHaveLength(2);
    expect(done.result[1].result).toContain("Completed dependency outputs");
  });
  it("rejects plaintext credentials and invalid compatible-provider configuration", async () => {
    const { request } = await setup();
    for (const body of [
      {
        name: "Unsafe",
        type: "openai-compatible",
        model: "m",
        baseUrl: "https://example.com",
        apiKey: "secret",
      },
      {
        name: "Missing model",
        type: "deepseek",
        apiKeyEnv: "DEEPSEEK_API_KEY",
      },
      {
        name: "Embedded credentials",
        type: "openai-compatible",
        model: "m",
        baseUrl: "https://user:password@example.com",
        auth: "none",
      },
    ])
      expect(
        (await request("POST", "/api/v1/providers", body)).statusCode,
      ).toBe(400);
    const response = await request("POST", "/api/v1/providers", {
      name: "Configured",
      type: "openai-compatible",
      model: "custom-model",
      baseUrl: "https://example.com/v1",
      apiKeyEnv: "CUSTOM_API_KEY",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().apiKeyEnv).toBe("CUSTOM_API_KEY");
    expect(
      (await request("POST", "/api/v1/tasks", { prompt: "" })).statusCode,
    ).toBe(400);
  });
  it("requires bearer authentication and rejects cross-origin browser access", async () => {
    const { app, request } = await setup("test-token");
    expect((await app.inject("/health")).statusCode).toBe(401);
    expect((await request("GET", "/health")).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: "/health",
          headers: {
            authorization: "Bearer test-token",
            origin: "https://untrusted.example",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await request("GET", "/api/v1/openapi.json")).json().paths[
        "/api/v1/tasks"
      ],
    ).toBeTruthy();
  });
  it("streams persisted SSE events and honors Last-Event-ID on reconnect", async () => {
    const { app, request, project, agent, config } = await setup();
    const task = (
      await request("POST", "/api/v1/tasks", {
        projectId: project.id,
        agentId: agent.id,
        prompt: "Replay",
      })
    ).json();
    await waitFor(request, `/api/v1/tasks/${task.id}`, "completed");
    const events = (
      await request("GET", `/api/v1/tasks/${task.id}/events`)
    ).json().items;
    const cursor = events[events.length - 2].seq;
    const injection = app.inject({
      url: `/api/v1/events/stream?taskId=${task.id}`,
      headers: { "Last-Event-ID": String(cursor) },
    });
    const closing = setTimeout(() => {
      void app.close();
    }, 50);
    try {
      const response = await injection;
      expect(response.headers["content-type"]).toBe("text/event-stream");
      expect(response.body).toContain("event: task.completed");
      expect(response.body).not.toContain(`id: ${cursor}\n`);
    } finally {
      clearTimeout(closing);
    }
    await app.close();
    const reopened = await buildApp({ config, logger: false });
    cleanups.push(async () => {
      await reopened.app.close();
    });
    const replay = reopened.app.inject({
      url: `/api/v1/events/stream?taskId=${task.id}`,
      headers: { "Last-Event-ID": String(cursor) },
    });
    const closingReplay = setTimeout(() => {
      void reopened.app.close();
    }, 50);
    try {
      const response = await replay;
      expect(response.body).toContain("event: task.completed");
      expect(response.body).not.toContain(`id: ${cursor}\n`);
    } finally {
      clearTimeout(closingReplay);
    }
  }, 10000);
  it("binds unique buildings to agents and scopes named persistent sessions", async () => {
    const { app, request, create, project, provider, agent } = await setup();
    const building = await create("/api/v1/agents", {
      name: "Tower",
      buildingId: "tower-1",
      projectId: project.id,
      providerId: provider.id,
    });
    expect(
      (
        await request("POST", "/api/v1/agents", {
          name: "Duplicate",
          buildingId: "tower-1",
          projectId: project.id,
          providerId: provider.id,
        })
      ).statusCode,
    ).toBe(409);
    const session = await create(`/api/v1/agents/${building.id}/sessions`, {
      name: "Implementation",
    });
    const other = await create(`/api/v1/agents/${agent.id}/sessions`, {
      name: "Other session",
    });
    expect(session.name).toBe("Implementation");
    expect(session.agentId).toBe(building.id);
    expect(
      (await request("GET", `/api/v1/agents/${building.id}/sessions`))
        .json()
        .items.map((item: any) => item.id),
    ).toEqual([session.id]);
    expect(
      (
        await request("PATCH", `/api/v1/sessions/${session.id}`, {
          status: "archived",
          name: "Archived work",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", `/api/v1/sessions/${session.id}/messages`, {
          prompt: "Blocked",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await request("POST", `/api/v1/sessions/${session.id}/resume`)).json()
        .status,
    ).toBe("active");
    for (const [id, prompt] of [
      [session.id, "Own output"],
      [other.id, "Other output"],
    ]) {
      const task = (
        await request("POST", `/api/v1/sessions/${id}/messages`, { prompt })
      ).json();
      await waitFor(request, `/api/v1/tasks/${task.id}`, "completed");
    }
    const history = (
      await request("GET", `/api/v1/sessions/${session.id}`)
    ).json();
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].content).toBe("Own output");
    const events = (
      await request("GET", `/api/v1/sessions/${session.id}/events`)
    ).json().items;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event: any) => event.sessionId === session.id)).toBe(
      true,
    );
    const task = (
      await request("GET", `/api/v1/sessions/${session.id}/tasks`)
    ).json().items[0];
    const artifact = (
      await request("GET", `/api/v1/tasks/${task.id}/artifacts`)
    ).json().items[0];
    const content = await request(
      "GET",
      `/api/v1/artifacts/${artifact.id}/content`,
    );
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain("Own output");
    const stream = app.inject({
      url: `/api/v1/events/stream?sessionId=${session.id}`,
    });
    const closing = setTimeout(() => {
      void app.close();
    }, 50);
    try {
      const response = await stream;
      expect(response.body).toContain("Own output");
      expect(response.body).not.toContain("Other output");
      expect(response.body).toContain("event: task.completed");
    } finally {
      clearTimeout(closing);
    }
  });
  it("accepts environment-referenced header authentication and rejects unsafe configuration", async () => {
    const { request, project } = await setup();
    const base = {
      name: "Custom",
      type: "openai-compatible",
      model: "custom",
      baseUrl: "https://models.example/v1",
      auth: "header",
      apiKeyEnv: "CUSTOM_VALUE",
      apiKeyHeader: "X-API-Key",
      headersEnv: { "X-Tenant": "TENANT_VALUE" },
    };
    const response = await request("POST", "/api/v1/providers", base);
    expect(response.statusCode).toBe(201);
    expect(response.json().apiKeyHeader).toBe("X-API-Key");
    expect(response.json().headersEnv).toEqual({ "X-Tenant": "TENANT_VALUE" });
    expect(
      (
        await request("POST", "/api/v1/providers", {
          ...base,
          queryParameters: { api_key: "plaintext" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/v1/providers", {
          ...base,
          headersEnv: { Host: "HOST_VALUE" },
        })
      ).statusCode,
    ).toBe(400);
    for (const apiKeyHeader of [
      "Host",
      "Content-Length",
      "Transfer-Encoding",
      "Connection",
      "Content-Type",
    ])
      expect(
        (await request("POST", "/api/v1/providers", { ...base, apiKeyHeader }))
          .statusCode,
      ).toBe(400);
    expect(
      (await request("DELETE", `/api/v1/projects/${project.id}`)).statusCode,
    ).toBe(409);
  });
});

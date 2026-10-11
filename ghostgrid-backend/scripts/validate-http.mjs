// Full compiled backend integration over loopback HTTP. Temporary data; no paid APIs.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const directory = await mkdtemp(join(tmpdir(), "ghostgrid-http-validation-"));
const token = "temporary-http-validation-token";
const origin = "http://localhost:5173";
const config = loadConfig({
  GHOSTGRID_DATA_DIR: directory,
  GHOSTGRID_API_TOKEN: token,
  GHOSTGRID_ALLOWED_ORIGINS: origin,
});
let app;
let address;
async function start() {
  ({ app } = await buildApp({ config, logger: false }));
  address = await app.listen({ host: "127.0.0.1", port: 0 });
}
async function request(method, path, body, expected = 200) {
  const response = await fetch(address + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${await response.clone().text()}`,
  );
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  if (response.status === 204) return null;
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : response.text();
}
async function wait(path) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const record = await request("GET", path);
    if (["completed", "failed", "cancelled"].includes(record.status)) {
      assert.equal(
        record.status,
        "completed",
        JSON.stringify(record.error ?? record.result),
      );
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${path}`);
}
try {
  await start();
  const unauthorized = await fetch(address + "/health", {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();
  await request("GET", "/health");
  const preflight = await fetch(address + "/api/v1/sessions", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  await preflight.arrayBuffer();
  const project = await request(
    "POST",
    "/api/v1/projects",
    { name: "HTTP validation district" },
    201,
  );
  const provider = await request(
    "POST",
    "/api/v1/providers",
    { name: "Mock fixture", type: "mock" },
    201,
  );
  assert.equal(
    (await request("POST", `/api/v1/providers/${provider.id}/test`)).available,
    true,
  );
  const implementation = await request(
    "POST",
    "/api/v1/agents",
    {
      name: "Implementation",
      buildingId: "code-tower",
      projectId: project.id,
      providerId: provider.id,
    },
    201,
  );
  const reviewer = await request(
    "POST",
    "/api/v1/agents",
    {
      name: "Reviewer",
      buildingId: "review-tower",
      projectId: project.id,
      providerId: provider.id,
    },
    201,
  );
  const session = await request(
    "POST",
    `/api/v1/agents/${implementation.id}/sessions`,
    { name: "Implementation mission" },
    201,
  );
  const reviewSession = await request(
    "POST",
    `/api/v1/agents/${reviewer.id}/sessions`,
    { name: "Review mission" },
    201,
  );
  const memory = "Remember the HTTP session notes verification sentinel";
  const updatedSession = await request("PATCH", `/api/v1/sessions/${session.id}`, { memory });
  assert.equal(updatedSession.memory, memory);
  const context = await request(
    "POST",
    `/api/v1/projects/${project.id}/context`,
    { title: "Shared context", content: "HTTP context verification sentinel" },
    201,
  );
  const task = await request(
    "POST",
    `/api/v1/sessions/${session.id}/messages`,
    { prompt: "Plan the mission", contextIds: [context.id] },
    202,
  );
  const completed = await wait(`/api/v1/tasks/${task.id}`);
  assert.ok(completed.result.includes("HTTP context verification sentinel"));
  assert.ok(completed.result.includes(memory));
  await request(
    "POST",
    "/api/v1/tasks",
    {
      projectId: project.id,
      agentId: reviewer.id,
      sessionId: session.id,
      prompt: "Invalid cross-building session",
    },
    400,
  );
  const workflow = await request(
    "POST",
    "/api/v1/workflows",
    {
      name: "Two-building handoff",
      projectId: project.id,
      nodes: [
        {
          key: "implementation",
          agentId: implementation.id,
          sessionId: session.id,
          prompt: "Continue the mission",
          contextIds: [context.id],
          timeoutMs: 1000,
          maxRetries: 0,
        },
        {
          key: "review",
          agentId: reviewer.id,
          sessionId: reviewSession.id,
          prompt: "Review the mission",
          dependsOn: ["implementation"],
        },
      ],
    },
    201,
  );
  await request("POST", `/api/v1/workflows/${workflow.id}/run`);
  const done = await wait(`/api/v1/workflows/${workflow.id}`);
  assert.equal(done.result.length, 2);
  assert.ok(
    done.result[1].result.includes("HTTP context verification sentinel"),
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/v1/sessions?projectId=${project.id}&buildingId=code-tower`,
      )
    ).total,
    1,
  );
  const restoredSession = await request(
    "GET",
    `/api/v1/sessions/${session.id}`,
  );
  assert.equal(restoredSession.messages.length, 4);
  assert.equal(restoredSession.buildingId, "code-tower");
  assert.notEqual(
    restoredSession.providerSessionId,
    (await request("GET", `/api/v1/sessions/${reviewSession.id}`))
      .providerSessionId,
  );
  const events = await request("GET", `/api/v1/tasks/${task.id}/events`);
  const history = await request(
    "GET",
    `/api/v1/events?projectId=${project.id}&limit=2`,
  );
  assert.equal(history.items.length, 2);
  assert.ok(history.items.every((event) => event.projectId === project.id));
  const rest = await request(
    "GET",
    `/api/v1/events?projectId=${project.id}&after=${history.nextCursor}`,
  );
  assert.ok(rest.items.some((event) => event.type === "context.created"));
  assert.ok(rest.items.every((event) => event.seq > history.nextCursor));
  const outputEvent = events.items.find(
    (event) => event.type === "agent.output",
  );
  assert.ok(outputEvent);
  const response = await fetch(
    `${address}/api/v1/events/stream?taskId=${task.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "Last-Event-ID": String(outputEvent.seq),
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let frames = "";
  try {
    while (!frames.includes("event: task.completed")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      frames += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  assert.ok(
    !frames.includes(`id: ${outputEvent.seq}\n`),
    "SSE replay must begin after Last-Event-ID",
  );
  const artifacts = await request("GET", `/api/v1/tasks/${task.id}/artifacts`);
  assert.equal(
    await request("GET", `/api/v1/artifacts/${artifacts.items[0].id}/content`),
    completed.result,
  );
  assert.equal((await request("GET", "/api/v1/usage")).total, 3);
  assert.equal((await request("GET", "/api/v1/metrics")).tasks.completed, 3);
  await request("PATCH", `/api/v1/sessions/${session.id}`, {
    status: "archived",
  });
  await request(
    "POST",
    `/api/v1/sessions/${session.id}/messages`,
    { prompt: "Invalid archived session" },
    409,
  );
  await request("POST", `/api/v1/sessions/${session.id}/resume`);
  const spec = await request("GET", "/api/v1/openapi.json");
  assert.ok(
    spec.paths["/api/v1/sessions/{id}/messages"].post.requestBody.content[
      "application/json"
    ].schema.properties.contextIds,
  );
  await app.close();
  app = undefined;
  await start();
  assert.equal(
    (await request("GET", `/api/v1/tasks/${task.id}`)).status,
    "completed",
  );
  assert.equal(
    (await request("GET", `/api/v1/sessions/${session.id}`)).providerSessionId,
    restoredSession.providerSessionId,
  );
  assert.equal((await request("GET", `/api/v1/sessions/${session.id}`)).memory, memory);
  assert.equal((await request("GET", `/api/v1/sessions/${reviewSession.id}`)).memory, "");
  assert.equal(
    (await request("GET", `/api/v1/workflows/${workflow.id}`)).status,
    "completed",
  );
  assert.equal(
    (await request("GET", `/api/v1/sessions/${session.id}/events`)).items.at(-1)
      .type,
    "session.resumed",
  );
  console.log(
    "Compiled HTTP validation passed: authentication/CORS, per-building sessions, context, workflows, SSE replay, artifacts, usage and restart persistence. No paid API calls.",
  );
} finally {
  try {
    await app?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

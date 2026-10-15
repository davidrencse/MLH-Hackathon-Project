// Does a task actually land in the usage ledger?
//
// The city's CREDITS display is read from `GET /api/v1/usage/summary`, which is built only
// from `usage_records`, and a `usage_record` is written in exactly one place: the execution
// engine, after a task completes. So a city that shows nothing has one of two problems — no
// task was ever created, or the task ran but the provider reported no token counts — and this
// script separates them by driving the whole chain itself and asserting each link.
//
// Unlike validate-http.mjs (which boots `dist/` in-process) this runs over HTTP against an
// ALREADY RUNNING backend, so it can be pointed at a disposable instance:
//
//   PORT=3155 GHOSTGRID_DATA_DIR=/tmp/gg npm start &
//   GG_URL=http://127.0.0.1:3155 node scripts/usage-pipeline.mjs
//
// Env: GG_URL (default http://127.0.0.1:3001), GG_TOKEN (when the backend runs with
// GHOSTGRID_API_TOKEN), GG_PROVIDER (default "mock").
//
// It only ever creates a `mock` provider by default. Pointing GG_PROVIDER at a vendor type
// spends real money on whatever key that backend holds, so it is never the default and the
// script refuses to invent a provider it was not asked for.
import assert from "node:assert/strict";

const base = (process.env.GG_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const token = process.env.GG_TOKEN;
const providerType = process.env.GG_PROVIDER ?? "mock";
const stamp = `usage-pipeline-${Date.now()}`;
const buildingId = `${stamp}-building`;

const headers = (body) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(body === undefined ? {} : { "Content-Type": "application/json" }),
});

async function api(method, path, body, expected) {
  const response = await fetch(base + path, {
    method,
    headers: headers(body),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (expected !== undefined)
    assert.equal(response.status, expected, `${method} ${path} -> ${response.status}: ${text}`);
  else
    assert.ok(response.ok, `${method} ${path} -> ${response.status}: ${text}`);
  return text && response.headers.get("content-type")?.includes("application/json")
    ? JSON.parse(text)
    : text;
}

const step = (message) => console.log(`· ${message}`);

/** Reads the SSE firehose for one task until a terminal event, collecting the types seen. */
async function collectStream(taskId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const types = [];
  let usageEvent = null;
  try {
    const response = await fetch(`${base}/api/v1/events/stream?taskId=${taskId}&after=0`, {
      headers: { ...headers(), Accept: "text/event-stream" },
      signal: controller.signal,
    });
    assert.ok(response.ok && response.body, `event stream -> ${response.status}`);
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      // SSE frames are separated by a blank line; a partial frame stays in the buffer.
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) continue; // heartbeat / comment frame
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        types.push(event.type);
        if (event.type === "usage.updated") usageEvent = event.data;
        if (["task.completed", "task.failed", "task.cancelled"].includes(event.type))
          return { types, usageEvent, terminal: event.type };
      }
    }
    throw new Error("event stream ended before the task finished");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function waitForTask(taskId) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const task = await api("GET", `/api/v1/tasks/${taskId}`);
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`task ${taskId} never reached a terminal state`);
}

const health = await api("GET", "/health");
assert.equal(health.status, "ok", `unexpected /health: ${JSON.stringify(health)}`);
step(`backend at ${base} is healthy`);

const before = await api("GET", "/api/v1/usage/summary");
step(`usage before: ${before.totals.requests} requests, ${before.totals.inputTokens + before.totals.outputTokens} tokens`);

const project = await api("POST", "/api/v1/projects", { name: `${stamp} project` }, 201);
step(`project ${project.id}`);

// Reuse an existing provider of this type rather than minting a duplicate on every run.
const providers = await api("GET", "/api/v1/providers?limit=200");
const provider =
  providers.items.find((candidate) => candidate.type === providerType) ??
  (providerType === "mock"
    ? await api("POST", "/api/v1/providers", { name: `${stamp} mock`, type: "mock", concurrency: 4 }, 201)
    : null);
assert.ok(provider, `no ${providerType} provider on this backend, and only "mock" is created automatically`);
step(`provider ${provider.id} (${provider.type})`);

// The buildingId is the whole point of the `agents` grouping: the city attributes spend to a
// building through it, and an agent created without one is invisible to the city HUD even
// though its usage record exists.
const agent = await api(
  "POST",
  "/api/v1/agents",
  { name: `${stamp} agent`, buildingId, projectId: project.id, providerId: provider.id, role: "pipeline probe", permissions: ["read"] },
  201,
);
assert.equal(agent.buildingId, buildingId, "agent did not keep its buildingId");
step(`agent ${agent.id} with buildingId ${buildingId}`);

const task = await api(
  "POST",
  "/api/v1/tasks",
  { projectId: project.id, agentId: agent.id, title: `${stamp} task`, prompt: "usage pipeline probe" },
  202, // accepted, not created: the worker picks it up asynchronously
);
step(`task ${task.id} created (${task.status})`);

// Subscribe before awaiting the task so no event is missed; `after=0` replays from the start
// anyway, which is what makes this safe either way.
const [stream, finished] = await Promise.all([collectStream(task.id), waitForTask(task.id)]);
assert.equal(finished.status, "completed", `task ${finished.status}: ${JSON.stringify(finished.error ?? finished.result)}`);
step(`task completed; ${stream.types.length} events: ${[...new Set(stream.types)].join(", ")}`);
assert.ok(stream.types.includes("task.started"), "no task.started event");
assert.ok(stream.types.includes("usage.updated"), "no usage.updated event");
assert.equal(stream.terminal, "task.completed");

const records = await api("GET", `/api/v1/usage?projectId=${project.id}&limit=100`);
assert.equal(records.total, 1, `expected exactly 1 usage record for this project, got ${records.total}`);
const record = records.items[0];
assert.equal(record.taskId, task.id, "usage record is not for this task");
assert.equal(record.providerId, provider.id, "usage record names a different provider");
step(`usage record ${record.id}: in=${record.inputTokens} out=${record.outputTokens} costSource=${record.costSource}`);

const after = await api("GET", "/api/v1/usage/summary");
assert.equal(
  after.totals.requests,
  before.totals.requests + 1,
  `summary requests did not advance (${before.totals.requests} -> ${after.totals.requests})`,
);
const providerRow = after.providers.find((row) => row.providerId === provider.id);
assert.ok(providerRow, "the new usage is missing from summary.providers");
const agentRow = after.agents.find((row) => row.agentId === agent.id);
assert.ok(agentRow, "the new usage is missing from summary.agents");
assert.equal(agentRow.buildingId, buildingId, "summary.agents lost the buildingId the city attributes by");
step(`summary.providers["${providerRow.name}"]: ${providerRow.requests} req, ${providerRow.inputTokens + providerRow.outputTokens} tokens`);
step(`summary.agents["${agentRow.name}"]: ${agentRow.requests} req, ${agentRow.inputTokens + agentRow.outputTokens} tokens, building ${agentRow.buildingId}`);

// A completed task that reports no token counts is the silent failure the city sees as "usage
// doesn't work": the request is counted, the ledger's token figure never moves. The mock
// runtime reports nulls by design, so this is a warning here and an assertion for a vendor.
const tokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
if (!tokens) {
  assert.equal(
    providerType,
    "mock",
    `provider ${providerType} completed a task but reported no token counts`,
  );
  console.log(
    `! the ${provider.type} runtime reported no token counts (unknownTokenRequests=${after.totals.unknownTokenRequests}); ` +
      "a city wired only to it records requests but zero tokens",
  );
}

console.log(`\nPipeline OK: task -> SSE -> usage_record -> summary.providers + summary.agents (${tokens} tokens)`);

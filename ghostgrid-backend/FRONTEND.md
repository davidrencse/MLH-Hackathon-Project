# Ghostgrid Backend — Frontend Integration Contract

This is the stable surface the cyberpunk-city frontend talks to. The frontend never
needs to know how Codex, Claude Code, DeepSeek, or a custom bot runs internally — it
only drives the REST + SSE endpoints below.

> Snapshot of the running backend as of 2026-10-11. The machine-readable source of
> truth is `GET /api/v1/openapi.json` (OpenAPI 3.1) — always re-pull that if anything
> here disagrees.

---

## Browser access

Browser requests carrying Origin are rejected by default. To connect a frontend,
set `GHOSTGRID_ALLOWED_ORIGINS` to its exact origin, for example
`http://localhost:5173,http://localhost:3000`. Unknown origins receive 403.
Allowed origins receive CORS headers on REST and SSE responses; OPTIONS preflight
is supported. Actual requests still require the bearer token when configured.
A dev proxy must strip the forwarded Origin header or include the frontend origin
in the allowlist. Ordinary rewrites preserve Origin on browser POST requests.
Origins must have no path or trailing slash. Cookie credentials are not enabled.

---

## Base URL & auth

- Default: `http://127.0.0.1:3001` (override with `PORT`, `HOST`).
- Versioned under `/api/v1`. `/health` is unversioned.
- **Auth:** if the server was started with `GHOSTGRID_API_TOKEN`, send
  `Authorization: Bearer <token>` on every request. On loopback with no token set,
  auth is disabled. The token is never returned by any endpoint.

## Response conventions

- Every entity is JSON: `{ "id": "<uuid>", "createdAt": "<iso>", "updatedAt": "<iso>", ...fields }`.
- **List** endpoints return `{ "items": [...], "total": <int> }` and accept
  `?limit` (1–500, default 100), `?offset` (default 0), and filters
  `?projectId= &agentId= &sessionId= &status=`.
- **Create** returns `201` with the entity. **Task submission** returns `202` with the
  queued task. `DELETE` returns `204`.
- Secrets are redacted from all responses and logs.

## Error shape

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "req-123" } }
```

| HTTP | code             | meaning                                   |
|------|------------------|-------------------------------------------|
| 400  | VALIDATION_ERROR | bad body/params (Zod)                     |
| 401  | UNAUTHORIZED     | missing/wrong bearer token                |
| 403  | FORBIDDEN        | workspace/path denied, or Origin rejected |
| 404  | NOT_FOUND        | no such record                            |
| 409  | CONFLICT         | e.g. config change while tasks active     |
| 500  | REQUEST_ERROR    | internal (message hidden)                 |

---

## The object model (map this to buildings)

```
Provider ── how to reach an AI/runtime (Codex | Claude | DeepSeek | openai-compatible | mock)
   └─ Agent ── a named config bound to one Provider + one Project (role, workspace, permissions)
        └─ Session ── an ongoing conversation/context for one Agent (survives restart)
             └─ Task ── one unit of work (prompt → result), streams events
Workflow ── a DAG of tasks across agents (plan → implement → review)
```

Suggested city mapping: **Provider/Agent = building**, **Session = a lit window / tab
inside it**, **Task = a drone carrying a job**, **Workflow = Router Spire coordinating**.

---

## Endpoints

### System
- `GET /health` → `{status:"ok"}`
- `GET /api/v1/status` → version, worker concurrency, storage
- `GET /api/v1/openapi.json` → full OpenAPI 3.1 spec

### Providers  `/api/v1/providers`
`POST` body:
```json
{
  "name": "DeepSeek Lab",
  "type": "deepseek",                 // mock | codex | claude | deepseek | openai-compatible
  "model": "deepseek-chat",           // required for deepseek/openai-compatible
  "baseUrl": "https://api.deepseek.com", // required for openai-compatible; defaulted for deepseek
  "apiKeyEnv": "DEEPSEEK_API_KEY",    // UPPER_SNAKE env var name — never the key itself
  "auth": "bearer",                   // bearer | none
  "concurrency": 2,                   // 1..32
  "timeoutMs": 300000,
  "parameters": { "temperature": 0.2, "maxTokens": 4096 },
  "pricing": { "inputPerMillion": 0.27, "outputPerMillion": 1.10 }
}
```
- `GET` (list), `GET /:id`, `PATCH /:id`, `DELETE /:id`
- `POST /:id/test` → `{ available, message?, models?, capabilities }` — probe before use.
  **Capabilities** tell the UI what the building can do:
  `{ inference, coding, streaming, resume, cancellation, tools, approvals }`.

### Projects  `/api/v1/projects`
`POST` `{ name, description?, workspace?, instructions? }`
(+ `GET`, `GET/PATCH/DELETE /:id`). `workspace` must be inside the server's allowlist.

### Agents  `/api/v1/agents`
`POST` `{ name, projectId, providerId, role?, workspace?, permissions: ["read"] }`
(`permissions`: `"read"` and/or `"write"`; write agents need a project workspace).
Project/provider of an agent are immutable — make a new agent to change them.

### Sessions  `/api/v1/sessions`
- `POST` `{ projectId, agentId, name? }` → `201` session.
- `GET` (list, filter by project/agent/building), `GET /:id`. Responses expose
  `buildingId`, name/status, native provider ID, messages and task counts.
- `GET /api/v1/agents/:id/sessions` and `POST` on the same path manage the
  conversations owned by a specific building. Creation accepts `{ name? }`.
- `PATCH /:id` `{ name?, status?: "active" | "archived", memory? }`; archive only idle sessions.
  `memory` saves notes (up to 16,000 characters) used in later turns. Edit notes only
  when no tasks are active. Missing native Codex/Claude sessions recover from saved
  text history; `lastRecovery` and `agent.session.recovered` report recovery.
  See [SESSIONS.md](SESSIONS.md) for restart, memory and recovery behavior.
- `POST /:id/resume` reactivates a session; `POST /:id/cancel` cancels its active tasks.
- `GET /:id/tasks` and `GET /:id/events?after=` expose scoped history.
- `POST /:id/messages` `{ prompt, title?, contextIds?, priority?, timeoutMs?, maxRetries? }` → **`202` a queued task** bound to the
  session. This is the "send a prompt to this tab" action. History + provider session
  id persist across restarts.

### Tasks  `/api/v1/tasks`
- `POST` full control:
```json
{
  "projectId": "...", "agentId": "...", "sessionId": "...optional",
  "title": "Build login", "prompt": "...",
  "priority": 0,                 // -100..100, higher first
  "dependencies": ["taskId"],    // wait for these to complete
  "contextIds": ["contextId"],   // inject project context entries
  "timeoutMs": 300000, "maxRetries": 0
}
```
→ `202` task. `GET` (list), `GET /:id`.
- `POST /:id/cancel` → aborts supported executions, marks `cancelled`.
- `GET /:id/events?after=<seq>&limit=` → replay this task's events (history for a
  reconnecting UI).
- `GET /:id/artifacts` → `{ items:[...] }`; fetch body via
  `GET /api/v1/artifacts/:id/content` (text).

**Task status** (drive building/drone state): `pending → queued → running →
awaiting_approval → completed | failed | cancelled`.

### Workflows  `/api/v1/workflows`
- `POST` `{ projectId, name, nodes: [{ key, agentId, title?, prompt, dependsOn: [] }] }`
  → validated DAG (cycles rejected). `GET` (list), `GET /:id`.
- Nodes also accept `sessionId`, `contextIds`, `priority`, `timeoutMs` and
  `maxRetries`. Use the same coding session for implementation and corrections
  to retain its worktree. Context and sessions must belong to the node's project
  and agent. Read-only review chains inherit the implementation workspace.
- `POST /:id/run` → spawns a task per node with dependency edges.
- `POST /:id/cancel`. Workflow status: `pending | running | completed | failed | cancelled`.

### Context (shared memory)  `/api/v1/projects/:id/context`
- `POST` `{ title, content, sourceTaskId?, agentId?, fileReference? }`, `GET` list.

### Monitoring  (for the dashboard / Monitoring Center)
- `GET /api/v1/usage` → `{ items:[ { taskId, inputTokens, outputTokens, costUsd?, ... } ], total }`.
  **Unknown usage is `null`, not `0`** — render "unavailable", never a fake number.
- `GET /api/v1/metrics?limit=100&offset=0` → task counts by status, `activeAgents`, capacity/utilization,
  `workflowCompletionRate`, per-provider availability, task durations.
  Counts cover all history; duration samples default to 100 records (maximum 500).
  `durationsTotal`, `durationLimit` and `durationOffset` describe the duration page.

---

## Live events — SSE

Two streams, both `text/event-stream`:

- `GET /api/v1/events/stream?after=<seq>&taskId=<optional>` — global firehose.
- `GET /api/v1/events?after=<seq>&limit=500` — REST history with optional
  `projectId`, `agentId`, `sessionId`, or `taskId` filters. Returns `{ items,
  nextCursor }`; pass `nextCursor` as the next `after`. A REST history response
  is finite and requires no streaming client.
- `GET /api/v1/tasks/:id/events` — REST replay for one task (not a stream).

Frame format:
```
id: 42
event: agent.output
data: {"id":"evt-uuid","seq":42,"type":"agent.output","taskId":"...","projectId":"...","agentId":"...","sessionId":"...","timestamp":"<iso>","data":{"text":"..."}}
```

Use the browser `EventSource`; it auto-sends `Last-Event-ID` on reconnect and the
backend resumes from that `seq` (so no events are missed). You can also pass `?after=`
manually. A `: heartbeat` comment arrives every 15s. Native `EventSource` cannot
set an Authorization header. With bearer authentication, use a fetch-based SSE client
with that header or a trusted server proxy that supplies it; do not put tokens in URLs.

**Event types** the UI should handle:

| type | drive this in the city |
|------|------------------------|
| `task.created`, `task.queued` | drone spawns / queue indicator |
| `task.started` | building lights ON |
| `agent.connected` | session link established |
| `agent.output` | scrolling text in window (`data.text`) |
| `agent.tool.started` / `agent.tool.completed` | mechanical arm / tool animation |
| `agent.file.changed` | file write pulse |
| `agent.approval.required` | ⚠ approval badge (write ops are gated) |
| `agent.workspace.created` | isolated worktree made |
| `usage.updated` | token/cost tick |
| `task.completed` | completion animation |
| `task.failed` | 🔴 red alert (`data.error.{code,message}`) |
| `task.cancelled` | building goes idle |
| `provider.created`/`updated`/`deleted`, `project.*`, `agent.*` | committed topology changes; project and agent changes include project scope |
| `session.created`, `session.updated`, `session.archived`, `session.resumed` | building session manager updates |
| `library.connected`, `library.disconnected`, `context.created` | library connection and shared context updates |

Every event carries `id`, `seq`, `timestamp`, `type`, and relevant
`taskId`/`sessionId`/`agentId`/`projectId`.

---

## Minimal first-connection flow (happy path)

```
POST /api/v1/providers  { name:"Mock", type:"mock", concurrency:2 }      → providerId
POST /api/v1/projects   { name:"Demo" }                                   → projectId
POST /api/v1/agents     { name:"Worker", projectId, providerId }          → agentId
POST /api/v1/sessions   { projectId, agentId }                            → sessionId
open EventSource /api/v1/events/stream
POST /api/v1/sessions/:sessionId/messages { prompt:"hello" }              → 202 taskId
   ↳ watch task.started → agent.output → task.completed on the stream
GET  /api/v1/tasks/:taskId                                                → result
```

The `mock` provider needs no credentials and is perfect for building/testing the UI
before real API keys exist. `[delay:2000]`, `[fail]`, `[transient]` in a mock prompt
force those behaviors.

---

## Custom bots (seed data available now)

`/api/v1/bots` isn't wired yet (owned by Codex), but a **demo bot catalog** already
exists to populate the city: `examples/bots/catalog.json` plus six runnable scripts
(trading, security, monitoring, automation) across different districts. The frontend can
read `catalog.json` directly to spawn bot buildings today, then switch to `/api/v1/bots`
when it lands. Each bot emits NDJSON events (`bot.log`, `bot.metric`, `bot.signal`,
`bot.alert`, `bot.item`) that map onto the same SSE/monitoring model as agent tasks. See
`examples/bots/README.md`.

## Not yet on the contract (coming from Codex)

- **Custom Bots API** (`/api/v1/bots`) — start/stop, health, schedules. Runtime scripts +
  contract already staged in `examples/bots/`.
- Session pause while preserving a running execution; archive/resume is supported.

# Backend Review — for Codex

> Historical review snapshot. Findings 1–4 below have been addressed. Use
> [FRONTEND.md](FRONTEND.md), [TESTING.md](TESTING.md), and the live OpenAPI
> document for the current integration contract and verification instructions.
> The standalone bot examples still do not constitute a managed bot API.

Review of the live backend (2026-10-11) focused on **frontend connectability**. Typecheck
clean, 29 tests pass, server boots on `:3001`. Findings ranked; #1 blocks the frontend.

---

## 1. 🔴 BLOCKER — CORS: every browser request is 403'd

`src/app.ts` (onRequest hook):
```ts
if(req.headers.origin) fail(403,'Cross-origin browser requests are disabled; use a same-origin proxy');
```
Reproduced: `curl -H "Origin: http://localhost:5173" /health` → **403**. A browser app
on any dev origin (Vite `:5173`, Next `:3000`) can't call the API at all. Even a prod
SPA on a different host is locked out.

The intent (block CSRF/drive-by SSRF from random web pages) is right, but a blanket
reject is too broad. **Replace with an origin allowlist + preflight handling:**

- Add config `allowedOrigins: string[]` from `GHOSTGRID_ALLOWED_ORIGINS`
  (comma-separated; empty = none). Default dev value e.g.
  `http://localhost:5173,http://localhost:3000`.
- In `onRequest`: if `req.headers.origin` is **present and not in the allowlist** → keep
  the 403. If present and allowed, continue and set CORS response headers.
- Handle `OPTIONS` preflight: respond `204` with
  `Access-Control-Allow-Origin: <echo origin>`,
  `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`,
  `Access-Control-Allow-Headers: authorization,content-type,last-event-id`,
  `Access-Control-Max-Age: 600`. Add `Vary: Origin`.
- For allowed actual requests, set `Access-Control-Allow-Origin: <echo>` (+ `Vary:
  Origin`). Only add `Access-Control-Allow-Credentials: true` if you decide to use
  cookies — you use bearer tokens, so credentials can stay off.
- SSE (`/api/v1/events/stream`) needs the same `Access-Control-Allow-Origin` header on
  its hijacked raw response, or `EventSource` cross-origin fails.

`@fastify/cors` does all of this if you'd rather not hand-roll (origin can be a function
= the allowlist). Either way: **allowlisted origins pass, unknown origins still 403.**

Until this lands, the frontend must use a same-origin dev proxy (documented in
`FRONTEND.md`).

## 2. 🟡 Sessions emit no `.created` event

`providers/projects/agents` emit `*.created`/`*.deleted` (app.ts create loop), but
`POST /sessions` inserts directly (app.ts ~L76) with no `store.event(...)`. The global
SSE firehose therefore never announces a new session, so the city can't light a new
window reactively — the UI has to poll `GET /sessions`. Suggest emitting
`session.created` (and on delete if you add it) for parity.

## 3. 🟡 PROVIDERS.md promises config the schema rejects

`PROVIDERS.md` tells users to set `supportsModelDiscovery:false` / `supportsStreaming:
false` on a provider, but `providerSchema` in `src/api-schemas.ts` is `.strict()` and has
no such fields → those bodies 400. And `OpenAICompatibleAdapter` always streams and
always hits `/models` for deepseek regardless. Either add the fields to the schema +
`ProviderConfig` + adapter logic, or drop them from the doc. Right now doc and code
disagree.

## 4. 🟡 Missing README + `.env.example` (Definition of Done)

No `README.md` or `.env.example` yet. DoD requires: one documented start command +
documented env. Env vars in use (from `config.ts`): `HOST`, `PORT`,
`GHOSTGRID_API_TOKEN`, `GHOSTGRID_DATA_DIR`, `GHOSTGRID_DATABASE_PATH`,
`GHOSTGRID_ALLOWED_WORKSPACES`, `GHOSTGRID_CONCURRENCY`,
`GHOSTGRID_PROVIDER_CONCURRENCY`, `GHOSTGRID_TASK_TIMEOUT_MS`, `GHOSTGRID_MAX_ATTEMPTS`
(+ the proposed `GHOSTGRID_ALLOWED_ORIGINS`). Plus provider key vars like
`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`.

## 5. 🟢 Bot Runner not implemented (owned by Codex)

`/api/v1/bots` and the Python/Node/HTTP runtime from the latest plan aren't present.
Stated top-3 priority. When adding: reuse the task/session/event model so a bot is just
another managed runtime; keep `usage`/events consistent; paper-trading default, live
trades behind separate creds + explicit approval.

**Seed material is ready for you in `examples/bots/`**: `catalog.json` (6 bots across
districts) + runnable stdlib-only scripts (paper trader, market signal, log watchtower,
healthcheck, RSS watcher, commit watcher), all emitting NDJSON on stdout. The intended
`POST /api/v1/bots` body shape and a spawn/supervise checklist (no shell interpolation,
line-parse stdout → events, SIGTERM/SIGKILL, schedule, paper-only trading) are in
`examples/bots/README.md`. Seed the catalog on first run so the city opens populated.

---

## Not bugs — confirmed good

- Durable scheduler fails interrupted (`running`) tasks on restart instead of replaying
  side effects. Correct for non-idempotent work.
- Secret redaction in logs + responses; bearer compared with `timingSafeEqual`.
- Workspace allowlist + symlink-escape checks in `security/index.ts`.
- Write agents run in isolated git worktrees; Claude/Codex write ops gated behind
  approval events (no silent autonomous edits). Documented honestly in `PROVIDERS.md`.
- SSE resumable via `Last-Event-ID` / `?after=` seq cursor.
- Unknown token usage stored as `null`, never faked `0`.

## Housekeeping

- This repo is **not** a git repo yet; consider `git init` so your and the frontend
  dev's work is tracked.
- Package manager is pnpm (`packageManager` field). I used `npm install` to verify and
  removed the stray `package-lock.json` I created — if a `pnpm-lock.yaml` should exist,
  run `pnpm install` to generate it.

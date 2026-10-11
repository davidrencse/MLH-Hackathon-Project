# Ghostgrid Backend — Security Scan

Date: 2026-10-11 · Scope: `ghostgrid-backend` (src + `examples/bots`, dependencies, config).
Method: dependency audit, static dangerous-pattern sweep (shell/exec, eval, SSRF, SQL,
secrets), and manual review of auth, CORS, path handling, process spawning, and the
coding-agent sandboxes.

> The repo was being actively edited by Codex during the scan, so line numbers reflect a
> moving snapshot. Findings are about patterns/architecture, which are stable.

## Verdict

**Strong security posture for a local-first MVP.** No high/critical issues in the
project's own code. SQL is parameterized, paths are traversal- and symlink-guarded,
secrets are redacted and env-sourced, coding agents run sandboxed, and the server binds
loopback-only unless a token is set. Items below are hardening, mostly relevant only if
this is ever exposed beyond localhost or made multi-user.

---

## Findings (ranked)

### 1. 🟡 MEDIUM — Optional SDKs pinned to `latest` (supply chain)
`package.json` `optionalDependencies` pin `@openai/codex-sdk` and
`@anthropic-ai/claude-agent-sdk` to **`latest`**. `latest` resolves to whatever is newest
at install time, pulling unpredictable transitive dependencies — this was the source of
the moderate/critical advisories seen on the first `npm install`. A compromised or broken
release would land silently.
**Fix:** pin exact versions (e.g. `"@openai/codex-sdk": "0.x.y"`), commit the
`pnpm-lock.yaml`, and bump deliberately. Keep a lockfile in git so installs are
reproducible and auditable.

### 2. 🟢 LOW — `esbuild` dev-server advisory (dev dependency)
`npm audit`: **1 low** — esbuild `GHSA-g7r4-m6w7-qqqr` (arbitrary file read via the
dev server, **Windows only**). Reaches the project transitively through `tsx`, `vitest`,
`drizzle-kit`. Not exploitable here: Linux, and esbuild's serve mode isn't used.
**Fix:** `npm/pnpm audit fix` (or a `tsx`/`vitest` bump) clears it; otherwise ignorable.

### 3. 🟢 LOW — No rate limiting / request throttling
The HTTP API has `bodyLimit: 1 MB` but no per-client rate limit. Fine on loopback. If you
ever set `GHOSTGRID_API_TOKEN` and bind to a LAN/public address, add a rate limiter
(`@fastify/rate-limit`) so a leaked token can't be brute-forced or used to exhaust the
task queue / spawn runaway agents.

### 4. 🟢 LOW — SSRF surface in provider/library `baseUrl` (operator-configured)
`providers/openai-compatible.ts` and `library/service.ts` `fetch` operator-supplied
`baseUrl`s. Already well-contained: HTTPS required (loopback HTTP allowed for local
models), no credentials/query/fragment in the URL, `redirect: "error"`, response size
caps, secret redaction. Residual risk: a configured base URL could still point at an
internal host or a cloud metadata endpoint (`169.254.169.254`). Only someone who can
create providers (today: the local operator) can do this, so risk is low now.
**If this becomes multi-user:** block link-local/metadata and private IP ranges at
config time, and treat provider creation as a privileged action.

### 5. 🟢 LOW — Custom-bot runner (not built yet) must spawn safely
`examples/bots` scripts are clean: secrets via env only (`GITHUB_TOKEN`,
`*_API_KEY`), read-only outbound GETs, response size caps, `SIGINT`/`SIGTERM` handling,
no shell use. The **risk is in the future Bot Runner** that will launch them. It must:
- spawn with `spawn(cmd, argsArray)` / `execFile` — **never** a shell string (no
  `shell: true`, no string interpolation into a command);
- pass only an explicit allowlist of env vars (don't leak the whole backend env, which
  holds API keys, into every bot);
- cap stdout length and parse defensively (bot output is untrusted);
- keep trading bots paper-only; gate live trading behind separate creds + approval.
(These are already written up in `examples/bots/README.md`.)

---

## Confirmed good (no action)

- **CORS**: fixed since the first review — strict origin **allowlist**
  (`GHOSTGRID_ALLOWED_ORIGINS`), preflight handled, header echoed on both normal and SSE
  responses, unknown origins `403`. Set the env var to your frontend origin(s).
- **Auth**: bearer token compared with `timingSafeEqual` (no timing leak); remote
  (non-loopback) binding *requires* a token or the server refuses to start; token is
  registered as a secret and redacted from logs/responses.
- **Default bind**: `127.0.0.1` — not exposed to the network out of the box.
- **SQL**: every query parameterizes values with `?`; table names are checked against a
  fixed whitelist before interpolation → no SQL injection.
- **Path safety**: `security/index.ts` resolves real paths, rejects absolute paths, `..`
  traversal, and symlinks that escape the workspace (incl. new files under an escaping
  parent symlink). Workspaces are confined to an explicit allowlist.
- **Secrets**: never stored in SQLite or returned by the API; loaded from env by name
  (`apiKeyEnv`); redaction walks responses/logs and strips known secret values and
  `authorization`/`apiKey`/`password`/etc. keys. Repo secret-scan: **clean**;
  `.env`/`*.sqlite`/`*.db`/logs are git-ignored; `.env.example` holds placeholders only.
- **Coding agents sandboxed**: Codex runs read-only sandbox, `approvalPolicy: untrusted`,
  network + web search disabled; Claude limited to Read/Glob/Grep with per-call workspace
  checks, Edit/Write denied and surfaced as approval-required events, Bash/WebFetch/
  WebSearch/subagents disallowed, project settings + MCP not loaded. Write agents operate
  in isolated detached git worktrees, verified owned + clean before use. `git` is invoked
  via `execFile` with array args (no shell).
- **Durability**: tasks interrupted by a restart are marked `failed`, not silently
  replayed — avoids re-running non-idempotent side effects.

---

## Recommended next steps

1. Pin the two SDK versions and commit `pnpm-lock.yaml` (finding 1).
2. `pnpm audit fix` for esbuild (finding 2).
3. Before any non-loopback exposure: set a strong `GHOSTGRID_API_TOKEN`, add rate
   limiting, and restrict provider creation (findings 3–4).
4. Carry the spawn-safety rules (finding 5) into the Bot Runner when Codex builds it.

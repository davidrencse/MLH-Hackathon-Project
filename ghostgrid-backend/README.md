# Ghost Grid backend

Local TypeScript/Fastify backend for providers, projects, agents, persistent sessions,
queued tasks, dependency workflows, artifacts, usage and resumable SSE events.
SQLite stores state; coding agents use isolated Git worktrees. There is no frontend
or managed bot runner in this folder. Example bots are standalone scripts.

## Start

Requires Node >=22.13 and pnpm 10.18.3.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm start
```

Default address: `http://127.0.0.1:3001`. `GET /health` checks readiness;
`GET /api/v1/openapi.json` exposes request schemas. `pnpm dev` watches source;
`pnpm build && pnpm start:built` runs compiled output. The build copies SQL migrations.
With existing dependencies installed, `npm run start`, `npm test`, `npm run check`,
`npm run build` and `npm run demo` also work.

`pnpm demo` exercises project/provider/agent/session/task/events/metrics integration
using a mock provider and a temporary database, without credentials or a listening port.

For the read-only Library of Babel shared-context integration, see [LIBRARY.md](docs/LIBRARY.md).

Each agent/building owns multiple named persistent sessions. Create them through
`POST /api/v1/agents/:id/sessions` and list them through the same path, or filter
`GET /api/v1/sessions?projectId=...&buildingId=...`. Sessions expose their current
building ID and task counts. Rename/archive with `PATCH /api/v1/sessions/:id`,
resume with `POST /:id/resume`, and cancel its active work with `POST /:id/cancel`.
`POST /:id/messages` accepts `prompt`, `title`, explicit `contextIds`, priority,
timeout and retry limits. Archived sessions reject new messages until resumed.

Workflow nodes accept their own `sessionId` and `contextIds` along with task
controls. Reuse the implementation session for a correction node to preserve
its coding-agent worktree. Dependencies pass completed outputs to later nodes;
read-only reviews inherit the implementation workspace. Worktree integration
into the original repository remains an explicit manual step.

## Configuration

`.env` is loaded by start/dev commands. Paths are relative to the process working directory.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address; remote binding requires an API token |
| `PORT` | `3001` | Listen port |
| `GHOSTGRID_API_TOKEN` | unset | Bearer token required on actual requests when set |
| `GHOSTGRID_DATA_DIR` | `data` | Database/artifact directory |
| `GHOSTGRID_DATABASE_PATH` | `<dataDir>/ghostgrid.sqlite` | SQLite path |
| `GHOSTGRID_ALLOWED_WORKSPACES` | empty | Comma-separated filesystem roots available to coding agents |
| `GHOSTGRID_ALLOWED_ORIGINS` | empty | Exact comma-separated browser origins, e.g. `http://localhost:5173` |
| `GHOSTGRID_CONCURRENCY` | `4` | Global active task cap, 1–32 |
| `GHOSTGRID_PROVIDER_CONCURRENCY` | `2` | Fallback provider cap; provider configuration overrides it |
| `GHOSTGRID_TASK_TIMEOUT_MS` | `300000` | Default task deadline; explicit task timeout overrides it |
| `GHOSTGRID_MAX_ATTEMPTS` | `3` | Default total attempts, 1–4; explicit task `maxRetries` overrides it |

Retries require a transient provider failure and a read-only inference task. Coding
side effects are never automatically replayed. Provider timeouts still cap adapter
execution independently of task deadlines. Sessions serialize conversation turns;
tasks sharing a configured workspace serialize access. One process owns a file database.

Provider credentials stay in environment variables referenced by `apiKeyEnv` or
`headersEnv`, such as `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.
The mock provider needs none. See [PROVIDERS.md](docs/PROVIDERS.md) for adapter capabilities
and [FRONTEND.md](docs/FRONTEND.md) for frontend integration.

Metrics counts cover all task history. Duration samples are paginated with
`GET /api/v1/metrics?limit=100&offset=0` (maximum 500); the response includes
`durationsTotal`, `durationLimit` and `durationOffset`. Session summaries and event
scope filters run in SQL. Versioned migrations upgrade existing databases on startup.

`GET /api/v1/events?after=0&limit=500` provides durable event history without an
open streaming connection. Filter by `projectId`, `agentId`, `sessionId` or
`taskId`, then pass the returned `nextCursor` as `after` for the next page or SSE
connection. Library connections/imports and ordinary context creation emit
project-scoped events after their state commits.

## Verification

```sh
pnpm verify
```

With dependencies already installed, `npm run verify` runs the same checks. The
verification script uses whichever package manager launched it and stops at the
first failure or interruption.

This runs typechecking (including TypeScript utility scripts), JavaScript/Python
syntax checks, tests, the production build, compiled HTTP/persistence smoke checks,
the complete HTTP integration check, and the mock integration demo. Individual checks are also available:

```sh
pnpm test
pnpm check
pnpm check:scripts
pnpm build
pnpm test:built
pnpm test:http
pnpm demo
pnpm exec tsx scripts/benchmark-storage.ts
```

See [TESTING.md](docs/TESTING.md) for feature coverage, real HTTP verification, and
the distinction between deterministic SDK fixtures and live provider checks.

Normal tests use mock providers, temporary storage and local HTTP fixtures. Live provider
smoke tests require `GHOSTGRID_LIVE_TEST=1` and matching credentials; see docs/PROVIDERS.md.
The benchmark compares the previous whole-table scan with indexed filtering against
10,000 synthetic tasks in memory. It never opens application data.

See [AUDIT.md](docs/archive/AUDIT.md) for audit findings, verified fixes and remaining limits.
See [SECURITY.md](SECURITY.md) for backend validation, credential handling and
deployment boundaries.
See [SESSIONS.md](docs/SESSIONS.md) for persistent Codex/Claude conversations, editable
session notes and recovery when native session files are unavailable.
See [OFFICE.md](docs/OFFICE.md) for the office layer: editable job roles and the prompt each
one carries, promotion and reporting lines, and how the org chart is run as a task graph.

## Continuous integration

[CI](.github/workflows/ci.yml) runs on pushes, pull requests and manual dispatches
on Ubuntu with Node 22 and 24, pnpm 10.18.3 and Python 3.12. It installs from the
frozen lockfile and runs the verification checks above. A successful Node 24 job
uploads `dist/`, `package.json` and `pnpm-lock.yaml` for seven days. The artifact
requires installation of production dependencies before running `dist/server.js`.

[Dependency security](.github/workflows/security.yml) audits all locked dependencies
on pushes, pull requests, manual dispatches and Mondays at 08:17 UTC; high and
critical advisories fail the job. Dependabot checks npm packages and pinned GitHub
Actions weekly. Workflows use read-only repository permissions and require no
provider credentials. Paid provider tests are explicitly disabled in CI.

A separate CI job runs both Python bridge tests on Python 3.14 against the pinned
upstream checkout with pinned test dependencies. It verifies read-only HTTP behavior
and preservation of source metadata. Locally, that test requires the checkout and
dependencies described in [LIBRARY.md](docs/LIBRARY.md).
See [CI-AUDIT.md](docs/archive/CI-AUDIT.md) for validation evidence and audit limits.

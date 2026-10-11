# GhostGrid project audit — 2026-10-11

## Assessment

GhostGrid combines a substantial local agent orchestration backend with a visually elaborate city frontend. The backend implements durable tasks, provider adapters, sessions, workflows, artifacts and events. The frontend has real REST/SSE integration and a new native worker office, but much of its original game state machine still simulates work. A reachable backend does not establish that displayed activity came from a real model or that the selected browser key/model controlled execution.

The main engineering priority is making displayed state and actions agree with actual execution. More visual features will not resolve this gap.

Scope: repository inventory, application architecture and critical execution flows, frontend/backend contracts, persistence, provider configuration, native offices, example bots, library integration, build/test scripts, CI, documentation, performance and accessibility concerns visible in source. This is a source and automated verification audit, not a claim that every line was reviewed or a browser accessibility certification. Dependencies' internal implementations were not audited.

The shared workspace changed during inspection. Both the missing OfficePage and a backend office response type error were corrected by concurrent edits; they are historical observations, not final open build findings. The current office page also changed from reusing a simulated modal to a real native worker interface. No application fixes were made as part of this audit. Builds generate normal dist/cache artifacts; tests use fixture data.

## Verification evidence

| Check | Observed result |
| --- | --- |
| Frontend production build | Pass on latest completed build; Vite warns about large chunks |
| Frontend lint | Exit 0 with 43 warnings in latest lint run |
| Backend full TypeScript check | Pass after concurrent correction |
| Backend production build | Pass after concurrent correction |
| JavaScript/Python utility syntax | Pass |
| Backend unrestricted test suite | 229 passed, 6 failed, 3 skipped, 238 total; 13 files passed, 1 failed, 1 skipped |
| Newly added office test file | 4 passed; run separately after the suite snapshot |
| Compiled backend smoke | Pass: HTTP/authentication/migrations/persistence |
| Compiled HTTP integration | Pass: CORS, sessions, context, workflows, SSE replay, artifacts, usage and restart persistence |
| Mock integration demo | Pass; completed task and durable execution events |
| Browser fixture focused rerun | 8 passed, 6 failed, reproducing the suite failures |
| Paid live providers | Not exercised; 3 explicitly opt-in tests skipped |
| Actual native terminal/browser launch | Not exercised; office tests use an injected launcher |
| Actual upstream Python news collection | Not exercised in this audit |
| Browser rendering/mobile/keyboard inspection | Not performed |

The initial sandboxed suite had 13 failures and loopback listen EPERM errors. Rerunning outside the sandbox resolved the seven bot/local HTTP integration failures. The six browser fixture failures persisted and must be treated as real verification failures. Do not characterize the suite as green.

Evidence logs are under /tmp/ghostgrid-*-audit-*.log. Main logs: backend-audit-tests-unrestricted, backend-audit-check-final, backend-audit-build-final, backend-audit-built-smoke, backend-audit-http, backend-audit-demo, frontend-audit-build-latest and frontend-audit-lint-final.

## Application structure

- `dev.sh` launches the sibling backend and frontend applications, skipping already reachable services.
- `ghostgrid-frontend/frontend` is React 19, TypeScript, Vite, Tailwind, Zustand, React Router, Framer Motion, Recharts and React Three Fiber/Three.js.
- `ghostgrid-backend` is Fastify, TypeScript, Zod and synchronous Node SQLite, with Drizzle schema declarations, SQL migrations and optional coding SDKs.
- The library bridge is a separate Python process requiring a pinned upstream checkout and its dependencies.
- Example bots are six standalone Python/Node scripts, not managed workers inside the backend engine.

Frontend source was approximately 22,600 lines across 138 files during inventory; backend application source approximately 6,000 lines across 23 files. Counts are moving with concurrent edits and exclude installed dependencies.

Routes include the city `/`, native offices `/office/:buildingId`, and dashboard overview, agents, agent details, activity and keys under `/dashboard`. Legacy `/console/*` URLs redirect to dashboard sections.

The city is a low-resolution isometric Three.js scene with custom buildings, roads, scenery, vehicles, drones, labels and effects. It has a lazily loaded 2D fallback when WebGL is unavailable. The rain effects were removed in the preceding task. The visual identity is intentionally pixel art, with Press Start 2P and VT323, neon status accents and a fixed night palette.

## Real backend behavior

The domain model is Provider → Agent → Session → Task, scoped through projects; workflows define dependency graphs across agents. Providers determine how execution happens. Agent roles/workspaces/permissions constrain a configuration. Sessions own durable conversation history and native provider IDs. Tasks represent queued work and results.

The engine supports priorities, dependencies, global/provider concurrency limits, session serialization, serialization for agents sharing a configured workspace, cancellation, task deadlines and selective transient retries. It polls pending/queued tasks every 25 ms. Indexed status lookups avoid decoding all completed tasks on each poll, but a large waiting queue still incurs repeated scheduling work.

On restart, interrupted running/approval tasks are marked failed rather than blindly replayed. Writing agents require a clean allowlisted Git repository; work executes in detached worktrees under the artifacts directory. Sessions can reuse their worktrees, and downstream read-only reviewers inherit implementation workspaces. Integrating changes into the original repository is manual. Therefore a city log saying a task was merged does not correspond to an engine merge operation.

SQLite persists projects, providers, agents, sessions, tasks, workflows/nodes/dependencies, events, artifacts, usage and context. Foreign keys, migrations, WAL, indexes and transaction handling are implemented. A file database has one owning backend process. This is a reasonable local architecture; it is not a horizontally scalable distributed worker service.

The backend exposes scoped REST event history and resumable SSE cursors. Compiled integration verification exercised the actual HTTP/persistence path with mock execution. That provides meaningful backend evidence, while leaving native account authentication and vendor interfaces unverified.

## Provider and credential behavior

Implemented backend adapters include mock, Codex, Claude, DeepSeek, OpenAI-compatible gateways and browser sessions for ChatGPT/Claude/DeepSeek.

Codex uses the optional SDK with read-only/workspace-write mode, restricted network/search and an untrusted approval policy. Claude uses constrained SDK tools and path/tool checks; denied actions report approval-related events with `liveApprovalSupported: false`. Browser adapters automate a signed-in Chrome interface via loopback DevTools and DOM selectors; they are a separate path from opening a browser window in an office. Their declared usage is unknown, which the backend preserves as null.

Backend provider secrets are environment references rather than plaintext provider records. The frontend separately stores user-entered provider keys/model choices in localStorage. Those settings are not installed into backend provider configuration. A connection test chooses a backend provider by family and tests its server-side credentials, not the exact pasted browser key or its custom base URL.

Frontend bootstrap ensures a project, a credential-free mock provider, and agents for the fixed building IDs. Existing agents are reused. Newly created agents are bound to the mock provider with read permission. Building names such as Codex or Claude do not determine provider execution. Latest command submission targets the Codex agent, but this agent may still be mock-backed. Playground parameters are ignored by the live adapter.

## Findings requiring action

### F1 — High: live failures silently become simulated success

`frontend/src/api/client.ts:56` catches any live operation error and calls its mock counterpart. This applies to task submission, approval/rejection and playground, as well as reads. A failure after a real task has been submitted can leave real work running while the browser displays mock output. Empty live histories also become seeded histories.

Use explicit demo/live modes. In live mode, surface action failures and preserve task IDs; reserve simulation for explicitly selected demo mode. Empty real data should stay empty.

### F2 — High: task visuals and approvals still describe invented work

`frontend/src/store/grid.ts:205` runs fixed timing and log messages after submission. It claims a repo was read, App.tsx patched, a build run, and deletion requested regardless of provider events. Approval reports deletion, 24 passing tests and a merge without executing or verifying those operations.

`frontend/src/api/liveOps.ts:40` makes approval mean polling until a task is terminal. There is no backend human approval/resume endpoint. The security building's button cannot authorize a denied tool call. A failed/cancelled task can still be wrapped into the city's done flow.

Drive phase, logs, approvals, file lists and outcome from backend state. Either implement real approval continuation or present denial as a final policy result. Do not report a merge without an actual integration operation.

### F3 — High: provider controls and execution configuration disagree

Bootstrap defaults to mock providers; browser keys/model changes do not patch backend provider/agent configuration; live playground ignores its parameter argument. The user can select a provider/model and obtain execution from another configuration.

Expose the actual provider type/model/capabilities of each agent. Configure server-side credential references and agent bindings through an explicit setup path. Connection tests should explain exactly which configuration they tested.

### F4 — High: history reads become stale and metrics are incomplete

`frontend/src/api/live.ts` frequently reads only the first event page, up to 1,000 events, and usage page, up to 500 records. Store event queries sort ascending by sequence. Reversing that first page does not yield the newest history after the dataset grows. getLogs similarly takes the tail of an early page.

Activity/usage failure counts read global events without project scope. Requests are synthesized from execution events with invented method/path/status and zero latency; they are not an HTTP request audit trail. Agent running state checks whether any historical start exists and whether any historical finish exists, so a prior completion can hide later active work. Unknown usage is converted to zero. Dashboard token splits use fixed base weights; grid cost/tokens/approval counts are seeded. The displayed budget is not enforced, and no actual midnight reset is implemented in the inspected state.

Use scoped backend task/metric APIs, complete pagination or explicit recent-history queries, measured durations and nullable usage. Label game currency and simulated resource calculations explicitly.

### F5 — High: six browser fixture tests fail

The fixture at `backend/tests/browser-session.test.ts:90` detects focus calls with an unescaped `"focus":true` regex. The adapter sends arguments through a JSON string literal containing escaped quotes at `src/providers/browser-session.ts:297`. A standalone reproduction shows the runtime argument parses correctly but the fixture regex returns false. This sends mocked evaluations through the wrong response queue and is a concrete explanation for several timeouts.

Fix the fixture to decode the argument contract rather than matching source text. Also verify expected sign-in diagnostics against the adapter's overall deadline; the outer abort can race a custom timeout message. These failures do not prove live browsers are broken, and they do not certify live browsers work.

### F6 — Medium: native office records do not supervise native processes

The new OfficePage and backend office routes launch real external windows using fixed argv and persist a worker record in a session. Launch requires a graphical desktop, installed applications and an allowlisted workspace for coding terminals. This will not work unchanged on a headless web host.

Launcher success means the application started/handed off, not that it authenticated, accepted work or remains alive. Deleting a desk archives the record and explicitly does not kill the native application. Saved desks can therefore outlive their windows. Native coding terminals start directly in the selected folder and are distinct from engine-created worktrees and queued tasks.

Describe native launches as external applications. If actual supervision is required, add observable liveness, lifecycle identity and truthful stop behavior. Keep direct native execution and engine worktree execution clear.

### F7 — Medium: buildings and simulated sessions are transient

Grid building placement, renaming, demolition, game credits and simulated desks are in-memory Zustand state. Refresh recreates defaults. Creating a building does not create a backend agent; bootstrap maps fixed IDs only. A new building's playground can fall through to a missing/unrelated fallback agent and ultimately mock output.

The old OfficeView/SessionMenu uses mock session start/stop with fabricated token counts, while new native offices use real launch endpoints. The old startSession coroutine can mark a stopped desk done later because it checks existence rather than an abort/current status. Define one state model and persist backend-linked building/session identity.

### F8 — Medium: stream-to-city synchronization is incomplete

`frontend/src/store/live.ts` starts at the event tail without hydrating active tasks. Existing running work may be absent after refresh. Agent map refresh calls cached bootstrap, so it cannot discover changed topology without invalidation. Unknown-agent events are dropped; library/context events without an agent ID are ignored. One task's completion sets a building idle even if another task in that building is active. Errors update the message but leave cached reachability live.

Hydrate current state, scope subscriptions to the chosen project, refresh/invalidate topology on changes, derive building status from all active tasks and distinguish transport connectivity from cached health.

### F9 — Medium: credentials and credit presentation need clearer boundaries

Frontend `.gitignore` omits `.env`/`.env.*`; git check-ignore confirmed `.env.local` and `.env.production` were not ignored. `VITE_GG_API_TOKEN` is a browser-build value, so anyone allowed to load the app receives it. Backend auth is one broad bearer token, not per-user/per-project access control.

The development credits relay reads backend environment keys. Refreshing Groq quota submits a small real model completion. Client TTL caching does not impose server-side rate limiting across callers. An OpenAI spend result is encoded as a negative `balanceUsd`, then formatted and summed like prepaid balance. This mixes money already spent, remaining funds and quota in one meaning.

Ignore local frontend environment files. Treat browser-held credentials as such. Give spend, remaining balance and quota different fields/labels; cache/rate-limit quota probes server-side if exposing the dev server beyond the local machine. No dependency advisory scan was performed, so this report makes no claim about current package vulnerabilities.

### F10 — Medium: test and delivery coverage is uneven

The backend has broad tests and CI, but no frontend automated test setup or combined application acceptance check was found. Backend CI cannot catch mock fallback, invented approvals, selected-model mismatch or lost city state. Frontend production serving needs SPA route fallback and an explicit backend URL/reverse proxy: Vite's `/gg` proxy exists only in development. The credits relay likewise is a dev feature.

Add a small real integration acceptance path: configure provider/agent → create session → submit → observe output/usage → cancel → refresh and restore. Test failure states and concurrent task status. Use backend mocks deliberately as fixtures, not implicit product fallback.

## Other substantial limitations

- There is no managed bots API, scheduler, process lifecycle or bot-event ingestion. The towers copy the standalone catalog; endpoints are empty. All catalog kinds use trading-tower art while preserving their actual kind as metadata.
- The library backend is implemented as a read-only context source, but its external bridge and application frontend are separate services. Default library click opens localhost:8765; the documented bridge does not serve the full library frontend. Configure site and bridge URLs separately. Importing context requires explicitly attaching context IDs to a task; the command bar/playground do not expose this selection.
- Full session messages grow inside session JSON even though provider input uses a bounded recent window. Long sessions cause increasingly expensive serialization. Event/output/worktree retention needs an explicit policy.
- OS-level isolation remains necessary for untrusted native execution. Path checks and worktrees protect particular operations; they do not create a complete container boundary. Native office terminals are outside the task engine's supervision.
- `dev.sh` checks health without a token, so an already-running authenticated backend is not recognized by that check. It also checks a page response rather than application readiness and uses fixed default ports.
- Backend Git has staged/untracked work and no commit history yet; frontend has extensive modified/untracked integration work. A reproducible committed delivery snapshot is still needed.
- Frontend READMEs describe an old mock-only app, a backend folder that does not match the sibling layout, and routes no longer present. DESIGN.md also differs from current rendering details, such as the lack of real-time shadows. Backend audit documents record earlier snapshots and cannot replace current verification.

## Performance and UI observations

Latest production output includes a CityCanvas chunk around 1.12 MB minified / 305 KB gzip, plus substantial index/dashboard chunks. Routes and the city/fallback have lazy loading, and hidden-tab rendering stops; low resolution and instancing are good choices. A bundle-size warning alone is not proof of unacceptable performance. Mobile/device frame-rate, memory and context-loss behavior require browser profiling.

Lint's 43 warnings include material/camera mutation, useMemo patterns, impure render-time clocks, effect state and mixed exports. Some imperative mutations are normal Three.js practice and need contextual review rather than mechanical replacement.

The old office modal declares aria-modal without implementing a focus trap, initial focus or focus restoration in the inspected code. BuildingShell has motion/blink behavior without a reduced-motion guard even though several other components honor the preference. The scene needs a reliable keyboard alternative to pointer-based building navigation. Pixel-font labels are often 8px. These are source-visible accessibility risks; contrast, touch targets and real screen-reader behavior were not measured.

## Recommended sequence

1. Fix browser fixtures and make verification green on a reproducible snapshot.
2. Make demo/live modes explicit; remove mock fallback for live mutations.
3. Replace the scripted command/approval arc with actual task state and outcome.
4. Make provider/model/workspace/credential configuration control execution and expose actual capabilities.
5. Unify persistent building/session identity, then repair pagination, metrics and event hydration.
6. Define native-window supervision separately from queued agent execution.
7. Add frontend/backend acceptance checks, deployment configuration and accurate documentation.
8. Decide whether bot management and library context selection are required product features before adding more tower art.

The strongest existing asset is the backend's durable orchestration foundation. The largest remaining task is connecting the city's visible claims and controls to that foundation accurately.

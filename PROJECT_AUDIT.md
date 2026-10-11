# Ghost Grid project audit and working map

Reviewed 2026-10-11. Scope: the frontend, backend, example bots, launch script,
integration boundaries, and available verification suites. Existing uncommitted
work was preserved. This is a code and behavior audit, not a claim that live
authenticated provider execution or every third-party dependency was tested.

## How the project works

`dev.sh` starts two separate repositories. `ghostgrid-frontend/frontend` is a
React/TypeScript Vite app; `ghostgrid-backend` is a Fastify/TypeScript service.
The frontend proxies `/gg` to the backend on port 3001 during development.

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Routes | frontend `src/App.tsx` | City, offices, dashboard; old console URLs redirect |
| City | `src/city3d`, `src/constants.ts`, `src/store/grid.ts` | Three.js buildings, placement, drones, UI state |
| Offices | `src/city/office/OfficePage.tsx`, `OfficeRoom3D.tsx` | Real 3D voxel room, worker selection and native windows |
| API bridge | `src/api/config.ts`, `backend.ts`, `live.ts`, `liveOps.ts`, `client.ts` | Backend discovery, typed requests, city-to-agent mapping, optional mock fallback |
| Live events | `src/store/live.ts`, `src/api/backend.ts` | Durable SSE events update building logs and status |
| Dashboard | `src/console` | Agents, activity, keys, summaries |
| Backend API | backend `src/app.ts`, `src/api-schemas.ts`, `src/openapi.ts` | Validation, authentication, resources, REST/SSE routes |
| Persistence | `src/db/store.ts`, `schema.ts`, `migrations` | SQLite entities, indexed filters, transactions, process ownership |
| Execution | `src/execution/engine.ts` | Queueing, dependencies, limits, cancellations, workspaces, artifacts, usage |
| Sessions | `src/sessions/service.ts`, `src/providers/session-recovery.ts` | Named conversations, notes, native resume and bounded text-history recovery |
| Providers | `src/providers` | Codex and Claude SDKs, OpenAI-compatible inference, local browser adapters, mock provider |
| Native workers | `src/office/launcher.ts`, office routes in `src/app.ts` | Fixed-argument terminal/browser launches and saved desk metadata |
| Library | both repositories' library API/service files | Read-only Library of Babel integration and imported shared context |
| Bots | backend `examples/bots`, frontend `src/bots` | Standalone bot scripts represented by city buildings; no managed bot runner |

## Changes completed in this pass

- Added Cursor Studio to the building catalog, 3D art, construction menu, office
  flavor and console mappings. Codex, Claude, DeepSeek and Groq remain available.
- Separated Groq's lot from the paper-trading bot's lot.
- Codex and Claude buildings now enter `/office/:buildingId`; clickable labels
  also provide a keyboard-accessible entry. Codex's 2D fallback enters its office.
- Offices use genuine Three.js voxel geometry, an orthographic isometric camera,
  lighting/shadows, drag rotation, zoom, responsive controls and worker selection.
- Each new worker launches its own Codex/Claude terminal or ChatGPT/Claude browser
  window. Desk metadata is saved in SQLite. Workers can open another window or
  archive their desk. Missing prerequisites return actionable errors.
- Typing, head movement, cursor blinking and monitor commands are ambient
  animations. They never send or execute commands, and honor reduced motion.
- Fixed Vite's extensionless NodeNext configuration import.
- Repaired the browser test fixture's double-encoded argument parsing and page
  state persistence. Tests now exercise successful recovery instead of expecting
  the missing-session error to escape recovery. A ready browser page without a
  composer now reports sign-in guidance when its timeout expires.
- Restarted the stale backend and verified the office options endpoint. The local
  backend workspace allowlist now includes `/home/czr/projects/hackathon`.

## Remaining findings

| Priority | Finding | Effect / next step |
| --- | --- | --- |
| High | `api/client.ts` falls back to mock responses after live failures | Production failures can look successful. Make demo mode explicit and let live mutations report errors. Native office endpoints already bypass this fallback. |
| High | `store/grid.ts` still runs a timed, hard-coded command/approval story | Its reported file edits, deletion request and test results do not describe arbitrary real tasks. Drive the main city workflow from backend task events. |
| Medium | `api.startSession` and `stopSession` still call mocks for the older modal offices | Those desks simulate execution. Codex/Claude's new routed offices use native launches instead. Migrate the remaining offices to real session APIs. |
| Medium | `store/keys.ts` uses the first key as a fallback for every building | A building can appear configured with an unrelated provider's key. Resolve by provider family or require an explicit assignment. Browser-held keys are separate from backend environment credentials. |
| Medium | Player-built city buildings live in the in-memory grid store | Reloading loses custom placement; direct office URLs for those buildings cannot reconstruct them. Persist buildings and reconcile them with backend agents. |
| Medium | Live usage/log queries can return seeded demo history when no real data exists | Empty real data should remain empty or be clearly identified as illustrative. |
| Low | Three.js renderer warnings and existing React lint warnings remain | Review compatibility between Three.js/R3F versions and distinguish imperative Three.js mutations from actual React problems. The 3D shared bundle remains large despite route splitting. |
| Low | Several architecture comments and the frontend README describe older layouts/mock-only behavior | Keep documentation synchronized with live integration and the expanded city. |

## Native worker boundaries

Native windows open on the machine hosting the backend, with its desktop session.
The launcher supports Kitty, Konsole, GNOME Terminal or xterm, and local browsers
or `xdg-open`. It passes fixed argv without a shell and validates coding folders
against `GHOSTGRID_ALLOWED_WORKSPACES`. Sign-in occurs inside the native apps.

Saved desks are launch metadata, not captured terminal transcripts. Native CLI
and website conversation history stays in those applications. Opening another
window starts fresh; removing a desk does not kill its independently opened app.
The backend rejects inference messages on these desk records so their mock
building provider cannot fabricate output for a native worker.

## Verification

- Backend `npm run verify`: passed typechecking, script syntax checks, 240 tests
  (3 live tests skipped), production build, compiled HTTP/persistence smoke,
  full HTTP integration checks and mock demo. No paid provider calls.
- Frontend production build: passed. Lint completed with existing warnings;
  imperative camera mutation also follows the existing R3F pattern.
- Browser verification uses a real Chromium renderer, an isolated backend and a
  fixture native launcher. It covers add/select/reopen/remove, reload persistence,
  office isolation, desktop/mobile widths, provider placement and office entry.
  It deliberately does not launch authenticated external apps.

Useful backend references: `README.md`, `FRONTEND.md`, `SESSIONS.md`, `LIBRARY.md`,
`TESTING.md`, `AUDIT.md`. Frontend visual authority is `frontend/DESIGN.md`.

# Ghost Grid

**Build your city. Command your agents.**

A cyberpunk pixel city that visualizes AI agents at work. Every building is an agent. Type a command, watch a drone fly from the Router Spire to Codex Tower, approve a risky action at the Security Checkpoint, and get the result back. A second page (`/console`) is an API-platform style console: agents, request logs, usage, API keys, playground.

The app connects to the adjacent Ghost Grid backend through the Vite `/gg` proxy.
Some city flows retain demo data; Codex and Claude offices launch real native windows.

## 3D worker offices

Click Codex Tower or Claude Nexus to enter its isometric voxel office, or visit
`/office/codex` or `/office/claude`. Add a named worker and choose a Codex/Claude
terminal or a ChatGPT/Claude browser window. Coding workers require a project
folder in the backend's `GHOSTGRID_ALLOWED_WORKSPACES`. Run `../../dev.sh` from
this folder to start both services.

Select a worker's desk to open another window or remove the desk. Desks are saved
on the backend; existing conversation history stays in the native application.
Typing and monitor command loops are ambient animations. Drag the 3D room to
rotate it and scroll to zoom. Reduced-motion preferences stop the animations.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. If `vite` hangs in a sandboxed shell, use `node scripts/dev.mjs` (same server through the Vite JS API).

## Demo script (60 seconds)

1. `/console/keys` → **Add API key** (e.g. DeepSeek). Grey "NO KEY" buildings light up.
2. City → type `Clean the build and rebuild` → Enter.
3. Drone flies Router Spire → Codex Tower (1.5 s). Codex works (4 s, green terminal windows).
4. Security Checkpoint shows a yellow `!` and asks: *Codex wants to delete /tmp/build. Approve?*
5. **Approve (Y)** → drone returns with a glowing data cube → result card. **Reject (N)** → checkpoint goes red.
6. Click any building → side panel with status, last 5 logs, key/model selector.
7. `/console/logs` shows every call the city just made. `/console/playground` streams a reply and lights up that building.

## Stack

React 19 · Vite · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · zustand · Framer Motion · Recharts · [Shaders](https://github.com/shader-effects-inc/shaders) (WebGPU sky, CSS fallback when WebGPU is missing).

## Where things live

| Path | What |
|---|---|
| `src/store/grid.ts` | City state machine: `runCommand → dispatch → working → approval → done/rejected` |
| `src/store/keys.ts` | Provider keys + per-building key/model (localStorage, demo only) |
| `src/api/client.ts` | **Only** entry point for backend calls; decides live vs mock per call |
| `src/api/http.ts` | The transport: timeouts, retries, failure classes, SSE reading |
| `src/api/backend.ts` | Typed REST + SSE surface of the backend (`/api/v1`) |
| `src/api/mock.ts` | Mock backend (`submitCommand`, `approve`, `reject`, `getLogs`, `listAgents`, `listRequests`, `getUsage`, keys, `runPlayground`) |
| `src/weather/nyc.ts` | Live NYC weather → is it raining, and how hard (severity 0–4) |
| `src/city3d/Rain.tsx` · `src/city2d/Rain2D.tsx` | The rain itself, 3D and DOM fallback |
| `src/city/*` | City page: sky shader, skyline, buildings, drones, command bar, approval dialog, side panel |
| `src/console/*` | Console layout and pages |
| `DESIGN.md` | Palette, type, pixel grid, motion rules |

## Weather

The sky over the city is the sky over New York. `src/weather/nyc.ts` reads
Open-Meteo for 40.71 N, 74.01 W (no key, cached ten minutes) and turns the reading
into a rain severity:

| severity | what it means | the city |
|---|---|---|
| 0 | not raining | nothing renders at all |
| 1 light | drizzle, slight rain, < 0.5 mm/h | thin sparse streaks |
| 2 moderate | moderate rain, 0.5–2.5 mm/h | denser, faster, more lean |
| 3 heavy | heavy rain, 2.5–7.6 mm/h | long streaks, hard lean |
| 4 storm | thunderstorm, violent showers, ≥ 7.6 mm/h | downpour, and the sky flashes |

Severity is the worse of two signals — the WMO weather code and the measured
millimetres — so rain shows up whether the code or the gauge notices it first. The
real wind speed adds to the lean. Snow is not rain: the city stays dry under it.
If the request fails the city falls back to a dry, partly-cloudy stand-in and the
HUD badge reads `DEMO` instead of `LIVE`.

Both renderers read the same store: `city3d/Rain.tsx` (one instanced draw call,
animated entirely in the vertex shader) and `city2d/Rain2D.tsx` (CSS sheets, for
the no-WebGL fallback). Both stop animating under `prefers-reduced-motion`.

To see rain on a clear day, pin the severity: **`/?rain=4`** (0–4, or `VITE_GG_RAIN`).
The widget still reports the real temperature and wind.

## Backend pipeline

Every call to the Ghost Grid backend goes through one transport, `src/api/http.ts`.
It owns the behaviour the rest of the app no longer has to think about: per-attempt
timeouts plus an overall deadline, retries with jittered backoff for idempotent
calls (honouring `Retry-After`), the backend's `{ error: { code, message,
requestId } }` envelope, strict body checking, encoded query strings, and shared
in-flight GETs.

Failures are classified, and the class decides what happens next:

| `BackendError.kind` | Means | The city then |
|---|---|---|
| `offline`, `timeout`, `server`, `malformed` | the backend never answered, or answered broken | serves mock data, logs a warning |
| `rejected` (4xx) | the backend answered and said no | serves mock data **and** reports it: 401/403 flips the connection badge, anything else publishes a fault through `onPipelineFault` |
| `aborted` | the caller cancelled | propagates |

That split is the point: mock data for a missing backend is honest, mock data for a
rejected token is a bug that looks like a working city.

The event stream (`subscribeEvents`) resumes from the last delivered `seq` with
`Last-Event-ID`, drops events it has already seen, treats silence past the 15s
heartbeat as a dropped connection, and stops retrying a request the backend
rejected outright.

```bash
npm test                                    # transport contract, no server needed
GG_BACKEND_URL=http://127.0.0.1:3001 \
  node scripts/pipeline-e2e.mjs             # live backend: tail cursor, SSE, replay
```

`VITE_GG_API_TOKEN` is inlined into the bundle by Vite, so it is for local
development only — in a hosted deployment leave it unset and let a server-side
proxy attach the bearer token.

## For the backend team

`api.*` in `src/api/client.ts` already receives the building's provider, base URL, key and model through `getApiConfig(buildingId)`. Replace each mock call with a real request and keep the return types from `src/types.ts`; the UI does not need to change.

Keys are stored only in the browser's localStorage. Do not use production keys in the demo.

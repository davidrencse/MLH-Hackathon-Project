# Ghost Grid — MLH Hackathon Project

A pixel city interface for AI agents, backed by a Fastify API with persisted sessions, tasks, and usage accounting.

## What's new (AI Engineer NYC demo build)

**The city**
- Cyberpunk megastructures: taller towers with neon corner pylons, floor rings, rooftop spires and holo billboards.
- Cyber skyline: background blocks tower into neon megablocks.
- 3 pixel-art zeppelins with searchlights circling the city.
- 8-bit citizens walk the streets. Zoom in, pick one up, throw them, and they say "ouch".
- 🚜 Bulldozer tool (top right): click any building to demolish it (Esc to exit).
- Expandable city: 8 locked plots surround the island. Click "＋ OPEN PLOT" and a new district grows out of the ground. "↺ RESET PLOTS" re-locks them.
- Opens bigger and renders at native resolution (`CITY_SCALE` in `CameraRig.tsx`, `PIXEL_SIZE` in `world.ts`).

**Offices (click the Codex or Claude building)**
- Org chart: each building holds offices, each with a Manager, Team Leads and Engineers. ＋ NEW OFFICE, ＋ HIRE, promote, fire.
- Walled 3D offices with glass partitions, name plates and lights.
- Drag employees in 3D from one office into another to transfer them.
- Staffing board: drag employee cards onto project columns (or the Bench); project labels follow them in 3D.
- Employees chat in SF AI slang ("we're so back", "feel the AGI"), one bubble every 5s.
- "Add worker" opens a real Codex or Claude CLI session in Terminal.app on macOS.

**Real agents**
- Codex and Claude buildings run tasks on the real Codex / Claude CLIs (other buildings use the demo runtime).
- Start the backend with `GHOSTGRID_ALLOWED_WORKSPACES=/path/to/this/repo` so coding workers have an allowed workspace. Writing agents need a clean git tree.

**Dashboard**
- Demo traffic: 30 days of synthetic requests, tokens, cost, latency and a 240-row request log layered on real data (`FAKE_TRAFFIC` in `src/api/fakeTraffic.ts`).

**Pitch deck**
- `pitch/index.html` is the 8-bit deck (13 stages, live city + dashboard slides). `pitch/classic.html` is the original style.
- Serve it with `python3 -m http.server 8088 --directory pitch` and open http://localhost:8088.

## Run locally

Requires Node.js 22.13+ and npm. From the repository root:

```sh
npm install --prefix ghostgrid-backend
npm ci --prefix ghostgrid-frontend/frontend
cp ghostgrid-backend/.env.example ghostgrid-backend/.env
./dev.sh
```

Open http://localhost:5173. The backend runs at http://127.0.0.1:3001 and Vite proxies `/gg` to it. `./dev.sh backend` and `./dev.sh frontend` start individual services.

Set `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, and `ANTHROPIC_API_KEY` only in the backend `.env` to enable provider credit checks. DeepSeek exposes its prepaid USD balance; Groq exposes token/request rate-limit quota through a minimal completion probe, cached for ten minutes. Providers without readable balance data show labeled demo token allowances. Without keys the demo works locally. Actual request costs remain separate and come from backend usage records.

The city includes a NYC weather widget using Open-Meteo without an API key. If the weather service is unavailable, it shows labeled demo conditions and retries automatically.

The city is larger, supports panning, and loads its 3D renderer only when needed. Router interactions, Trust, and Heat were removed; the former router building remains decorative scenery.

## Validate

```sh
npm run build --prefix ghostgrid-frontend/frontend
npm run lint --prefix ghostgrid-frontend/frontend
npm run build --prefix ghostgrid-backend
npm test --prefix ghostgrid-backend
```

See the backend README, FRONTEND.md, PROVIDERS.md, and TESTING.md for API and integration details. Production hosting must serve the frontend build and proxy `/gg` to the backend, or configure `VITE_GG_API_URL` and permitted backend origins. Credentials, dependencies, generated builds, and local databases are excluded from Git.

## Hosted demo

`npm run build` builds both apps, and `npm start` serves the production frontend and backend together on `PORT` (default 10000). `/health` checks the running API. `npm run test:host` validates the combined host after building.

The public demo runs without provider credentials and uses labeled demo credit allowances. Connected providers and desktop workers run in the local app. Hosted demo state is shared among visitors; on a free host the local SQLite database resets on restarts and deployments.

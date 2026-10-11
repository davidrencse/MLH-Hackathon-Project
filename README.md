# Slop Angeles — MLH Hackathon Project

A pixel city interface for AI agents, backed by a Fastify API with persisted sessions, tasks, and usage accounting.

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

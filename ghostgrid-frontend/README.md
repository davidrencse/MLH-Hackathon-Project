# Ghost Grid

**Build your city. Command your agents.**

A cyberpunk isometric pixel city that visualizes AI agents at work. Every building is an agent. Type a command, watch a drone fly from the Router Spire to Codex Tower, approve a risky action at the Security Checkpoint, and get the result back. A game-style dashboard shows usage as city resources.

AI Engineer NYC Hackathon (MLH) · 2026-10-11

## Repo layout

| Folder | What | Owner |
|---|---|---|
| `frontend/` | React + Vite + TypeScript city and dashboard. Uses mock data until the backend is ready. | Stephen |
| `backend/` | Agent orchestrator API (coming) | teammate |

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Backend contract

The frontend calls the backend only through `frontend/src/api/client.ts`. Each function currently returns mock data from `frontend/src/api/mock.ts`. Replace the bodies with real requests and keep the return types in `frontend/src/types.ts`.

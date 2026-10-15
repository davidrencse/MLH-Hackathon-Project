# ghostgrid-frontend

@../../AGENTS.md

React 19 + three.js isometric city, Vite, zustand. The city renders with no backend, but it has
nothing to show without one: there is no mock backend any more, so every `api.*` read rejects when
the backend is unreachable and the caller shows that failure.

```bash
npm run dev          # :5173, proxies /gg -> 127.0.0.1:3001
npm run verify       # typecheck + lint + tests — run this before you stop
npm test             # node --test over scripts/*.test.mjs
npm run build        # tsc -b && vite build
```

## Conventions

- **Imports that the node tests reach need the `.ts` extension** (`from '../city3d/world.ts'`).
  `tsconfig` allows it and the test runner cannot resolve extensionless TS.
- **The 3D city is draw-call bound**, not geometry bound. Use `instancedMesh`, never allocate
  (`new THREE.*`) inside `useFrame`, and never call setState from a frame loop.
- **drei `<Html>` needs a stable `portal`** — use `useHtmlPortal()` from `src/city/office/`.
  Without it, drei rebuilds its React root when R3F reconnects events and React throws
  "Attempted to synchronously unmount a root while React was already rendering".
- **A component map must tolerate a missing entry.** `ART[b.type]` returning `undefined` rendered
  as an element once and blanked the entire app. Skip unknown types.
- **Lot and plate zoning lives in `src/city3d/world.ts`.** Seeded buildings must stand on a plate
  that is in `ALWAYS_OPEN` (`src/store/plots.ts`) or players cannot see them.

## Contested files

`src/city/office/` is edited by several agents at once. Claim it, and check it is quiet, before
you open anything in it.

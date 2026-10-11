# Ghostgrid · DESIGN

Cyberpunk pixel city that visualizes AI agent work. Always night. Readable first, neon second.

## Palette (only these + alpha variants)
| Token | Hex | Use |
|---|---|---|
| `--gg-void` | `#0b0820` | page background, deepest layer |
| `--gg-night` | `#1a1040` | panels, building bodies (dark) |
| `--gg-dusk` | `#2a1a5e` | building bodies (lit side), borders |
| `--gg-haze` | `#3d2a7a` | secondary borders, distant skyline |
| `--gg-ink` | `#e8e6ff` | primary text |
| `--gg-mute` | `#8f8ab8` | secondary text |
| `--gg-pink` | `#ff2bd6` | neon accent #1 (brand, selection) |
| `--gg-cyan` | `#00f0ff` | neon accent #2 (router, links, focus) |
| `--gg-green` | `#39ff14` | status: working / success / terminal text |
| `--gg-yellow` | `#ffd400` | status: needs_approval / warning |
| `--gg-red` | `#ff3355` | status: error |
| `--gg-grey` | `#5a5677` | status: unconfigured (no API key) |

Status colors are fixed everywhere (city + console):
`idle → --gg-cyan (dim)`, `working → --gg-green`, `needs_approval → --gg-yellow`, `error → --gg-red`, `offline/no key → --gg-grey`.

## Type
- Headings / labels / buttons: **Press Start 2P** (`font-pixel` utility, `--font-pixel`). Sizes: 8, 10, 12, 16, 24px only (multiples of 8 look crisp; 10/12 allowed for UI).
- Body / logs / data / inputs: **VT323** (`font-mono` utility, `--font-term`). Sizes: 16, 18, 20, 24px.
- Never Inter, never Geist, never system-ui for visible text.

## Pixel grid
- Base unit 4px. Spacing, borders and sizes are multiples of 4 (`gap-1 = 4px` in Tailwind already).
- City stage is drawn at a **logical 384×216** resolution and scaled by an **integer** factor (`--stage-scale`, 2–5). Never fractional.
- `image-rendering: pixelated` on any bitmap / canvas.
- Borders: 2px or 4px solid. Pixel "bevel" via stacked `box-shadow` (no blur). Corners: radius 0 everywhere (`--radius: 0`).
- Glow is allowed only as `drop-shadow`/`box-shadow` with the neon token at ≤ 0.6 alpha, never on body text.

## Motion
| Thing | Duration | Easing |
|---|---|---|
| Window flicker (idle) | 2.4s loop | `steps(4)` |
| Terminal glyph scroll (working) | 1.2s loop | `steps(8)` |
| Error beacon blink | 0.6s loop | `steps(2)` |
| Error shake | 0.3s loop | `steps(3)`, ±1 logical px |
| Approval "!" bob | 0.8s loop | `steps(2)` |
| Halo rotation | 6s loop (2s when router working) | linear |
| Drone flight | 1.5s | easeInOut, arced path |
| Panel slide | 0.25s | `[0.2, 0.8, 0.2, 1]` |
| Dialog pop | 0.15s | `steps(3)` scale 0.9→1 |
Respect `prefers-reduced-motion`: stop loops, keep state colors.

## Banned ("AI template look")
Purple gradient cards, Inter, rounded-2xl cards, soft blurred shadows, emoji icons, glassmorphism blobs, gradient text. Icons: lucide at 16px with `strokeWidth={2.5}` or hand-drawn pixel boxes.

## City (WebGL, Three.js via React Three Fiber) — src/city3d/
- One `<Canvas>`: orthographic camera, 2:1 dimetric iso (elevation 30°, azimuth 45°), rendered at 1/3 resolution (`PIXEL_SIZE = 3`) and upscaled with `image-rendering: pixelated` → crisp 3D pixel art.
- 16×16 tile map, 1 tile = 1 world unit, roads at tile rows/cols 5 and 10. Lots 0–4 = default buildings, lots 5–12 = buildable.
- Look: voxel / box-built buildings, flat Lambert shading (top lightest, two side faces darker), emissive pixel windows, neon strips (MeshBasic, toneMapped=false) picked up by bloom. Hard shadows (BasicShadowMap), purple fog, deep night.
- Efficiency: shared geometries/materials, InstancedMesh for anything repeated (lamps, cars, distant city), animate in useFrame via refs (never React state per frame), ≤ 3 dynamic lights, one shadow-casting light.
- DOM HUD on top: TopNav (resource bar), BuildMenu, CommandBar, SidePanel, ApprovalDialog. Building labels use drei `<Html>`.

## Dashboard (/dashboard)
Game "city stats" screen, not a SaaS console. Dark `--gg-void` background, `--gg-night` surfaces, 2px `--gg-haze` borders, radius 0. VT323 for data, Press Start 2P only for page titles, nav and buttons. Neon only for status and primary action.

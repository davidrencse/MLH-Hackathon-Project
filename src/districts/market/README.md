# Market District

Self-contained district for GhostGrid. Everything lives in this folder; the only public entry is `index.ts`.

## Plug into the city

```tsx
import { MarketDistrict } from './districts/market';

<MarketDistrict cityBlocks={CITY_BLOCKS} />
```

`cityBlocks` (type `CityBlock`) are the decorative buildings around Market Tower; the shell owns them in `src/shell/cityLayout.ts`, so other districts can claim a block there without touching this folder. Styles are scoped under `.mk-*`; storage keys are prefixed `ghostgrid.market.*`.

## Experience

One 3D **Market Tower** (pure CSS 3D, no WebGL deps):

1. **City** — GhostGrid opens on a 3D neon city (roads, traffic, signs) with Market Tower as the lit landmark. Floor windows follow each floor's task status. Click the tower to enter; the city fades out.
2. **Cutaway** — camera moves in, facades slide off, floors separate; each floor shows its robot, room and a live callout.
3. **Floor** — click a floor: camera dives in, then the interior opens (robot + wall screen on the left, feature console on the right). Elevator buttons switch floors; ESC walks back out.

| Floor | Feature | Robot |
| --- | --- | --- |
| 5F | Quant Exchange | QX-5 `trader` — monitor head with live chart (click: refresh feed) |
| 4F | Signal Lab | SIG-4 `scientist` — glass dome, cyclops eye, lab coat (click: analyze) |
| 3F | Paper Trading Hub | PT-3 `worker` — cap, clipboard, treads |
| 2F | Risk Office | RSK-2 `guard` — siren, visor slit, shield |
| 1F | Backtest Vault | BT-1 `archivist` — hovering orb, lens, data cassette |

## Layout

| Path | Role |
| --- | --- |
| `MarketDistrict.tsx` | Entry: HUD + tower scene + error boundary + ESC navigation |
| `buildings.ts` | Floor definitions (`FLOORS`) |
| `components/Tower3D.tsx` | CSS 3D city + tower, camera modes, cutaway, floor dive |
| `components/FloorInterior.tsx` | Inside a floor: elevator, robot room, console |
| `components/Robot.tsx` | Five pixel robot variants, all with IDLE / RUNNING / SUCCESS / ERROR animations |
| `components/{Exchange,Signal,PaperTrading,Risk,Backtest}Panel.tsx` | One console per floor |
| `components/PriceChart.tsx` | Dependency-free SVG chart with SMA overlay |
| `services/marketDataService.ts` | `getAssets / getPriceHistory / getLatestPrice / getTradingSignal`; CoinGecko → DEMO fallback |
| `services/signalService.ts` | `SignalProvider` interface + SMA rule (not AI) |
| `services/paperTradingService.ts` | Pure order / valuation logic, integer cents, localStorage |
| `services/riskService.ts` | Max order size, max single-asset weight |
| `services/backtestService.ts` | SMA backtest without look-ahead |
| `state/useMarketDistrict.ts` | All UI state, view (exterior/tower/floor), statuses, event log |

## Extending

- **Real data provider:** replace the fetch calls in `MarketDataService` (keys must come from env / a backend proxy, never source).
- **LLM agent signals:** implement `SignalProvider` with `engine: 'LLM_AGENT'` and call `marketDataService.setSignalProvider(provider)`.

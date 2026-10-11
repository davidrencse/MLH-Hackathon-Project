# GhostGrid — Market District

GhostGrid visualizes AI agent workflows as a cyberpunk pixel city. This repo contains the city shell and the **Market District**: a 3D neon city whose landmark, **Market Tower**, holds five floors, each run by its own robot operator.

| Floor | Feature |
| --- | --- |
| 5F Quant Exchange | BTC / ETH / SOL quotes and 7-day charts (CoinGecko public API, automatic labelled DEMO fallback) |
| 4F Signal Lab | Rule-based SMA crossover signal with reasons and risks (not AI; `SignalProvider` slot for an LLM agent) |
| 3F Paper Trading Hub | $10,000 local paper account, buy / sell, average cost, unrealized & realized P&L |
| 2F Risk Office | Max order size and max single-asset weight, enforced before every paper order |
| 1F Backtest Vault | SMA backtest on historical bars with no look-ahead |

All trading is simulated locally and never reaches a real exchange. Account state persists in `localStorage`.

## Run

```bash
npm install
npm run dev
```

Open the printed localhost URL, click **ENTER MARKET TOWER**, then click a floor. Use the elevator to switch floors; ESC walks back out.

```bash
npm test        # unit tests (trading math, risk, data fallback, signals, backtest)
npm run build   # type-check + production build
```

## Structure

- `src/shell/` — app entry and the decorative city layout (`cityLayout.ts`)
- `src/districts/market/` — self-contained Market District (see its [README](src/districts/market/README.md))

Built with React 18, TypeScript, Vite and pure CSS 3D (no WebGL dependency).

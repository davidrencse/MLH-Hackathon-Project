import { useState } from 'react';
import { useMarket } from '../state/useMarketDistrict';
import { AssetTabs, SourceBadge, Stat } from './common';
import { PriceChart } from './PriceChart';
import { runSmaBacktest, type BacktestResult } from '../services/backtestService';
import { SMA_LONG, SMA_SHORT } from '../services/signalService';
import { fmtPct, fmtUsd } from '../services/money';

export function BacktestPanel() {
  const { selected, histories, setStatus, log } = useMarket();
  const [res, setRes] = useState<{ symbol: string; r: BacktestResult } | null>(null);
  const h = histories[selected];

  const run = async () => {
    if (!h) return;
    setStatus('backtest', 'RUNNING');
    log('backtest', 'info', `Backtesting SMA${SMA_SHORT}/${SMA_LONG} on ${selected} (${h.points.length} bars)…`);
    await new Promise((r) => setTimeout(r, 600));
    const r = runSmaBacktest(h.points);
    if (!r) {
      setStatus('backtest', 'ERROR');
      log('backtest', 'error', 'Not enough history for backtest.');
      return;
    }
    setRes({ symbol: selected, r });
    setStatus('backtest', 'SUCCESS');
    log('backtest', 'success', `${selected}: strategy ${fmtPct(r.strategyReturnPct)} vs buy&hold ${fmtPct(r.buyHoldReturnPct)}`);
  };

  return (
    <>
      <div className="mk-note mk-note--info">
        Long-only SMA{SMA_SHORT}/SMA{SMA_LONG} backtest on the loaded 7-day hourly history. The signal at bar <i>t</i> only uses prices up to
        <i> t</i> and is applied to the move from <i>t</i> to <i>t+1</i> — no future data. No fees/slippage. Past results ≠ future returns.
      </div>
      <AssetTabs />
      <SourceBadge source={h?.source} />
      <button className="mk-btn mk-btn--primary" onClick={run} disabled={!h}>▶ RUN BACKTEST · {selected}</button>
      {res && res.symbol === selected ? (
        <>
          <div className="mk-grid3">
            <Stat label="STRATEGY" value={fmtPct(res.r.strategyReturnPct)} tone={res.r.strategyReturnPct >= 0 ? 'up' : 'down'} />
            <Stat label="BUY & HOLD" value={fmtPct(res.r.buyHoldReturnPct)} tone={res.r.buyHoldReturnPct >= 0 ? 'up' : 'down'} />
            <Stat label="MAX DRAWDOWN" value={`-${res.r.maxDrawdownPct.toFixed(2)}%`} tone="down" />
            <Stat label="TRADES" value={res.r.trades} />
            <Stat label="WIN RATE" value={`${res.r.winRatePct.toFixed(0)}%`} />
            <Stat label="EXPOSURE" value={`${res.r.exposurePct.toFixed(0)}%`} />
          </div>
          <h4 className="mk-h4">EQUITY CURVE ($10,000 start)</h4>
          <PriceChart points={res.r.equityCurve} color="#b061ff" height={170} valueFormat={(v) => fmtUsd(v, 0)} />
        </>
      ) : (
        <div className="mk-empty">Run a backtest to see results for {selected}.</div>
      )}
    </>
  );
}

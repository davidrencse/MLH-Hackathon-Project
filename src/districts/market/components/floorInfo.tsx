// Live one-line metric per floor, shown on tower callouts and the in-floor wall screen.
import { useMarket } from '../state/useMarketDistrict';
import { fmtCents, fmtPct, fmtPrice } from '../services/money';
import type { BuildingId } from '../types';

export function FloorMetric({ id }: { id: BuildingId }) {
  const { latest, selected, signal, valuation, limits } = useMarket();
  switch (id) {
    case 'exchange': {
      const lp = latest[selected];
      return lp ? (
        <span>
          {selected} {fmtPrice(lp.price)} <span className={lp.change24hPct >= 0 ? 'mk-up' : 'mk-down'}>{fmtPct(lp.change24hPct)}</span>
        </span>
      ) : (
        <span className="mk-dim">CONNECTING…</span>
      );
    }
    case 'signal':
      return signal ? (
        <span className={`mk-sig-${signal.action.toLowerCase()}`}>
          {signal.symbol} {signal.action}
        </span>
      ) : (
        <span className="mk-dim">NO SIGNAL YET</span>
      );
    case 'trading':
      return (
        <span>
          {fmtCents(valuation.equityCents)}{' '}
          <span className={valuation.unrealizedCents >= 0 ? 'mk-up' : 'mk-down'}>{fmtCents(valuation.unrealizedCents)}</span>
        </span>
      );
    case 'risk': {
      const maxW = valuation.rows.reduce((m, r) => Math.max(m, r.weightPct), 0);
      return (
        <span className={maxW > limits.maxPositionPct ? 'mk-down' : maxW > limits.maxPositionPct * 0.8 ? 'mk-warn' : ''}>
          MAX {maxW.toFixed(0)}% / {limits.maxPositionPct}%
        </span>
      );
    }
    case 'backtest':
      return <span className="mk-dim">SMA REPLAY · 7D</span>;
  }
}

/** Default line a robot says when nothing has happened on its floor yet. */
export const ROBOT_IDLE_LINES: Record<BuildingId, string> = {
  exchange: 'Feeds online. Pick an asset to inspect its chart.',
  signal: 'Ready to run the SMA rule. I am a rule engine, not an AI model.',
  trading: 'Paper desk open. Nothing here touches a real exchange.',
  risk: 'Watching order size and concentration limits.',
  backtest: 'Vault sealed. Run a backtest on historical bars.',
};

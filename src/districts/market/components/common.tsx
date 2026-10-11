import type { AssetSymbol, DataSource } from '../types';
import { useMarket } from '../state/useMarketDistrict';
import { fmtPct, fmtPrice } from '../services/money';

export function SourceBadge({ source, updatedAt }: { source?: DataSource; updatedAt?: number }) {
  if (!source) return null;
  return (
    <span className={`mk-badge mk-badge--${source.toLowerCase()}`} title={updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : ''}>
      {source === 'LIVE' ? '● LIVE · CoinGecko' : '▲ DEMO DATA · simulated'}
      {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ''}
    </span>
  );
}

export function AssetTabs() {
  const { assets, selected, setSelected, latest } = useMarket();
  return (
    <div className="mk-tabs" role="tablist">
      {assets.map((a) => {
        const lp = latest[a.symbol];
        return (
          <button
            key={a.symbol}
            role="tab"
            aria-selected={selected === a.symbol}
            className={`mk-tab ${selected === a.symbol ? 'is-active' : ''}`}
            onClick={() => setSelected(a.symbol as AssetSymbol)}
            style={{ ['--asset' as any]: a.color }}
          >
            <span className="mk-tab__sym">{a.symbol}</span>
            <span className="mk-tab__px">{lp ? fmtPrice(lp.price) : '—'}</span>
            {lp && <span className={lp.change24hPct >= 0 ? 'mk-up' : 'mk-down'}>{fmtPct(lp.change24hPct)}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'up' | 'down' | 'warn' }) {
  return (
    <div className="mk-stat">
      <div className="mk-stat__label">{label}</div>
      <div className={`mk-stat__value ${tone ? `mk-${tone}` : ''}`}>{value}</div>
    </div>
  );
}

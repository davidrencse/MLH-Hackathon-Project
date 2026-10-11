import { useMarket } from '../state/useMarketDistrict';
import { AssetTabs, SourceBadge, Stat } from './common';
import { PriceChart } from './PriceChart';
import { fmtPct, fmtPrice } from '../services/money';

export function ExchangePanel() {
  const { selected, histories, latest, reloadMarket, forceDemo, setForceDemo, statuses, assets } = useMarket();
  const h = histories[selected];
  const lp = latest[selected];
  const pts = h?.points ?? [];
  const vals = pts.map((p) => p.price);
  const asset = assets.find((a) => a.symbol === selected)!;
  return (
    <>
      <AssetTabs />
      <div className="mk-quote">
        <div>
          <div className="mk-quote__name">{asset.name} / USD</div>
          <div className="mk-quote__px">{lp ? fmtPrice(lp.price) : '—'}</div>
        </div>
        {lp && <div className={`mk-quote__chg ${lp.change24hPct >= 0 ? 'mk-up' : 'mk-down'}`}>{fmtPct(lp.change24hPct)} 24h</div>}
      </div>
      <SourceBadge source={h?.source} updatedAt={lp?.updatedAt} />
      {h?.error && <div className="mk-note mk-note--err">Live feed unavailable: {h.error}. Showing DEMO data — these are NOT real market prices.</div>}
      {h?.source === 'DEMO' && <div className="mk-dim">DEMO mode: reproducible simulated history + simulated tick every 4s.</div>}
      {h ? <PriceChart points={h.points} color="auto" /> : <div className="mk-empty">Loading…</div>}
      <div className="mk-grid3">
        <Stat label="7D HIGH" value={vals.length ? fmtPrice(Math.max(...vals)) : '—'} />
        <Stat label="7D LOW" value={vals.length ? fmtPrice(Math.min(...vals)) : '—'} />
        <Stat label="7D CHANGE" value={vals.length ? fmtPct((vals[vals.length - 1] / vals[0] - 1) * 100) : '—'} tone={vals.length && vals[vals.length - 1] >= vals[0] ? 'up' : 'down'} />
      </div>
      <div className="mk-chips">
        <button className="mk-btn" onClick={reloadMarket} disabled={statuses.exchange === 'RUNNING'}>⟳ REFRESH FEED</button>
        <button className="mk-btn mk-btn--ghost" onClick={() => setForceDemo(!forceDemo)}>
          {forceDemo ? 'USE LIVE DATA' : 'FORCE DEMO DATA'}
        </button>
      </div>
    </>
  );
}

import { useState } from 'react';
import { useMarket } from '../state/useMarketDistrict';
import { Stat } from './common';
import { fmtCents } from '../services/money';

export function RiskPanel() {
  const { limits, setLimits, valuation, events } = useMarket();
  const [maxTrade, setMaxTrade] = useState(String(limits.maxTradeUsd));
  const [maxPos, setMaxPos] = useState(String(limits.maxPositionPct));
  const [err, setErr] = useState<string | null>(null);

  const cashPct = valuation.equityCents ? (valuation.cashCents / valuation.equityCents) * 100 : 100;
  const largest = valuation.rows.reduce<(typeof valuation.rows)[number] | null>((m, r) => (!m || r.weightPct > m.weightPct ? r : m), null);
  const breaches = valuation.rows.filter((r) => r.weightPct > limits.maxPositionPct);
  const near = valuation.rows.filter((r) => r.weightPct > limits.maxPositionPct * 0.8 && r.weightPct <= limits.maxPositionPct);
  const level = breaches.length ? 'HIGH' : near.length ? 'ELEVATED' : 'NORMAL';
  const riskEvents = events.filter((e) => e.building === 'risk' && e.level !== 'info').slice(0, 8);

  const save = () => {
    const t = Number(maxTrade);
    const p = Number(maxPos);
    if (!(t > 0)) return setErr('Max trade must be > 0.');
    if (!(p > 0 && p <= 100)) return setErr('Max position must be between 0 and 100%.');
    setErr(null);
    setLimits({ maxTradeUsd: t, maxPositionPct: p });
  };

  return (
    <>
      <div className={`mk-risk mk-risk--${level.toLowerCase()}`}>
        <span>RISK LEVEL</span>
        <b>{level}</b>
      </div>
      <div className="mk-grid3">
        <Stat label="EQUITY" value={fmtCents(valuation.equityCents)} />
        <Stat label="CASH BUFFER" value={`${cashPct.toFixed(1)}%`} />
        <Stat
          label="LARGEST POSITION"
          value={largest ? `${largest.symbol} ${largest.weightPct.toFixed(1)}%` : '—'}
          tone={breaches.length ? 'down' : near.length ? 'warn' : undefined}
        />
      </div>
      <h4 className="mk-h4">EXPOSURE vs LIMIT ({limits.maxPositionPct}%)</h4>
      {valuation.rows.length === 0 && <div className="mk-empty">No open positions.</div>}
      {valuation.rows.map((r) => (
        <div key={r.symbol} className="mk-bar">
          <span>{r.symbol}</span>
          <div className="mk-bar__track">
            <div className="mk-bar__limit" style={{ left: `${limits.maxPositionPct}%` }} />
            <div className={`mk-bar__fill ${r.weightPct > limits.maxPositionPct ? 'is-over' : ''}`} style={{ width: `${Math.min(100, r.weightPct)}%` }} />
          </div>
          <span>{r.weightPct.toFixed(1)}%</span>
        </div>
      ))}
      {breaches.map((b) => (
        <div key={b.symbol} className="mk-note mk-note--err">
          ⚠ {b.symbol} is {b.weightPct.toFixed(1)}% of equity (price drift). New {b.symbol} buys are blocked; sells allowed.
        </div>
      ))}

      <h4 className="mk-h4">LIMITS</h4>
      <div className="mk-order">
        <label className="mk-field">
          <span>Max value per order (USD)</span>
          <input inputMode="decimal" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        <label className="mk-field">
          <span>Max single-asset weight (% of equity)</span>
          <input inputMode="decimal" value={maxPos} onChange={(e) => setMaxPos(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        <button className="mk-btn mk-btn--primary" onClick={save}>SAVE LIMITS</button>
        {err && <div className="mk-note mk-note--err">{err}</div>}
        <div className="mk-dim">Active: max ${limits.maxTradeUsd}/order · max {limits.maxPositionPct}% per asset. Checked before every paper order.</div>
      </div>

      <h4 className="mk-h4">BLOCKED ORDERS & ERRORS</h4>
      {riskEvents.length === 0 ? (
        <div className="mk-empty">No blocked orders.</div>
      ) : (
        <ul className="mk-list mk-list--warn">{riskEvents.map((e) => <li key={e.id}>{new Date(e.at).toLocaleTimeString()} — {e.message}</li>)}</ul>
      )}
    </>
  );
}

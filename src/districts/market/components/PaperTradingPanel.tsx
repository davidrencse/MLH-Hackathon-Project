import { useState } from 'react';
import { useMarket } from '../state/useMarketDistrict';
import { AssetTabs, SourceBadge, Stat } from './common';
import { floorQty, fmtCents, fmtPct, fmtPrice, fmtQty, notionalCents } from '../services/money';
import type { OrderSide } from '../types';

export function PaperTradingPanel() {
  const { selected, latest, account, valuation, submitOrder, resetAccount, limits } = useMarket();
  const [side, setSide] = useState<OrderSide>('BUY');
  const [qtyText, setQtyText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const lp = latest[selected];
  const price = lp?.price ?? 0;
  const pos = account.positions[selected];
  const qty = Number(qtyText);
  const estCents = price && qty > 0 ? notionalCents(floorQty(qty), price) : 0;

  const setUsd = (usd: number) => price && setQtyText(String(floorQty(usd / price)));
  const setFrac = (f: number) => pos && setQtyText(String(floorQty(pos.qty * f)));

  const submit = () => {
    const r = submitOrder(selected, side, qty);
    setResult(r);
    if (r.ok) setQtyText('');
  };

  return (
    <>
      <div className="mk-note mk-note--warn">
        PAPER TRADING · simulated fills at the latest displayed price · no fees · <b>never sent to a real exchange</b>
      </div>
      <div className="mk-grid3">
        <Stat label="TOTAL EQUITY" value={fmtCents(valuation.equityCents)} />
        <Stat label="CASH" value={fmtCents(valuation.cashCents)} />
        <Stat label="POSITIONS" value={fmtCents(valuation.positionsValueCents)} />
        <Stat label="UNREALIZED P&L" value={fmtCents(valuation.unrealizedCents)} tone={valuation.unrealizedCents >= 0 ? 'up' : 'down'} />
        <Stat label="REALIZED P&L" value={fmtCents(valuation.realizedCents)} tone={valuation.realizedCents >= 0 ? 'up' : 'down'} />
        <Stat label="TOTAL RETURN" value={fmtPct((valuation.equityCents / 1_000_000 - 1) * 100)} tone={valuation.equityCents >= 1_000_000 ? 'up' : 'down'} />
      </div>

      <AssetTabs />
      <div className="mk-order">
        <div className="mk-seg">
          {(['BUY', 'SELL'] as const).map((s) => (
            <button key={s} className={`mk-seg__btn mk-seg__btn--${s.toLowerCase()} ${side === s ? 'is-active' : ''}`} onClick={() => setSide(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="mk-order__row">
          <span>Price</span>
          <b>{lp ? fmtPrice(price) : '—'}</b>
          <SourceBadge source={lp?.source} />
        </div>
        <label className="mk-field">
          <span>Quantity ({selected})</span>
          <input inputMode="decimal" value={qtyText} placeholder="0.00" onChange={(e) => setQtyText(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        <div className="mk-chips">
          {side === 'BUY'
            ? [100, 500, 1000, 2000].map((u) => (
                <button key={u} className="mk-chip" onClick={() => setUsd(u)} disabled={!price}>${u}</button>
              ))
            : [0.25, 0.5, 1].map((f) => (
                <button key={f} className="mk-chip" onClick={() => setFrac(f)} disabled={!pos}>{f * 100}%</button>
              ))}
        </div>
        <div className="mk-order__row">
          <span>Est. value</span>
          <b>{fmtCents(estCents)}</b>
          <span className="mk-dim">limit {`$${limits.maxTradeUsd}`}/order</span>
        </div>
        <button className={`mk-btn mk-btn--${side === 'BUY' ? 'buy' : 'sell'}`} onClick={submit} disabled={!lp}>
          PAPER {side} {selected}
        </button>
        {result && <div className={`mk-note ${result.ok ? 'mk-note--ok' : 'mk-note--err'}`}>{result.ok ? '✔ ' : '✖ '}{result.message}</div>}
      </div>

      <h4 className="mk-h4">POSITIONS</h4>
      {valuation.rows.length === 0 ? (
        <div className="mk-empty">No positions. Buy something above.</div>
      ) : (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr><th>ASSET</th><th>QTY</th><th>AVG COST</th><th>PRICE</th><th>VALUE</th><th>UNRL P&L</th></tr>
            </thead>
            <tbody>
              {valuation.rows.map((r) => (
                <tr key={r.symbol}>
                  <td>{r.symbol}</td>
                  <td>{fmtQty(r.qty)}</td>
                  <td>{fmtPrice(r.avgCost)}</td>
                  <td>{fmtPrice(r.price)}</td>
                  <td>{fmtCents(r.valueCents)}</td>
                  <td className={r.unrealizedCents >= 0 ? 'mk-up' : 'mk-down'}>
                    {fmtCents(r.unrealizedCents)} ({fmtPct(r.unrealizedPct)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="mk-h4">RECENT FILLS (PAPER)</h4>
      {account.fills.length === 0 ? (
        <div className="mk-empty">No fills yet.</div>
      ) : (
        <ul className="mk-fills">
          {account.fills.slice(0, 8).map((f) => (
            <li key={f.id}>
              <span className={f.side === 'BUY' ? 'mk-up' : 'mk-down'}>{f.side}</span> {fmtQty(f.qty)} {f.symbol} @ {fmtPrice(f.priceCents / 100)} ={' '}
              {fmtCents(f.notionalCents)}
              {f.side === 'SELL' && <span className={f.realizedCents >= 0 ? 'mk-up' : 'mk-down'}> ({fmtCents(f.realizedCents)})</span>}
              <span className="mk-dim"> {new Date(f.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
      {confirmReset ? (
        <div className="mk-chips">
          <span className="mk-dim">Reset paper account to $10,000?</span>
          <button className="mk-chip mk-chip--danger" onClick={() => { resetAccount(); setConfirmReset(false); setResult(null); }}>YES, RESET</button>
          <button className="mk-chip" onClick={() => setConfirmReset(false)}>CANCEL</button>
        </div>
      ) : (
        <button className="mk-btn mk-btn--ghost" onClick={() => setConfirmReset(true)}>↺ Reset paper account</button>
      )}
    </>
  );
}

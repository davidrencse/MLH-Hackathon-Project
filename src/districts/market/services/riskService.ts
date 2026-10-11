// Risk Office rules. Pure functions, evaluated before every paper order.
import type { Account, AssetSymbol, OrderSide, RiskLimits } from '../types';
import { notionalCents } from './money';

export const DEFAULT_LIMITS: RiskLimits = { maxTradeUsd: 2500, maxPositionPct: 40 };

export type RiskCheck = { ok: true } | { ok: false; rule: 'MAX_TRADE' | 'MAX_POSITION'; reason: string };

export function checkRisk(
  account: Account,
  order: { symbol: AssetSymbol; side: OrderSide; qty: number; price: number },
  prices: Partial<Record<AssetSymbol, number>>,
  limits: RiskLimits,
): RiskCheck {
  const notional = notionalCents(order.qty, order.price);
  if (notional > Math.round(limits.maxTradeUsd * 100)) {
    return {
      ok: false,
      rule: 'MAX_TRADE',
      reason: `Order value $${(notional / 100).toFixed(2)} exceeds max trade size $${limits.maxTradeUsd.toFixed(2)}.`,
    };
  }
  if (order.side === 'BUY') {
    // Buying at market converts cash into position 1:1, so equity is unchanged by the trade itself.
    let equity = account.cashCents;
    for (const p of Object.values(account.positions)) {
      if (p) equity += notionalCents(p.qty, prices[p.symbol] ?? p.costCents / 100 / p.qty);
    }
    const cur = account.positions[order.symbol];
    const after = (cur ? notionalCents(cur.qty, order.price) : 0) + notional;
    const pct = equity > 0 ? (after / equity) * 100 : 100;
    if (pct > limits.maxPositionPct + 1e-9) {
      return {
        ok: false,
        rule: 'MAX_POSITION',
        reason: `${order.symbol} would be ${pct.toFixed(1)}% of equity, above the ${limits.maxPositionPct}% single-asset limit.`,
      };
    }
  }
  return { ok: true };
}

const KEY = 'ghostgrid.market.riskLimits.v1';
export function loadLimits(): RiskLimits {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_LIMITS;
    const l = JSON.parse(raw);
    if (l.maxTradeUsd > 0 && l.maxPositionPct > 0 && l.maxPositionPct <= 100) return l;
  } catch {
    /* fall through */
  }
  return DEFAULT_LIMITS;
}
export function saveLimits(l: RiskLimits) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

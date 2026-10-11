// Paper trading engine. LOCAL SIMULATION ONLY — this module never talks to any exchange.
// All functions are pure (account in → new account out); persistence is a thin localStorage wrapper.
import type { Account, AssetSymbol, Fill, OrderSide, Position, RiskLimits } from '../types';
import { floorQty, fromCents, notionalCents, roundQty, toCents } from './money';
import { checkRisk } from './riskService';

export const INITIAL_CASH_CENTS = 1_000_000; // $10,000
const STORAGE_KEY = 'ghostgrid.market.paperAccount.v1';
const MAX_FILLS = 200;

export function createAccount(now = Date.now()): Account {
  return { cashCents: INITIAL_CASH_CENTS, positions: {}, fills: [], realizedCents: 0, createdAt: now };
}

export interface OrderRequest {
  symbol: AssetSymbol;
  side: OrderSide;
  qty: number;
  /** Execution price, USD (latest known price). */
  price: number;
}

export type OrderResult =
  | { ok: true; account: Account; fill: Fill }
  | { ok: false; reason: string; code: 'INVALID' | 'INSUFFICIENT_CASH' | 'INSUFFICIENT_POSITION' | 'RISK_LIMIT' };

export interface Valuation {
  cashCents: number;
  positionsValueCents: number;
  equityCents: number;
  costCents: number;
  unrealizedCents: number;
  realizedCents: number;
  rows: Array<{
    symbol: AssetSymbol;
    qty: number;
    avgCost: number; // USD
    price: number;
    valueCents: number;
    costCents: number;
    unrealizedCents: number;
    unrealizedPct: number;
    weightPct: number;
  }>;
}

export function valueAccount(account: Account, prices: Partial<Record<AssetSymbol, number>>): Valuation {
  const rows: Valuation['rows'] = [];
  let positionsValueCents = 0;
  let costCents = 0;
  for (const pos of Object.values(account.positions) as Position[]) {
    if (!pos || pos.qty <= 0) continue;
    const price = prices[pos.symbol] ?? fromCents(pos.costCents) / pos.qty;
    const valueCents = notionalCents(pos.qty, price);
    positionsValueCents += valueCents;
    costCents += pos.costCents;
    rows.push({
      symbol: pos.symbol,
      qty: pos.qty,
      avgCost: fromCents(pos.costCents) / pos.qty,
      price,
      valueCents,
      costCents: pos.costCents,
      unrealizedCents: valueCents - pos.costCents,
      unrealizedPct: pos.costCents ? ((valueCents - pos.costCents) / pos.costCents) * 100 : 0,
      weightPct: 0,
    });
  }
  const equityCents = account.cashCents + positionsValueCents;
  for (const r of rows) r.weightPct = equityCents ? (r.valueCents / equityCents) * 100 : 0;
  return {
    cashCents: account.cashCents,
    positionsValueCents,
    equityCents,
    costCents,
    unrealizedCents: positionsValueCents - costCents,
    realizedCents: account.realizedCents,
    rows,
  };
}

export function placeOrder(
  account: Account,
  req: OrderRequest,
  prices: Partial<Record<AssetSymbol, number>>,
  limits?: RiskLimits,
  now = Date.now(),
): OrderResult {
  const qty = floorQty(req.qty);
  if (!Number.isFinite(req.price) || req.price <= 0) return { ok: false, code: 'INVALID', reason: 'No valid price available.' };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, code: 'INVALID', reason: 'Quantity must be greater than 0.' };
  const notional = notionalCents(qty, req.price);
  if (notional < 1) return { ok: false, code: 'INVALID', reason: 'Order value is below $0.01.' };

  const pos: Position = account.positions[req.symbol] ?? { symbol: req.symbol, qty: 0, costCents: 0 };

  if (req.side === 'BUY' && notional > account.cashCents) {
    return { ok: false, code: 'INSUFFICIENT_CASH', reason: `Insufficient cash: need ${usd(notional)}, have ${usd(account.cashCents)}.` };
  }
  if (req.side === 'SELL' && qty > pos.qty + 1e-12) {
    return { ok: false, code: 'INSUFFICIENT_POSITION', reason: `Insufficient position: selling ${qty} ${req.symbol}, holding ${pos.qty}.` };
  }
  if (limits) {
    const risk = checkRisk(account, { ...req, qty }, { ...prices, [req.symbol]: req.price }, limits);
    if (!risk.ok) return { ok: false, code: 'RISK_LIMIT', reason: risk.reason };
  }

  let newPos: Position;
  let cashCents = account.cashCents;
  let realized = 0;
  if (req.side === 'BUY') {
    cashCents -= notional;
    newPos = { symbol: req.symbol, qty: roundQty(pos.qty + qty), costCents: pos.costCents + notional };
  } else {
    cashCents += notional;
    const remainingQty = roundQty(pos.qty - qty);
    // Remove cost proportionally; selling everything removes all remaining cost (no drift).
    const costRemoved = remainingQty <= 0 ? pos.costCents : Math.round((pos.costCents * qty) / pos.qty);
    realized = notional - costRemoved;
    newPos = { symbol: req.symbol, qty: Math.max(0, remainingQty), costCents: pos.costCents - costRemoved };
  }

  const fill: Fill = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: req.symbol,
    side: req.side,
    qty,
    priceCents: toCents(req.price),
    notionalCents: notional,
    realizedCents: realized,
    at: now,
  };
  const positions = { ...account.positions };
  if (newPos.qty > 0) positions[req.symbol] = newPos;
  else delete positions[req.symbol];

  return {
    ok: true,
    fill,
    account: {
      ...account,
      cashCents,
      positions,
      realizedCents: account.realizedCents + realized,
      fills: [fill, ...account.fills].slice(0, MAX_FILLS),
    },
  };
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

// ---- persistence -------------------------------------------------------------

export function loadAccount(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Account {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return createAccount();
    const a = JSON.parse(raw) as Account;
    if (typeof a.cashCents !== 'number' || typeof a.positions !== 'object') return createAccount();
    return { ...createAccount(), ...a };
  } catch {
    return createAccount();
  }
}

export function saveAccount(account: Account, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(account));
  } catch {
    /* storage full / blocked — account stays in memory */
  }
}

export function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

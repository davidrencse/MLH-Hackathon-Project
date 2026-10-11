import { describe, expect, it } from 'vitest';
import { createAccount, placeOrder, valueAccount, loadAccount, saveAccount, INITIAL_CASH_CENTS } from '../services/paperTradingService';
import { checkRisk } from '../services/riskService';

const NO_LIMITS = { maxTradeUsd: 1e9, maxPositionPct: 100 };

describe('paper trading', () => {
  it('starts with $10,000', () => {
    expect(createAccount().cashCents).toBe(INITIAL_CASH_CENTS);
  });

  it('buy reduces cash, adds position; sell reverses', () => {
    let a = createAccount();
    const r1 = placeOrder(a, { symbol: 'ETH', side: 'BUY', qty: 1, price: 3000 }, {}, NO_LIMITS);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    a = r1.account;
    expect(a.cashCents).toBe(700_000);
    expect(a.positions.ETH).toEqual({ symbol: 'ETH', qty: 1, costCents: 300_000 });

    const r2 = placeOrder(a, { symbol: 'ETH', side: 'SELL', qty: 0.5, price: 3200 }, {}, NO_LIMITS);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    a = r2.account;
    expect(a.cashCents).toBe(700_000 + 160_000);
    expect(a.positions.ETH?.qty).toBe(0.5);
    expect(a.positions.ETH?.costCents).toBe(150_000);
    expect(a.realizedCents).toBe(10_000); // (3200-3000)*0.5
  });

  it('weights average cost by quantity', () => {
    let a = createAccount();
    a = (placeOrder(a, { symbol: 'SOL', side: 'BUY', qty: 10, price: 100 }, {}, NO_LIMITS) as any).account;
    a = (placeOrder(a, { symbol: 'SOL', side: 'BUY', qty: 30, price: 140 }, {}, NO_LIMITS) as any).account;
    const v = valueAccount(a, { SOL: 150 });
    expect(v.rows[0].avgCost).toBeCloseTo(130, 10); // (1000+4200)/40
    expect(v.positionsValueCents).toBe(600_000);
    expect(v.unrealizedCents).toBe(600_000 - 520_000);
    expect(v.equityCents).toBe(v.cashCents + v.positionsValueCents);
  });

  it('selling everything clears cost with no float dust', () => {
    let a = createAccount();
    a = (placeOrder(a, { symbol: 'BTC', side: 'BUY', qty: 0.01234567, price: 63123.45 }, {}, NO_LIMITS) as any).account;
    a = (placeOrder(a, { symbol: 'BTC', side: 'BUY', qty: 0.00333333, price: 61000.1 }, {}, NO_LIMITS) as any).account;
    const qty = a.positions.BTC!.qty;
    const r = placeOrder(a, { symbol: 'BTC', side: 'SELL', qty, price: 62000 }, {}, NO_LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account.positions.BTC).toBeUndefined();
    expect(Number.isInteger(r.account.cashCents)).toBe(true);
    expect(r.account.cashCents).toBe(INITIAL_CASH_CENTS + r.account.realizedCents);
  });

  it('rejects insufficient cash and insufficient position', () => {
    const a = createAccount();
    const r1 = placeOrder(a, { symbol: 'BTC', side: 'BUY', qty: 1, price: 60000 }, {}, NO_LIMITS);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('INSUFFICIENT_CASH');
    const r2 = placeOrder(a, { symbol: 'BTC', side: 'SELL', qty: 0.1, price: 60000 }, {}, NO_LIMITS);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('INSUFFICIENT_POSITION');
  });

  it('rejects orders breaking risk limits', () => {
    const a = createAccount();
    const limits = { maxTradeUsd: 1000, maxPositionPct: 30 };
    const big = placeOrder(a, { symbol: 'ETH', side: 'BUY', qty: 1, price: 3000 }, {}, limits);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.code).toBe('RISK_LIMIT');
    expect(checkRisk(a, { symbol: 'ETH', side: 'BUY', qty: 0.3, price: 3000 }, {}, { maxTradeUsd: 5000, maxPositionPct: 5 }).ok).toBe(false);
    expect(checkRisk(a, { symbol: 'ETH', side: 'BUY', qty: 0.3, price: 3000 }, {}, limits).ok).toBe(true);
  });

  it('persists via storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const a = (placeOrder(createAccount(), { symbol: 'SOL', side: 'BUY', qty: 2, price: 150 }, {}, NO_LIMITS) as any).account;
    saveAccount(a, storage);
    expect(loadAccount(storage)).toEqual(a);
  });
});

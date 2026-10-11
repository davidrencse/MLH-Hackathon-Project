import { describe, expect, it } from 'vitest';
import { MarketDataService } from '../services/marketDataService';
import { generateDemoHistory } from '../services/demoData';
import { smaRule } from '../services/signalService';
import { runSmaBacktest } from '../services/backtestService';

describe('market data', () => {
  it('demo history is reproducible', () => {
    const t = Date.UTC(2026, 9, 11, 12);
    expect(generateDemoHistory('BTC', t)).toEqual(generateDemoHistory('BTC', t));
    expect(generateDemoHistory('BTC', t)).toHaveLength(168);
  });

  it('falls back to labelled DEMO data when the API fails', async () => {
    const svc = new MarketDataService({ fetchImpl: (async () => { throw new Error('offline'); }) as any });
    const h = await svc.getPriceHistory('ETH');
    expect(h.source).toBe('DEMO');
    expect(h.error).toContain('offline');
    const latest = await svc.getLatestPrices();
    expect(latest.SOL.source).toBe('DEMO');
    const sig = await svc.getTradingSignal('BTC');
    expect(sig.engine).toBe('RULE_SMA');
    expect(['BUY', 'SELL', 'HOLD']).toContain(sig.action);
  });

  it('treats HTTP 429 as failure', async () => {
    const svc = new MarketDataService({ fetchImpl: (async () => ({ ok: false, status: 429 })) as any });
    const h = await svc.getPriceHistory('BTC');
    expect(h.source).toBe('DEMO');
    expect(h.error).toMatch(/429/);
  });
});

describe('signal + backtest', () => {
  it('SMA rule detects trends', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    const down = Array.from({ length: 60 }, (_, i) => 200 - i);
    expect(smaRule(up).action).toBe('BUY');
    expect(smaRule(down).action).toBe('SELL');
    expect(smaRule(Array(60).fill(100)).action).toBe('HOLD');
  });

  it('backtest does not use future data', () => {
    const pts = generateDemoHistory('SOL', Date.UTC(2026, 0, 1));
    const full = runSmaBacktest(pts)!;
    // Mutating bars after index k must not change equity up to k.
    const k = 100;
    const tampered = pts.map((p, i) => (i > k ? { ...p, price: p.price * 3 } : p));
    const t = runSmaBacktest(tampered)!;
    const idx = full.equityCurve.findIndex((p) => p.t === pts[k].t);
    expect(t.equityCurve.slice(0, idx + 1)).toEqual(full.equityCurve.slice(0, idx + 1));
  });
});

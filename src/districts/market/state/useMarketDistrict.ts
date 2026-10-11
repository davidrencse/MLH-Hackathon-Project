// Single state hook for the district. Components get everything through MarketContext.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Account,
  AssetSymbol,
  BuildingId,
  BuildingStatus,
  LatestPrice,
  LogLevel,
  MarketEvent,
  OrderSide,
  PriceHistory,
  RiskLimits,
  TradingSignal,
} from '../types';
import { latestFromHistory, marketDataService } from '../services/marketDataService';
import { nextDemoTick } from '../services/demoData';
import { createAccount, loadAccount, placeOrder, saveAccount, valueAccount } from '../services/paperTradingService';
import { loadLimits, saveLimits } from '../services/riskService';
import { fmtPrice, fmtQty } from '../services/money';

export type MarketView = 'exterior' | 'tower' | 'floor';

const SYMBOLS: AssetSymbol[] = ['BTC', 'ETH', 'SOL'];
const LIVE_POLL_MS = 60_000;
const DEMO_TICK_MS = 4_000;
const FLASH_MS = 2_200;

export function useMarketDistrictState() {
  const [selected, setSelected] = useState<AssetSymbol>('BTC');
  const [histories, setHistories] = useState<Partial<Record<AssetSymbol, PriceHistory>>>({});
  const [latest, setLatest] = useState<Partial<Record<AssetSymbol, LatestPrice>>>({});
  const [signal, setSignal] = useState<TradingSignal | null>(null);
  const [account, setAccount] = useState<Account>(() => loadAccount());
  const [limits, setLimitsState] = useState<RiskLimits>(() => loadLimits());
  const [statuses, setStatuses] = useState<Record<BuildingId, BuildingStatus>>({
    exchange: 'IDLE',
    signal: 'IDLE',
    trading: 'IDLE',
    risk: 'IDLE',
    backtest: 'IDLE',
  });
  const [events, setEvents] = useState<MarketEvent[]>([]);
  // exterior → tower (cutaway of all floors) → floor (inside one floor)
  const [view, setView] = useState<MarketView>('exterior');
  const [openBuilding, setOpenBuildingState] = useState<BuildingId | null>(null);
  const setOpenBuilding = useCallback((id: BuildingId | null) => {
    if (id) {
      setOpenBuildingState(id);
      setView('floor');
    } else {
      setView('tower');
    }
  }, []);
  const [forceDemo, setForceDemoState] = useState(marketDataService.isForceDemo());
  const [loading, setLoading] = useState(true);
  const timers = useRef<Partial<Record<BuildingId, number>>>({});
  const tickIndex = useRef(0);
  const historiesRef = useRef(histories);
  historiesRef.current = histories;

  // ---- helpers ---------------------------------------------------------------
  const log = useCallback((building: BuildingId, level: LogLevel, message: string) => {
    setEvents((ev) => [{ id: `${Date.now()}-${Math.random()}`, at: Date.now(), building, level, message }, ...ev].slice(0, 80));
  }, []);

  const setStatus = useCallback((b: BuildingId, s: BuildingStatus) => {
    window.clearTimeout(timers.current[b]);
    setStatuses((st) => ({ ...st, [b]: s }));
    if (s === 'SUCCESS' || s === 'ERROR') {
      timers.current[b] = window.setTimeout(() => setStatuses((st) => ({ ...st, [b]: 'IDLE' })), FLASH_MS);
    }
  }, []);

  useEffect(() => saveAccount(account), [account]);
  useEffect(() => saveLimits(limits), [limits]);

  // ---- market data -----------------------------------------------------------
  const loadMarket = useCallback(
    async (refresh = false) => {
      setStatus('exchange', 'RUNNING');
      log('exchange', 'info', refresh ? 'Refreshing market feed…' : 'Connecting to market feed…');
      try {
        const hs = await Promise.all(SYMBOLS.map((s) => marketDataService.getPriceHistory(s, { refresh })));
        const lp = await marketDataService.getLatestPrices({ refresh });
        setHistories(Object.fromEntries(hs.map((h) => [h.symbol, h])));
        setLatest(lp);
        const demo = hs.filter((h) => h.source === 'DEMO');
        if (demo.length === 0) {
          setStatus('exchange', 'SUCCESS');
          log('exchange', 'success', 'LIVE feed loaded from CoinGecko (BTC, ETH, SOL).');
        } else if (marketDataService.isForceDemo()) {
          setStatus('exchange', 'SUCCESS');
          log('exchange', 'warn', 'DEMO mode on — prices are simulated, not market data.');
        } else {
          setStatus('exchange', 'ERROR');
          log('exchange', 'error', `Live feed failed (${demo[0].error ?? 'unknown'}). Switched to DEMO data.`);
        }
      } catch (e) {
        setStatus('exchange', 'ERROR');
        log('exchange', 'error', `Market load crashed: ${String(e)}`);
      } finally {
        setLoading(false);
      }
    },
    [log, setStatus],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode double-mount guard
    started.current = true;
    loadMarket();
  }, [loadMarket]);

  // Live: poll latest every 60s. Demo: simulated tick every 4s (clearly labelled in the UI).
  const anyDemo = SYMBOLS.some((s) => histories[s]?.source === 'DEMO');
  useEffect(() => {
    if (loading) return;
    const id = window.setInterval(
      async () => {
        if (anyDemo) {
          tickIndex.current++;
          setHistories((hs) => {
            const next = { ...hs };
            for (const s of SYMBOLS) {
              const h = hs[s];
              if (!h || h.source !== 'DEMO') continue;
              const last = h.points[h.points.length - 1];
              const pt = { t: last.t + 60_000, price: nextDemoTick(s, last.price, tickIndex.current) };
              next[s] = { ...h, points: [...h.points.slice(1), pt], updatedAt: Date.now() };
            }
            setLatest((lp) => {
              const out = { ...lp };
              for (const s of SYMBOLS) if (next[s]?.source === 'DEMO') out[s] = latestFromHistory(next[s]!);
              return out;
            });
            return next;
          });
        } else {
          try {
            const lp = await marketDataService.getLatestPrices({ refresh: true });
            setLatest(lp);
          } catch {
            log('exchange', 'warn', 'Price poll failed; keeping last known prices.');
          }
        }
      },
      anyDemo ? DEMO_TICK_MS : LIVE_POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [anyDemo, loading, log]);

  const setForceDemo = useCallback(
    (v: boolean) => {
      marketDataService.setForceDemo(v);
      setForceDemoState(v);
      log('exchange', 'info', v ? 'Switching to DEMO data source.' : 'Switching to LIVE data source.');
      loadMarket(true);
    },
    [loadMarket, log],
  );

  // ---- signal ----------------------------------------------------------------
  const runSignal = useCallback(
    async (symbol: AssetSymbol = selected) => {
      setStatus('signal', 'RUNNING');
      log('signal', 'info', `Running SMA rule on ${symbol}…`);
      try {
        // Short pause so the RUNNING animation is visible; the rule itself is instant.
        await new Promise((r) => setTimeout(r, 700));
        const s = await marketDataService.getTradingSignal(symbol, historiesRef.current[symbol]);
        setSignal(s);
        setStatus('signal', 'SUCCESS');
        log('signal', s.action === 'HOLD' ? 'info' : 'success', `${symbol}: ${s.action} (spread ${s.metrics.spreadPct.toFixed(2)}%)`);
      } catch (e) {
        setStatus('signal', 'ERROR');
        log('signal', 'error', `Signal failed: ${String(e)}`);
      }
    },
    [log, selected, setStatus],
  );

  // ---- trading ---------------------------------------------------------------
  const prices = useMemo(() => {
    const p: Partial<Record<AssetSymbol, number>> = {};
    for (const s of SYMBOLS) if (latest[s]) p[s] = latest[s]!.price;
    return p;
  }, [latest]);

  const valuation = useMemo(() => valueAccount(account, prices), [account, prices]);

  const submitOrder = useCallback(
    (symbol: AssetSymbol, side: OrderSide, qty: number) => {
      const price = prices[symbol];
      setStatus('trading', 'RUNNING');
      const res = placeOrder(account, { symbol, side, qty, price: price ?? NaN }, prices, limits);
      if (res.ok) {
        setAccount(res.account);
        setStatus('trading', 'SUCCESS');
        log('trading', 'success', `PAPER ${side} ${fmtQty(res.fill.qty)} ${symbol} @ ${fmtPrice(res.fill.priceCents / 100)}`);
        return { ok: true as const, message: `Filled (paper): ${side} ${fmtQty(res.fill.qty)} ${symbol}` };
      }
      setStatus('trading', 'ERROR');
      if (res.code === 'RISK_LIMIT') {
        setStatus('risk', 'ERROR');
        log('risk', 'error', `RISK BLOCK ${side} ${symbol}: ${res.reason}`);
      } else {
        log('risk', 'warn', `Order error ${side} ${symbol}: ${res.reason}`);
      }
      log('trading', 'error', `Rejected ${side} ${symbol}: ${res.reason}`);
      return { ok: false as const, message: res.reason };
    },
    [account, limits, log, prices, setStatus],
  );

  const resetAccount = useCallback(() => {
    setAccount(createAccount());
    log('trading', 'warn', 'Paper account reset to $10,000.');
  }, [log]);

  const setLimits = useCallback(
    (l: RiskLimits) => {
      setLimitsState(l);
      setStatus('risk', 'SUCCESS');
      log('risk', 'info', `Limits updated: max trade $${l.maxTradeUsd}, max position ${l.maxPositionPct}%.`);
    },
    [log, setStatus],
  );

  return {
    symbols: SYMBOLS,
    assets: marketDataService.getAssets(),
    selected,
    setSelected,
    histories,
    latest,
    prices,
    loading,
    forceDemo,
    setForceDemo,
    reloadMarket: () => loadMarket(true),
    signal,
    runSignal,
    account,
    valuation,
    submitOrder,
    resetAccount,
    limits,
    setLimits,
    statuses,
    setStatus,
    events,
    log,
    view,
    setView,
    openBuilding,
    setOpenBuilding,
  };
}

export type MarketState = ReturnType<typeof useMarketDistrictState>;
export const MarketContext = createContext<MarketState | null>(null);
export function useMarket(): MarketState {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used inside <MarketDistrict>');
  return ctx;
}

// Shared types for the Market District. No React imports here so services stay framework-free.

export type AssetSymbol = 'BTC' | 'ETH' | 'SOL';

export interface Asset {
  symbol: AssetSymbol;
  name: string;
  /** CoinGecko id, used by the live adapter. */
  coingeckoId: string;
  color: string;
}

export interface PricePoint {
  t: number; // epoch ms
  price: number; // USD
}

/** Where a number came from. Anything other than LIVE must be shown as DEMO in the UI. */
export type DataSource = 'LIVE' | 'DEMO';

export interface PriceHistory {
  symbol: AssetSymbol;
  points: PricePoint[];
  source: DataSource;
  /** When this data was fetched / generated (epoch ms). */
  updatedAt: number;
  /** Populated when we fell back to demo data. */
  error?: string;
}

export interface LatestPrice {
  symbol: AssetSymbol;
  price: number;
  change24hPct: number;
  source: DataSource;
  updatedAt: number;
}

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface TradingSignal {
  symbol: AssetSymbol;
  action: SignalAction;
  /** 0..1, how far the SMA spread is from the threshold. Not a probability. */
  strength: number;
  reasons: string[];
  risks: string[];
  /** Which engine produced the signal. RULE_SMA is a deterministic rule, not AI. */
  engine: 'RULE_SMA' | 'LLM_AGENT';
  generatedAt: number;
  dataSource: DataSource;
  metrics: { smaShort: number; smaLong: number; shortWindow: number; longWindow: number; spreadPct: number };
}

export type OrderSide = 'BUY' | 'SELL';

export interface Position {
  symbol: AssetSymbol;
  /** Quantity in base units, max 8 decimals. */
  qty: number;
  /** Total cost of the current position, in integer cents. */
  costCents: number;
}

export interface Fill {
  id: string;
  symbol: AssetSymbol;
  side: OrderSide;
  qty: number;
  priceCents: number;
  notionalCents: number;
  /** Realized PnL in cents (sells only). */
  realizedCents: number;
  at: number;
}

export interface Account {
  cashCents: number;
  positions: Partial<Record<AssetSymbol, Position>>;
  fills: Fill[];
  realizedCents: number;
  createdAt: number;
}

export interface RiskLimits {
  /** Maximum notional per order, USD. */
  maxTradeUsd: number;
  /** Max share of total equity a single asset may occupy after a buy, 0..100. */
  maxPositionPct: number;
}

export type BuildingId = 'exchange' | 'signal' | 'trading' | 'risk' | 'backtest';
export type BuildingStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'ERROR';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export interface MarketEvent {
  id: string;
  at: number;
  building: BuildingId;
  level: LogLevel;
  message: string;
}

/** A non-interactive building around Market Tower. Positions are world px, tower centred at x=0, z=0 (+z = towards camera). */
export interface CityBlock {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Neon accent colour. */
  color: string;
  /** Optional vertical neon sign on the front face. */
  sign?: string;
  roof?: 'flat' | 'antenna' | 'billboard';
  /** Billboard text when roof = 'billboard'. */
  billboard?: string;
}

// Money helpers. Cash and cost basis are kept in integer cents; quantities are rounded to 8 decimals.

export const QTY_DECIMALS = 8;
const QTY_SCALE = 10 ** QTY_DECIMALS;

export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => cents / 100;

/** Round a quantity down to 8 decimals (never buy/sell more than requested). */
export const floorQty = (qty: number): number => Math.floor(qty * QTY_SCALE + 1e-6) / QTY_SCALE;
export const roundQty = (qty: number): number => Math.round(qty * QTY_SCALE) / QTY_SCALE;

/** qty * price, in integer cents. */
export const notionalCents = (qty: number, priceUsd: number): number => Math.round(qty * priceUsd * 100);

export const fmtUsd = (usd: number, digits = 2): string =>
  usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtCents = (cents: number): string => fmtUsd(fromCents(cents));
export const fmtPrice = (usd: number): string => fmtUsd(usd, usd >= 1000 ? 2 : usd >= 1 ? 2 : 4);
export const fmtQty = (qty: number): string => qty.toLocaleString('en-US', { maximumFractionDigits: 8 });
export const fmtPct = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

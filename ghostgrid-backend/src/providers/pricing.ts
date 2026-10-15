import { knownCount } from "./usage.js";
import type { ProviderConfig } from "./types.js";

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}
export interface PricingResolution {
  pricing: Pricing | null;
  /** Where the rate came from, so a cost estimate can be audited. */
  source: "provider" | "environment" | "none";
  /** Set only when a configured rate was rejected, so the operator can be told. */
  warning?: string;
}

/**
 * Token prices are configuration, never built in: Ghost Grid ships no vendor price list
 * and never guesses a rate, because a guessed cost reads exactly like a billed one. A
 * request whose price is not configured is recorded with `costSource: "unknown"` and
 * counted in `unknownCostRequests`.
 *
 * Two ways to configure a rate, highest precedence first:
 *
 * 1. Per provider record, through the API — `PATCH /api/v1/providers/:id` with
 *    `{"pricing":{"inputPerMillion":0.27,"outputPerMillion":1.10}}`.
 * 2. `GHOSTGRID_PRICING`, a JSON object of fallbacks for providers that carry no
 *    `pricing` of their own, so a whole deployment can be priced from the environment:
 *
 *    GHOSTGRID_PRICING='{
 *      "15ea92f0-2274-4b6e-8d8b-38ab87da0071": {"inputPerMillion":0.27,"outputPerMillion":1.10},
 *      "openai-compatible:openai/gpt-oss-20b": {"inputPerMillion":0.10,"outputPerMillion":0.50},
 *      "deepseek-flash": {"inputPerMillion":0.27,"outputPerMillion":1.10},
 *      "claude": {"inputPerMillion":3.00,"outputPerMillion":15.00}
 *    }'
 *
 *    Keys are matched most specific first: provider record id, `type:model`, `model`,
 *    `type`, then `default`. Rates are USD per million tokens, taken from the vendor's
 *    own price page by whoever sets the variable.
 *
 * Cost estimated this way is labelled `costSource: "estimated"` and summed separately
 * from `reportedCostUsd`, which only ever holds a figure a vendor itself returned.
 */
export const PRICING_ENV = "GHOSTGRID_PRICING";

const cache = new Map<string, { table: Map<string, Pricing>; warning?: string }>();

const rate = (value: unknown): Pricing | null => {
  const row = value as { inputPerMillion?: unknown; outputPerMillion?: unknown } | null;
  if (!row || typeof row !== "object") return null;
  if (!knownCount(row.inputPerMillion) || !knownCount(row.outputPerMillion)) return null;
  return { inputPerMillion: row.inputPerMillion, outputPerMillion: row.outputPerMillion };
};

function table(raw: string) {
  const cached = cache.get(raw);
  if (cached) return cached;
  const parsed: { table: Map<string, Pricing>; warning?: string } = { table: new Map() };
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    parsed.warning = `${PRICING_ENV} is not valid JSON; no environment token prices were loaded`;
    cache.set(raw, parsed);
    return parsed;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    parsed.warning = `${PRICING_ENV} must be a JSON object of {key: {inputPerMillion, outputPerMillion}}`;
    cache.set(raw, parsed);
    return parsed;
  }
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const price = rate(value);
    if (price) parsed.table.set(key, price);
    else rejected.push(key);
  }
  if (rejected.length)
    parsed.warning = `${PRICING_ENV} entries ignored (need nonnegative inputPerMillion and outputPerMillion): ${rejected.slice(0, 10).join(", ")}`;
  cache.set(raw, parsed);
  return parsed;
}

/** Candidate lookup keys for one provider, most specific first. */
export function pricingKeys(config: Partial<ProviderConfig>): string[] {
  const keys = [
    config.id,
    config.type && config.model ? `${config.type}:${config.model}` : undefined,
    config.model,
    config.type,
    "default",
  ];
  return keys.filter((key): key is string => typeof key === "string" && key.length > 0);
}

export function resolvePricing(
  config: Partial<ProviderConfig> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PricingResolution {
  const own = rate(config?.pricing);
  if (own) return { pricing: own, source: "provider" };
  const raw = env[PRICING_ENV]?.trim();
  if (!raw) return { pricing: null, source: "none" };
  const { table: rates, warning } = table(raw);
  for (const key of pricingKeys(config ?? {})) {
    const price = rates.get(key);
    if (price) return { pricing: price, source: "environment", ...(warning ? { warning } : {}) };
  }
  return { pricing: null, source: "none", ...(warning ? { warning } : {}) };
}

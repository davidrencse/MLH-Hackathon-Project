export interface CreditRow {
  /** Provider record id when the row came from recorded usage, else the vendor key. */
  id?: string;
  /** Provider record name when known, else the vendor label. */
  name?: string;
  provider: string;
  status: 'ok' | 'nokey' | 'unsupported' | 'error';
  /** USD remaining, when the provider exposes a real balance. */
  balanceUsd?: number;
  /** Request/token quota for the current window, when the provider exposes one. */
  quota?: {
    limitTokens: number;
    remainingTokens: number;
    limitRequests: number;
    remainingRequests: number;
    resetTokens: string;
    resetRequests: string;
  };
  currency?: string;
  detail?: string;
  /** Durable token usage recorded by the backend for this vendor. */
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  requests?: number;
  reportedCostUsd?: number;
  estimatedCostUsd?: number;
  unknownCostRequests?: number;
  unknownTokenRequests?: number;
  /** 'vendor' = read from a provider API; 'local-cli' = read from a coding CLI's transcripts. */
  source?: 'vendor' | 'local-cli';
  /** Cached prompt tokens, split out because they dominate agent traffic and are priced apart. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Rolling plan windows a subscription CLI reports, as a used percentage each. */
  windows?: { label: string; usedPercent: number; resetsAt?: string }[];
  /** Subscription plan name, when the CLI reports one ('plus', 'max', …). */
  plan?: string;
  /** Transcripts/sessions the row was summed from. */
  sessions?: number;
  /** ISO timestamp of the newest response counted. */
  lastActivity?: string;
  /** Biggest models by tokens, for the row's tooltip. */
  models?: { model: string; tokens: number; requests: number }[];
}

/** One row of `store.usageSummary().providers` — real usage records, grouped by provider. */
export interface UsageProviderRow {
  providerId: string | null;
  name: string | null;
  type: string | null;
  baseUrl?: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number;
  estimatedCostUsd: number;
  unknownCostRequests: number;
  unknownTokenRequests: number;
}

const failed = (provider: string, e: unknown): CreditRow => ({
  provider,
  status: 'error',
  detail: e instanceof Error ? e.message : 'fetch failed',
})

// DeepSeek publishes a real prepaid balance.
async function deepseekCredit(key: string): Promise<CreditRow> {
  if (!key) return { provider: 'deepseek', status: 'nokey', detail: 'No DEEPSEEK_API_KEY' }
  try {
    const r = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { provider: 'deepseek', status: 'error', detail: `HTTP ${r.status}` }
    const j = (await r.json()) as {
      is_available?: boolean
      balance_infos?: { currency: string; total_balance: string }[]
    }
    const info = j.balance_infos?.find(info => info.currency.toUpperCase() === 'USD')
    if (!info || !Number.isFinite(Number(info.total_balance)) || Number(info.total_balance) < 0) return { provider: 'deepseek', status: 'error', detail: 'No balance_infos in response' }
    return {
      provider: 'deepseek',
      status: 'ok',
      balanceUsd: Number(info.total_balance),
      currency: info.currency,
      detail: j.is_available ? 'Account active' : 'Account not available',
    }
  } catch (e) {
    return failed('deepseek', e)
  }
}

// Groq has no balance or usage endpoint — every /usage, /billing and credit_grants path
// 404s. The only real quota signal is the x-ratelimit-* headers, and those ride on
// completions only (/models carries none). So spend the smallest possible completion on the
// cheapest model to read them: ~80 prompt + 1 completion token per call, which is why the
// client caches the result and only refetches on demand.
async function groqCredit(key: string): Promise<CreditRow> {
  if (!key) return { provider: 'groq', status: 'nokey', detail: 'No GROQ_API_KEY' }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) return { provider: 'groq', status: 'error', detail: `HTTP ${r.status}` }
    const h = (n: string) => r.headers.get(n) ?? ''
    const num = (n: string) => h(n) ? Number(h(n)) : NaN
    if (!['x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests'].every(n => Number.isFinite(num(n)) && num(n) >= 0)) return { provider: 'groq', status: 'unsupported', detail: 'Quota unavailable' }
    return {
      provider: 'groq',
      status: 'ok',
      quota: {
        limitTokens: num('x-ratelimit-limit-tokens'),
        remainingTokens: num('x-ratelimit-remaining-tokens'),
        limitRequests: num('x-ratelimit-limit-requests'),
        remainingRequests: num('x-ratelimit-remaining-requests'),
        resetTokens: h('x-ratelimit-reset-tokens'),
        resetRequests: h('x-ratelimit-reset-requests'),
      },
      detail: 'Groq exposes no balance endpoint — this is live rate-limit quota',
    }
  } catch (e) {
    return failed('groq', e)
  }
}

// Anthropic does not expose a remaining balance endpoint.
function anthropicCredit(key: string): CreditRow {
  if (!key) return { provider: 'anthropic', status: 'nokey', detail: 'No ANTHROPIC_API_KEY' }
  return {
    provider: 'anthropic',
    status: 'unsupported',
    detail: 'Anthropic publishes no balance endpoint for API keys',
  }
}

export class ProviderCredits {
  private snapshot: { fetchedAt: number; rows: CreditRow[] } | null = null;
  private inflight: Promise<{ fetchedAt: number; rows: CreditRow[] }> | null = null;
  async read(force = false) {
    if (this.inflight) return this.inflight;
    if (!force && this.snapshot && Date.now() - this.snapshot.fetchedAt < 600_000) return this.snapshot;
    this.inflight = Promise.all([
      deepseekCredit(process.env.DEEPSEEK_API_KEY ?? ''),
      groqCredit(process.env.GROQ_API_KEY ?? ''),
      Promise.resolve(anthropicCredit(process.env.ANTHROPIC_API_KEY ?? '')),
    ]).then(rows => {
      this.snapshot = { fetchedAt: Date.now(), rows };
      return this.snapshot;
    }).finally(() => { this.inflight = null });
    return this.inflight;
  }
}

/** Vendor key for a provider record, from its base URL first and its type second. */
export function vendorOf(type?: string | null, baseUrl?: string | null): string | null {
  const host = (() => {
    try { return baseUrl ? new URL(baseUrl).hostname : '' } catch { return '' }
  })();
  if (host.includes('deepseek')) return 'deepseek';
  if (host.includes('groq')) return 'groq';
  if (host.includes('anthropic')) return 'anthropic';
  if (host.includes('openai.com')) return 'openai';
  switch (type) {
    case 'deepseek':
    case 'deepseek-browser':
      return 'deepseek';
    case 'claude':
    case 'claude-browser':
      return 'anthropic';
    case 'codex':
    case 'chatgpt-browser':
      return 'openai';
    default:
      return null;
  }
}

const zeroUsage = () => ({
  requests: 0, inputTokens: 0, outputTokens: 0, reportedCostUsd: 0,
  estimatedCostUsd: 0, unknownCostRequests: 0, unknownTokenRequests: 0,
});

const addUsage = (into: ReturnType<typeof zeroUsage>, row: UsageProviderRow) => {
  for (const key of Object.keys(into) as (keyof ReturnType<typeof zeroUsage>)[]) into[key] += Number(row[key] ?? 0);
  return into;
};

/**
 * Attaches the backend's own usage records to the balance rows, so a provider without a
 * balance API still reports what it really spent. Usage that maps to no known vendor
 * (custom OpenAI-compatible endpoints, the mock provider) is appended as its own row.
 */
export function withRecordedUsage(rows: CreditRow[], providers: UsageProviderRow[] = []): CreditRow[] {
  const byVendor = new Map<string, ReturnType<typeof zeroUsage>>();
  const extra: CreditRow[] = [];
  for (const row of providers) {
    const vendor = vendorOf(row.type, row.baseUrl);
    if (vendor) {
      addUsage(byVendor.get(vendor) ?? byVendor.set(vendor, zeroUsage()).get(vendor)!, row);
      continue;
    }
    const totals = addUsage(zeroUsage(), row);
    extra.push({
      id: row.providerId ?? undefined,
      name: row.name ?? row.type ?? 'Unknown provider',
      provider: row.type ?? 'unknown',
      status: 'unsupported',
      detail: 'Usage recorded by the backend; this provider publishes no balance endpoint',
      ...totals,
      tokensUsed: totals.inputTokens + totals.outputTokens,
    });
  }
  const merged = rows.map(row => {
    const totals = byVendor.get(row.provider);
    byVendor.delete(row.provider);
    if (!totals) return { ...row, id: row.provider, tokensUsed: 0, ...zeroUsage() };
    return {
      ...row,
      id: row.provider,
      ...totals,
      tokensUsed: totals.inputTokens + totals.outputTokens,
    };
  });
  // A vendor we spent tokens on but hold no key for still gets a row, so the usage shows up.
  for (const [vendor, totals] of byVendor) {
    merged.push({
      id: vendor,
      provider: vendor,
      status: 'unsupported',
      detail: 'Usage recorded by the backend; no balance endpoint read for this vendor',
      ...totals,
      tokensUsed: totals.inputTokens + totals.outputTokens,
    });
  }
  return [...merged, ...extra];
}

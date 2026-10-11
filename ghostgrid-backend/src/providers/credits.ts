export interface CreditRow {
  demoTokens?: number
  demo?: boolean
  provider: string
  status: 'ok' | 'nokey' | 'unsupported' | 'error'
  /** USD remaining, when the provider exposes a real balance. */
  balanceUsd?: number
  /** Request/token quota for the current window, when the provider exposes one. */
  quota?: {
    limitTokens: number
    remainingTokens: number
    limitRequests: number
    remainingRequests: number
    resetTokens: string
    resetRequests: string
  }
  currency?: string
  detail?: string
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
      this.snapshot = { fetchedAt: Date.now(), rows: rows.map(row => row.status === 'ok' ? row : {
        ...row, demo: true, demoTokens: 100_000, detail: `${row.detail ?? 'Provider balance unavailable'}. Demo allowance; not a live provider balance.`,
      }) };
      return this.snapshot;
    }).finally(() => { this.inflight = null });
    return this.inflight;
  }
}

// Dev-only provider credits relay: GET /gg-dev/credits.
//
// Kept in its own file (rather than inline in vite.config.ts) so it survives edits to the
// shared config — that file only needs the import and the plugin entry.
//
// It exists for two reasons the browser cannot work around:
//  1. Groq sends no `access-control-expose-headers`, so page JS can never read the
//     `x-ratelimit-*` headers even though the request itself is CORS-allowed.
//  2. Keys stay in this node process, so no provider secret is shipped to the client.
//
// `apply: 'serve'` keeps it out of `vite build` entirely.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

// The backend repo's .env is the single place keys live on this machine (mode 0600,
// gitignored). The frontend never gets a copy, and nothing key-shaped is ever prefixed
// VITE_, so no key can reach the client bundle. Override with GG_KEY_ENV_FILE.
const KEY_ENV_FILE = process.env.GG_KEY_ENV_FILE ?? path.resolve(import.meta.dirname, '../../../ghostgrid-backend/.env')

function readKeys(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of fs.readFileSync(KEY_ENV_FILE, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

interface CreditRow {
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
    const info = j.balance_infos?.[0]
    if (!info) return { provider: 'deepseek', status: 'error', detail: 'No balance_infos in response' }
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
    if (!r.ok) return { provider: 'groq', status: 'error', detail: `HTTP ${r.status} ${(await r.text()).slice(0, 120)}` }
    const h = (n: string) => r.headers.get(n) ?? ''
    const num = (n: string) => Number(h(n) || 0)
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

// Anthropic and OpenAI both gate spend behind an *admin* credential, not the API key used
// for inference: Anthropic has no per-key balance endpoint at all, and OpenAI's
// /v1/organization/costs needs an sk-admin- key. Report that honestly rather than inventing
// a number — a fake credit figure is worse than a blank one.
function anthropicCredit(key: string): CreditRow {
  if (!key) return { provider: 'anthropic', status: 'nokey', detail: 'No ANTHROPIC_API_KEY' }
  return {
    provider: 'anthropic',
    status: 'unsupported',
    detail: 'Anthropic publishes no balance endpoint for API keys',
  }
}

async function openaiCredit(key: string): Promise<CreditRow> {
  if (!key) return { provider: 'openai', status: 'nokey', detail: 'No OPENAI_API_KEY' }
  if (!key.startsWith('sk-admin-'))
    return {
      provider: 'openai',
      status: 'unsupported',
      detail: 'Spend needs an sk-admin- key (/v1/organization/costs)',
    }
  try {
    const start = Math.floor(Date.now() / 1000) - 24 * 3600
    const r = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { provider: 'openai', status: 'error', detail: `HTTP ${r.status}` }
    const j = (await r.json()) as { data?: { results?: { amount?: { value: number; currency: string } }[] }[] }
    const amount = j.data?.[0]?.results?.[0]?.amount
    // Costs are spend, not remaining credit: report it as a negative so the UI can label it.
    return amount
      ? { provider: 'openai', status: 'ok', balanceUsd: -amount.value, currency: amount.currency, detail: 'Spend in the last 24h' }
      : { provider: 'openai', status: 'ok', balanceUsd: 0, currency: 'usd', detail: 'No spend in the last 24h' }
  } catch (e) {
    return failed('openai', e)
  }
}

export function ggCreditsRelay(): Plugin {
  return {
    name: 'gg-credits-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/gg-dev/credits', (_req, res) => {
        const env = readKeys()
        void Promise.all([
          deepseekCredit(env.DEEPSEEK_API_KEY ?? ''),
          groqCredit(env.GROQ_API_KEY ?? ''),
          Promise.resolve(anthropicCredit(env.ANTHROPIC_API_KEY ?? '')),
          openaiCredit(env.OPENAI_API_KEY ?? ''),
        ]).then(
          (rows) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify({ fetchedAt: Date.now(), keyFile: KEY_ENV_FILE, rows }))
          },
          (e: unknown) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'relay failed' }))
          },
        )
      })
    },
  }
}

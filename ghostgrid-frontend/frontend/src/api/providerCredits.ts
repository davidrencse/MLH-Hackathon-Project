// Credits show durable usage recorded by the backend, including explicit unknown costs.
import type { Provider } from '../types'
import { backend, type BackendUsageSummary } from './backend.ts'
import { backendStatus, PROJECT_ID } from './config.ts'

export type CreditStatus = 'ok' | 'nokey' | 'unsupported' | 'error' | 'loading'

export interface CreditQuota {
  limitTokens: number
  remainingTokens: number
  limitRequests: number
  remainingRequests: number
  resetTokens: string
  resetRequests: string
}

export interface CreditRow {
  /** A vendor key, or a provider record's own type when it maps to no vendor ('mock'). */
  provider: Provider | string
  status: CreditStatus
  balanceUsd?: number
  quota?: CreditQuota
  currency?: string
  detail?: string
  id?: string
  name?: string
  /** Tokens the backend actually recorded for this provider. */
  tokensUsed?: number
  inputTokens?: number
  outputTokens?: number
  reportedCostUsd?: number
  estimatedCostUsd?: number
  unknownCostRequests?: number
  unknownTokenRequests?: number
  requests?: number
  /** 'vendor' = read from a provider API; 'local-cli' = read from a coding CLI's own transcripts. */
  source?: 'vendor' | 'local-cli'
  /** Cached prompt tokens, split out because they dominate agent traffic. */
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Rolling plan windows a subscription CLI reports, as a used percentage each. */
  windows?: { label: string; usedPercent: number; resetsAt?: string }[]
  /** Subscription plan name, when the CLI reports one ('plus', 'max', …). */
  plan?: string
  /** Transcripts the row was summed from. */
  sessions?: number
  /** ISO timestamp of the newest response counted. */
  lastActivity?: string
  /** Biggest models by tokens, for the row tooltip. */
  models?: { model: string; tokens: number; requests: number }[]
}

/** Providers shown in the dropdown, in display order. */
export const CREDIT_PROVIDERS: Provider[] = ['deepseek', 'groq', 'anthropic', 'openai']

/** Display name for the dropdown — what the user calls it, not the vendor's legal name. */
export const CREDIT_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  groq: 'Groq',
  anthropic: 'Claude',
  openai: 'ChatGPT',
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
}

/** A subscription CLI read from its local transcripts rather than from a vendor API. */
export const isLocalCli = (row: CreditRow): boolean => row.source === 'local-cli'

/**
 * Fresh (non-cached) tokens a row stands for: input + output, which is what the city's usage
 * ledger counts as currency. A CLI's `tokensUsed` also folds in cache reads — an order of
 * magnitude larger — so reading that field here made this panel disagree with the HUD by ~60x.
 * Kept here, next to the row type, so the ledger and the dropdown can never drift apart.
 *
 * A backend too old to split input/output only reports `tokensUsed`; falling back to it is
 * better than a confident zero.
 */
export const freshCreditTokens = (row: CreditRow): number =>
  row.inputTokens == null && row.outputTokens == null
    ? (row.tokensUsed ?? 0)
    : (row.inputTokens ?? 0) + (row.outputTokens ?? 0)

/** Cache reads + writes a CLI reports on top of its fresh tokens. */
export const cachedCreditTokens = (row: CreditRow): number => (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0)

/** The worst-off plan window, which is the one the row's bar and colour follow. */
const tightestWindow = (row: CreditRow) =>
  row.windows?.length ? row.windows.reduce((worst, w) => (w.usedPercent > worst.usedPercent ? w : worst)) : null

export interface CreditsSnapshot {
  rows: CreditRow[]
  fetchedAt: number
  /** 'relay' = dev server read the keys server-side; 'browser' = direct from the keys store. */
  via: 'relay' | 'browser' | 'backend'
  usage?: BackendUsageSummary
  /** True when the backend is unreachable, so there are no recorded numbers to show. */
  offline?: boolean
}

/**
 * Reads provider balances and the backend's own usage records. The numbers are whatever the
 * backend recorded; an unreachable backend reports no rows rather than a stand-in figure.
 *
 * The two reads are kept independent on purpose: balances come from the vendors and can fail
 * on their own (a rejected key, a provider outage), and a backend that cannot serve them
 * still knows what we spent. Either half alone is enough to show real numbers.
 *
 * `refreshVendors` makes the backend re-poll every vendor API and re-read the CLI transcripts.
 * That is a user action (the dropdown's refresh button), not something to do on every recorded
 * request: the automatic reload after a `usage.updated` event used to force it, which spent a
 * vendor rate-limit call per LLM request and made the whole snapshot — CLI rows included —
 * hostage to the slowest provider.
 */
export async function fetchCredits(refreshVendors = false): Promise<CreditsSnapshot> {
  if (!(await backendStatus()).live) return { fetchedAt: Date.now(), via: 'browser', rows: [], offline: true }
  // The credits route carries the usage summary, so the happy path is ONE request. The
  // second read is only for the cases that leave usage missing: a backend too old to embed
  // it, or a credits call that failed on its own.
  const credits = await backend.providerCredits(refreshVendors, PROJECT_ID ?? undefined).catch(() => null)
  if (credits?.usage) return { fetchedAt: Date.now(), via: 'backend', rows: credits.rows, usage: credits.usage }
  const usage = await backend.usageSummary(PROJECT_ID ?? undefined).catch(() => undefined)
  if (!credits && !usage) throw new Error('backend returned neither credits nor usage')
  return { fetchedAt: Date.now(), via: 'backend', rows: credits?.rows ?? [], usage }
}

// ---- formatting ----

/** Short token figure for a tight HUD line: "87", "7.9k", "11.7M". */
export const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

/** Big value for a row, e.g. "7.7k tok used" or "$19.76". */
export function creditValue(row: CreditRow): string {
  if (row.status === 'loading') return '…'
  // A CLI reports fresh tokens *and* cache reads; only the fresh ones are the city's currency,
  // so the headline shows those and the cache figure rides in the sub-line. It gets the short
  // label ("tok", not "tok used") to keep the row inside the 320px panel.
  if (isLocalCli(row)) {
    const fresh = freshCreditTokens(row)
    return fresh ? `${fmtTok(fresh)} tok` : row.status === 'error' ? 'ERR' : '0 tok'
  }
  // Recorded tokens come from our own usage records, so they are shown even when the vendor
  // publishes no balance and the row's status says so.
  if (row.tokensUsed) return `${fmtTok(row.tokensUsed)} tok used`
  if (row.status === 'nokey') return 'NO KEY'
  if (row.status === 'error') return 'ERR'
  if (row.balanceUsd != null) return `$${row.balanceUsd.toFixed(2)}`
  if (row.quota) return `${fmtTok(row.quota.remainingTokens)} tok left`
  if (row.requests) return '—'
  return '0 tok used'
}

/** Small secondary line, e.g. "$0.0124 reported · $4.10 USD left". */
export function creditSub(row: CreditRow): string {
  if (row.status === 'loading') return 'reading…'
  if (row.status === 'error') return row.detail ?? 'failed'
  // A subscription CLI has no balance and no per-request price, so the second line carries
  // what it does know: how much of the plan window is gone, and how much traffic the headline
  // leaves out because it was served from cache. Both at once overflows 320px, so the window
  // wins and the full split lives in the row tooltip (`creditDetail`).
  if (isLocalCli(row)) {
    const parts = [`${row.requests ?? 0} req`]
    const worst = tightestWindow(row)
    const cached = cachedCreditTokens(row)
    if (worst) parts.push(`${Math.round(worst.usedPercent)}% of ${worst.label}`)
    else if (cached) parts.push(`+${fmtTok(cached)} cached`)
    if (row.plan) parts.push(row.plan.toUpperCase())
    return parts.join(' · ')
  }
  const parts: string[] = []
  if (row.tokensUsed || row.requests) {
    const cost = (row.reportedCostUsd ?? 0) + (row.estimatedCostUsd ?? 0)
    parts.push(
      cost > 0
        ? `$${cost.toFixed(4)}${row.estimatedCostUsd ? ' incl. estimates' : ' reported'}`
        : `${row.requests ?? 0} req${row.unknownCostRequests ? `, ${row.unknownCostRequests} unpriced` : ''}`,
    )
  }
  if (row.balanceUsd != null) parts.push(`$${row.balanceUsd.toFixed(2)} ${row.currency?.toUpperCase() ?? 'USD'} left`)
  else if (row.quota) parts.push(`${row.quota.remainingRequests}/${row.quota.limitRequests} req · resets ${row.quota.resetRequests}`)
  else if (row.status === 'nokey') parts.push('add a key')
  else if (row.status === 'unsupported' && !parts.length) parts.push('no usage recorded yet')
  else if (row.status === 'unsupported') parts.push('no balance API')
  return parts.join(' · ')
}

/** 0..1 bar fill, or null when the provider gives no denominator to divide by. */
export function creditPct(row: CreditRow): number | null {
  if (row.quota?.limitTokens) return Math.max(0, Math.min(1, row.quota.remainingTokens / row.quota.limitTokens))
  // Plan windows are reported as the share used, so the bar shows what is left of the window.
  const worst = tightestWindow(row)
  if (worst) return Math.max(0, Math.min(1, 1 - worst.usedPercent / 100))
  return null
}

export type CreditLevel = 'ok' | 'warn' | 'alert' | 'off'

export function creditLevel(row: CreditRow): CreditLevel {
  if (row.status === 'error') return 'alert'
  if (row.balanceUsd != null) return row.balanceUsd <= 1 ? 'alert' : row.balanceUsd <= 5 ? 'warn' : 'ok'
  const pct = creditPct(row)
  if (pct != null) return pct <= 0.1 ? 'alert' : pct <= 0.3 ? 'warn' : 'ok'
  if (row.tokensUsed) return 'ok'
  return row.status === 'nokey' ? 'off' : row.status === 'ok' ? 'ok' : 'off'
}

/** Tokens a local CLI row stands for, as a long tooltip line with its top models. */
export function creditDetail(row: CreditRow): string | undefined {
  if (!isLocalCli(row)) return row.detail ?? undefined
  const models = row.models?.map((m) => `${m.model} ${fmtTok(m.tokens)} (${m.requests} req)`).join(', ')
  const windows = row.windows?.map((w) => `${w.label} ${Math.round(w.usedPercent)}% used`).join(', ')
  const cached = cachedCreditTokens(row)
  return [
    row.detail,
    row.sessions ? `${row.sessions} transcripts` : null,
    // The headline counts fresh tokens only, so the cache figure is stated as the extra it is.
    cached ? `${fmtTok(freshCreditTokens(row))} fresh tokens plus ${fmtTok(cached)} served from cache` : null,
    windows ? `Plan windows: ${windows}` : null,
    models ? `Models: ${models}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Sum of the real money we can actually see, for the chip's sub-line. null = nothing readable. */
export function totalKnownUsd(rows: CreditRow[]): number | null {
  const known = rows.filter((r) => r.status === 'ok' && r.balanceUsd != null)
  return known.length ? known.reduce((a, r) => a + (r.balanceUsd ?? 0), 0) : null
}

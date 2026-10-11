// Credits show durable usage recorded by the backend, including explicit unknown costs.
import type { Provider } from '../types'
import { backend, type BackendUsageSummary } from './backend'
import { backendStatus, PROJECT_ID } from './config'

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
  provider: Provider
  demo?: boolean
  demoTokens?: number
  status: CreditStatus
  balanceUsd?: number
  quota?: CreditQuota
  currency?: string
  detail?: string
  id?: string
  name?: string
  tokensUsed?: number
  reportedCostUsd?: number
  estimatedCostUsd?: number
  unknownCostRequests?: number
  unknownTokenRequests?: number
  requests?: number
}

/** Providers shown in the dropdown, in display order. */
export const CREDIT_PROVIDERS: Provider[] = ['deepseek', 'groq', 'anthropic', 'openai']

/** Display name for the dropdown — what the user calls it, not the vendor's legal name. */
export const CREDIT_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  groq: 'Groq',
  anthropic: 'Claude',
  openai: 'ChatGPT',
}

export interface CreditsSnapshot {
  rows: CreditRow[]
  fetchedAt: number
  /** 'relay' = dev server read the keys server-side; 'browser' = direct from the keys store. */
  via: 'relay' | 'browser' | 'backend'
  usage?: BackendUsageSummary
}

export function demoCredits(): CreditRow[] {
  return ['deepseek', 'groq', 'anthropic'].map((provider) => ({
    provider: provider as Provider, id: provider, status: 'unsupported',
    demo: true, demoTokens: 100_000, detail: 'Demo token allowance',
  }))
}

export async function fetchCredits(force = false): Promise<CreditsSnapshot> {
  if (!(await backendStatus()).live) return { fetchedAt: Date.now(), via: 'browser', rows: demoCredits() }
  const [credits, usage] = await Promise.allSettled([
    backend.providerCredits(force), backend.usageSummary(PROJECT_ID ?? undefined),
  ])
  return {
    fetchedAt: Date.now(), via: 'backend',
    rows: credits.status === 'fulfilled' ? credits.value.rows : demoCredits(),
    usage: usage.status === 'fulfilled' ? usage.value : undefined,
  }
}

// ---- formatting ----

const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

/** Big value for a row, e.g. "$19.76" or "7.7k tok". */
export function creditValue(row: CreditRow): string {
  if (row.demo) return `${fmtTok(row.demoTokens ?? 100_000)} tok`
  if (row.status === 'loading') return '…'
  if (row.status === 'nokey') return 'NO KEY'
  if (row.status === 'error') return 'ERR'
  if (row.status === 'unsupported') return 'N/A'
  if (row.requests && row.unknownTokenRequests === row.requests && row.tokensUsed === 0) return '—'
  if (row.tokensUsed != null) return `${fmtTok(row.tokensUsed)} tok used`
  if (row.balanceUsd != null) return `$${row.balanceUsd.toFixed(2)}`
  if (row.quota) return `${fmtTok(row.quota.remainingTokens)} tok`
  return '—'
}

/** Small secondary line, e.g. "prepaid balance" or "998/1000 req · resets 2m52s". */
export function creditSub(row: CreditRow): string {
  if (row.demo) return 'Demo allowance'
  if (row.status === 'loading') return 'reading…'
  if (row.status === 'nokey') return 'add a key'
  if (row.status === 'error') return row.detail ?? 'failed'
  if (row.status === 'unsupported') return 'no balance API'
  if (row.tokensUsed != null) {
    const cost = (row.reportedCostUsd ?? 0) + (row.estimatedCostUsd ?? 0)
    if (row.unknownCostRequests && cost === 0) return `${row.unknownCostRequests} unpriced requests`
    return `${cost.toFixed(4)} USD${row.estimatedCostUsd ? ' incl. estimates' : ' reported'}${row.unknownCostRequests ? ` · ${row.unknownCostRequests} unpriced` : ''}`
  }
  if (row.balanceUsd != null) return row.currency ? `${row.currency.toUpperCase()} prepaid` : 'prepaid'
  if (row.quota) return `${row.quota.remainingRequests}/${row.quota.limitRequests} req · resets ${row.quota.resetRequests}`
  return ''
}

/** 0..1 bar fill, or null when the provider gives no denominator to divide by. */
export function creditPct(row: CreditRow): number | null {
  if (row.status !== 'ok') return null
  if (row.quota?.limitTokens) return Math.max(0, Math.min(1, row.quota.remainingTokens / row.quota.limitTokens))
  return null
}

export type CreditLevel = 'ok' | 'warn' | 'alert' | 'off'

export function creditLevel(row: CreditRow): CreditLevel {
  if (row.demo) return 'warn'
  if (row.status === 'error') return 'alert'
  if (row.status !== 'ok') return 'off'
  if (row.balanceUsd != null) return row.balanceUsd <= 1 ? 'alert' : row.balanceUsd <= 5 ? 'warn' : 'ok'
  const pct = creditPct(row)
  if (pct == null) return 'ok'
  return pct <= 0.1 ? 'alert' : pct <= 0.3 ? 'warn' : 'ok'
}

/** Sum of the real money we can actually see, for the chip's headline. null = nothing readable. */
export function totalKnownUsd(rows: CreditRow[]): number | null {
  const known = rows.filter((r) => r.status === 'ok' && r.balanceUsd != null)
  return known.length ? known.reduce((a, r) => a + (r.balanceUsd ?? 0), 0) : null
}

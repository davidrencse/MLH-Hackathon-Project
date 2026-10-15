// Game-style resources for the top HUD and the dashboard.
import { useCredits, useCreditsStore } from './credits'
import { useLocalAgents } from './localAgents'
import { useUsageLedger } from './usageLedger'
import { isLocalCli, totalKnownUsd } from '../api/providerCredits'

export type ResourceLevel = 'ok' | 'warn' | 'alert'

export interface Resource {
  key: 'energy' | 'credits'
  label: string // "AGENTS"
  value: string // formatted main value
  sub: string // small secondary text, e.g. "+120/task" or "/ $5.00"
  pct: number // 0..1 fill for the mini bar
  level: ResourceLevel
  metric: string // the real metric behind it (tooltip)
}

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

export function useResources(): Resource[] {
  useCredits(true)
  const snapshot = useCreditsStore((s) => s.snapshot)
  // A failed read leaves no snapshot at all, which used to read as "reading usage…" forever —
  // an honest "could not be read" is the difference between a slow city and a broken one.
  const readError = useCreditsStore((s) => s.error)
  const rows = snapshot?.rows ?? []
  // CREDITS is the city's one currency, so it counts every agent's tokens: the requests the
  // backend recorded against our keys *and* what the local coding CLIs spent on the user's own
  // subscription. A day's work in Codex CLI has to move the city, or the number is a fiction.
  const ledger = useUsageLedger()
  // Only vendors with a real balance API have money left to report; a CLI subscription has none.
  const balance = totalKnownUsd(rows.filter((r) => !isLocalCli(r)))
  const agents = useLocalAgents()
  const tokens = ledger.reachable ? ledger.tokens : null
  const missingTokens = tokens === 0 && ledger.requests > 0 && ledger.untokenedRequests === ledger.apiRequests
  // The mock runtime reports no token counts at all, so say which provider is silent
  // rather than leaving a bare dash that reads like a broken backend.
  const onlyMock = missingTokens && rows.filter((r) => r.requests && !isLocalCli(r)).every((r) => r.provider === 'mock')
  // Which sources the number is made of, so the sub-line can say where it came from.
  const split = [
    ledger.apiTokens ? `${fmtK(ledger.apiTokens)} api` : null,
    ledger.cliTokens ? `${fmtK(ledger.cliTokens)} cli` : null,
  ].filter(Boolean) as string[]

  return [
    {
      // Coding CLIs alive on this machine right now, not buildings mid-task: the old ratio read
      // 0/21 while nine Claude Code shells were open, which told the player nothing.
      key: 'energy',
      label: 'AGENTS',
      value: agents.total == null ? '…' : `${agents.total}`,
      sub: agents.error
        ? agents.error
        : !agents.supported
          ? 'needs a Linux host'
          : agents.total == null
            ? 'scanning machine…'
            : agents.total === 0
              ? 'none running'
              : agents.byRuntime.map((r) => `${r.count} ${r.runtime}`).join(' · '),
      pct: 0,
      level: agents.error || agents.total === 0 ? 'warn' : 'ok',
      metric: agents.error
        ? 'The backend could not scan this machine for running CLIs.'
        : !agents.supported
          ? 'Scanning running CLIs reads /proc, so it only works when the backend runs on Linux.'
          : `Coding CLIs running on this machine (${agents.byRuntime.map((r) => `${r.count} ${r.runtime}`).join(', ') || 'none'}). One entry per interactive terminal; background daemons and helpers are excluded.`,
    },
    {
      // Tokens the backend recorded, not an allowance: the balance, when a provider
      // publishes one, rides along in the sub-line.
      key: 'credits',
      label: 'CREDITS',
      value: tokens == null ? '…' : missingTokens ? '—' : `${fmtK(tokens)} tok`,
      sub: tokens == null
        ? snapshot ? 'backend unavailable' : readError ? 'usage read failed' : 'reading usage…'
        : missingTokens
          ? onlyMock ? 'mock runtime reports none' : 'provider reports no tokens'
          : ledger.cliTokens
            ? split.join(' · ')
            : balance != null
              ? `$${balance.toFixed(2)} left`
              : 'agent tokens used',
      pct: 0,
      level: tokens == null ? 'warn' : 'ok',
      metric: tokens == null
        ? readError && !snapshot
          ? `Token usage comes from the backend; reading it failed: ${readError}`
          : 'Token usage comes from the backend; it is unreachable.'
        : onlyMock
          ? 'Every recorded task ran on the mock runtime, which reports no token counts. Point a building at a real provider to see tokens here.'
        : [
            `Input + output tokens across every agent: ${fmtK(ledger.apiTokens)} through our API keys`,
            ledger.cliTokens ? `${fmtK(ledger.cliTokens)} on local CLI subscriptions (Codex CLI, Claude Code)` : null,
            ledger.cliCacheTokens ? `plus ${fmtK(ledger.cliCacheTokens)} cached CLI tokens, not counted here` : null,
            balance != null ? `$${balance.toFixed(2)} prepaid balance left` : null,
          ].filter(Boolean).join('. ') + '. Open credits for the per-source breakdown.',
    },
  ]
}

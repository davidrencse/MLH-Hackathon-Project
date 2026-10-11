// Game-style resources for the top HUD and the dashboard. Derived from live city state (no backend).
// Real money (COST) is shown separately from game currency (CREDITS) on purpose.
import { useShallow } from 'zustand/react/shallow'
import { useGrid } from './grid'
import { useKeys } from './keys'
import { useCredits, useCreditsStore } from './credits'
import { totalKnownUsd } from '../api/providerCredits'

export type ResourceLevel = 'ok' | 'warn' | 'alert'

export interface Resource {
  key: 'energy' | 'credits' | 'cost'
  label: string // "ENERGY"
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
  const usage = snapshot?.usage
  const balance = totalKnownUsd(snapshot?.rows ?? [])
  const demoTokens = (snapshot?.rows ?? []).filter(r => r.demo).reduce((sum, r) => sum + (r.demoTokens ?? 0), 0)
  const snap = useGrid(
    useShallow((s) => {
      const list = s.order.map((id) => s.buildings[id]).filter((b) => b.type !== 'router')
      return {
        total: list.length,
        working: list.filter((b) => b.status === 'working').length,
        budget: s.stats.budgetToday,
      }
    }),
  )
  const keyCount = useKeys((s) => s.keys.length)

  const capacity = Math.max(4, snap.total)
  const energyPct = snap.working / capacity
  const tokens = usage ? usage.totals.inputTokens + usage.totals.outputTokens : null
  const missingTokens = !!usage && usage.totals.requests > 0 && usage.totals.unknownTokenRequests === usage.totals.requests && tokens === 0
  const cost = usage && !(usage.today.requests > 0 && usage.today.unknownCostRequests === usage.today.requests) ? usage.today.reportedCostUsd + usage.today.estimatedCostUsd : null
  const costPct = cost != null && snap.budget > 0 ? cost / snap.budget : 0

  return [
    {
      key: 'energy',
      label: 'ENERGY',
      value: `${snap.working}/${capacity}`,
      sub: keyCount === 0 ? 'no key' : 'agents busy',
      pct: energyPct,
      level: keyCount === 0 ? 'warn' : energyPct >= 1 ? 'alert' : energyPct > 0.8 ? 'warn' : 'ok',
      metric: 'Running agents / capacity',
    },
    {
      key: 'credits',
      label: 'CREDITS',
      value: balance != null ? `$${balance.toFixed(2)}` : demoTokens ? fmtK(demoTokens) : tokens == null || missingTokens ? '…' : fmtK(tokens),
      sub: balance != null ? 'live prepaid balance' : demoTokens ? 'Demo tokens' : 'API tokens used',
      pct: 0,
      level: tokens == null ? 'warn' : 'ok',
      metric: balance != null ? 'Live USD balance from providers with a balance API. Open credits for provider quotas and demo allowances.' : demoTokens ? 'Demo token allowance. Open credits for each provider.' : 'Tokens recorded by the backend.',
    },
    {
      key: 'cost',
      label: 'COST',
      value: cost == null ? '—' : `$${cost.toFixed(4)}`,
      sub: !usage ? 'backend unavailable' : usage.today.unknownCostRequests ? `${usage.today.unknownCostRequests} unpriced requests` : usage.today.estimatedCostUsd ? 'includes estimates · UTC' : 'reported today · UTC',
      pct: Math.min(1, costPct),
      level: costPct >= 1 ? 'alert' : costPct > 0.8 ? 'warn' : 'ok',
      metric: 'Backend-recorded API cost today (UTC). Reported cost takes precedence over configured pricing estimates. Unpriced requests are excluded.',
    },
  ]
}

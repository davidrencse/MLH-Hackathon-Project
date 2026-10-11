// Row 2 right: today's real spend vs budget as a pixel meter, plus tokens split by agent type.
import { useGrid } from '@/store/grid'
import { useCreditsStore } from '@/store/credits'
import { C, Panel, SegBar, fmtCompact } from './parts'

export function BudgetPanel() {
  const usage = useCreditsStore((s) => s.snapshot?.usage)
  const budget = useGrid((s) => s.stats.budgetToday)
  const cost = usage ? usage.today.reportedCostUsd + usage.today.estimatedCostUsd : 0
  const priced = !!usage && !(usage.today.requests > 0 && usage.today.unknownCostRequests === usage.today.requests)
  const tokens = usage ? usage.totals.inputTokens + usage.totals.outputTokens : 0
  const split = (usage?.providers ?? []).map((p, i) => ({
    type: p.providerId ?? 'unknown', name: p.name ?? 'Unknown provider',
    tokens: p.inputTokens + p.outputTokens,
    share: tokens ? (p.inputTokens + p.outputTokens) / tokens : 0,
    color: [C.cyan, C.green, C.yellow, C.pink][i % 4],
  }))

  const pct = budget > 0 ? cost / budget : 0
  const color = pct >= 1 ? C.red : pct > 0.8 ? C.yellow : C.green
  const left = Math.max(0, budget - cost)

  return (
    <Panel title="BUDGET" pip={C.yellow} meta={<span className="font-pixel text-[8px] leading-none text-gg-yellow">USD</span>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-pixel text-[8px] leading-none text-gg-mute">SPENT TODAY</div>
          <div className="font-pixel mt-2 text-base leading-none" style={{ color }}>
            {priced ? `$${cost.toFixed(4)}` : '—'}
            <span className="text-[10px] text-gg-mute"> / ${budget.toFixed(2)}</span>
          </div>
        </div>
        <div className="text-right text-lg leading-none text-gg-mute">
          <span className="tabular-nums text-gg-ink">{Math.round(pct * 100)}%</span> used
        </div>
      </div>
      <div className="mt-3">
        <SegBar pct={pct} color={color} cells={20} tall label={`Budget ${Math.round(pct * 100)}% used`} />
      </div>
      <div className="mt-2 flex justify-between text-lg leading-none text-gg-mute">
        <span>{priced ? `LEFT $${left.toFixed(2)}` : usage ? 'Cost not reported' : 'Backend unavailable'}</span>
        <span>DAY START 00:00 UTC</span>
      </div>

      {usage && <p className="mt-2 text-lg text-gg-mute">{usage.today.unknownCostRequests ? `${usage.today.unknownCostRequests} requests have no reported price. ` : ''}{usage.today.estimatedCostUsd ? 'Includes configured price estimates. ' : ''}Budget is a local display target.</p>}
      <div className="mt-6 border-t-2 border-dashed border-gg-haze pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-pixel text-[8px] leading-none text-gg-mute">TOKENS BY PROVIDER</span>
          <span className="text-lg leading-none text-gg-ink tabular-nums">{usage ? fmtCompact.format(tokens) : '—'} recorded</span>
        </div>
        <div className="mt-3 flex h-6 gap-[2px]" role="img" aria-label="Recorded tokens by provider">
          {split.map((s) => (
            <span
              key={s.type}
              title={`${s.name}: ${fmtCompact.format(s.tokens)}`}
              style={{ flexGrow: s.share, flexBasis: 0, background: s.color }}
              className="min-w-[2px] shadow-[inset_-2px_-2px_0_0_rgba(0,0,0,0.35)]"
            />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-lg leading-tight">
          {split.map((s) => (
            <li key={s.type} className="flex min-w-0 items-center gap-2">
              <span className="inline-block size-2 flex-none" style={{ background: s.color }} />
              <span className="truncate text-gg-mute">{s.name}</span>
              <span className="ml-auto tabular-nums text-gg-ink">{fmtCompact.format(s.tokens)}</span>
              <span className="w-9 text-right tabular-nums text-gg-mute">{Math.round(s.share * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

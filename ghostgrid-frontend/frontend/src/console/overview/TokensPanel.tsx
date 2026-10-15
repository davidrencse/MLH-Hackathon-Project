// Row 2 right: every agent's token usage — API keys and local CLI subscriptions alike — and
// which source spent it. Reads the shared usage ledger, the same number the HUD's CREDITS shows.
import { useUsageLedger } from '@/store/usageLedger'
import { C, Panel, fmtCompact, fmtInt } from './parts'

export function TokensPanel() {
  const ledger = useUsageLedger()
  const tokens = ledger.tokens
  // CLI rows get their own colour so a subscription is never mistaken for metered API spend.
  const API_COLORS = [C.cyan, C.green, C.yellow, C.pink]
  let apiSeen = 0
  const split = ledger.sources.map((source) => ({
    type: source.key,
    name: source.label,
    tokens: source.tokens,
    share: tokens ? source.tokens / tokens : 0,
    kind: source.kind,
    color: source.kind === 'cli' ? C.pink : API_COLORS[apiSeen++ % API_COLORS.length],
  }))
  // A provider can report requests without token counts, which is not the same as "none yet".
  const unpriced = ledger.untokenedRequests

  return (
    <Panel title="TOKENS" pip={C.cyan} meta={<span className="font-pixel text-[8px] leading-none text-gg-cyan">ALL TIME</span>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-pixel text-[8px] leading-none text-gg-mute">RECORDED</div>
          <div className="font-pixel mt-2 text-base leading-none" style={{ color: C.cyan }}>
            {ledger.reachable ? fmtInt.format(tokens) : '—'}
            <span className="text-[10px] text-gg-mute"> tok</span>
          </div>
        </div>
        <div className="text-right text-lg leading-none text-gg-mute">
          <span className="tabular-nums text-gg-ink">{ledger.reachable ? fmtInt.format(ledger.requests) : '—'}</span> requests
        </div>
      </div>
      <p className="mt-2 text-lg text-gg-mute">
        {ledger.reachable
          ? `${unpriced ? `${unpriced} requests report no token counts. ` : ''}${fmtCompact.format(ledger.apiTokens)} through API keys` +
            (ledger.cliTokens ? ` · ${fmtCompact.format(ledger.cliTokens)} on CLI subscriptions` : '') +
            (ledger.cliCacheTokens ? ` (+${fmtCompact.format(ledger.cliCacheTokens)} cached, uncounted)` : '') + '.'
          : 'Backend unavailable.'}
      </p>

      <div className="mt-6 border-t-2 border-dashed border-gg-haze pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-pixel text-[8px] leading-none text-gg-mute">TOKENS BY SOURCE</span>
          <span className="text-lg leading-none text-gg-ink tabular-nums">{split.length} {split.length === 1 ? 'source' : 'sources'}</span>
        </div>
        <div className="mt-3 flex h-6 gap-[2px]" role="img" aria-label="Recorded tokens by source">
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
              <span className="truncate text-gg-mute" title={s.kind === 'cli' ? `${s.name} — local CLI subscription` : s.name}>
                {s.name}
                {s.kind === 'cli' && <span className="ml-1 text-gg-pink">CLI</span>}
              </span>
              <span className="ml-auto tabular-nums text-gg-ink">{fmtCompact.format(s.tokens)}</span>
              <span className="w-9 text-right tabular-nums text-gg-mute">{Math.round(s.share * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

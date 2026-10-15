import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import {
  CREDIT_LABEL,
  CREDIT_PROVIDERS,
  creditDetail,
  creditLevel,
  creditPct,
  creditSub,
  creditValue,
  fmtTok,
  isLocalCli,
  type CreditLevel,
  type CreditRow,
} from '../api/providerCredits'
import { useCredits, useRelativeTime } from '../store/credits'
import { useUsageLedger } from '../store/usageLedger'
import type { Provider } from '../types'
import './CreditsDropdown.css'

/**
 * Is this vendor row worth a line?
 *
 * The mock runtime is not a vendor: no key, no balance, and it reports no tokens by design, so
 * its row can only ever read "0 tok used". A vendor that has a key but publishes no balance and
 * has no recorded usage says nothing either — Anthropic is the usual one, and the real Claude
 * numbers are in the coding-CLI group below, read from Claude Code's own transcripts.
 *
 * Anything actionable (no key, an error) or carrying a real number (balance, quota, usage) stays.
 */
const informative = (row: CreditRow): boolean =>
  row.provider !== 'mock' &&
  (row.status === 'nokey' ||
    row.status === 'error' ||
    row.balanceUsd != null ||
    !!row.quota ||
    !!row.tokensUsed ||
    !!row.requests)

const LEVEL_COLOR: Record<CreditLevel, string> = {
  ok: 'var(--gg-green)',
  warn: 'var(--gg-yellow)',
  alert: 'var(--gg-red)',
  off: 'var(--gg-grey)',
}

const SEGMENTS = 10

function Row({ provider, row }: { provider: Provider | string; row: CreditRow | undefined }) {
  const r: CreditRow = row ?? { provider, status: 'loading' }
  const level = creditLevel(r)
  const color = LEVEL_COLOR[level]
  const pct = creditPct(r)
  const on = pct == null ? 0 : Math.max(pct > 0 ? 1 : 0, Math.round(pct * SEGMENTS))

  return (
    <li className="gg-cred-row" data-status={r.status} title={creditDetail(r)}>
      <span className="gg-cred-dot" aria-hidden style={{ background: color }} />
      <span className="gg-cred-name font-pixel">{r.name ?? CREDIT_LABEL[provider] ?? provider}</span>
      <span className="gg-cred-value font-pixel" style={{ color }}>
        {creditValue(r)}
      </span>
      <span className="gg-cred-sub font-mono">{creditSub(r)}</span>
      {pct != null && (
        <span className="gg-cred-bar" aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} style={{ background: i < on ? color : 'var(--gg-haze)' }} />
          ))}
        </span>
      )}
    </li>
  )
}

export function CreditsDropdown({
  anchor,
  open,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}) {
  const { rows, loading, error, fetchedAt, offline, refresh } = useCredits(open)
  // The same ledger the HUD chip reads. This panel is where that chip's number is explained, so
  // it has to state it: the vendor rows below are filtered and never summed to it.
  const ledger = useUsageLedger()
  const ago = useRelativeTime(fetchedAt)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Position under the chip, clamped to the viewport so it never runs off the right edge.
  useEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const width = 320
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !pos) return null

  const byProvider = new Map(rows.map((r) => [r.provider, r]))
  // Subscription CLIs sit in their own group: their numbers are read from local transcripts,
  // not from a vendor API, and they have no balance to compare against the rows above.
  const vendorRows = rows.filter((r) => !isLocalCli(r) && informative(r))
  const cliRows = rows.filter(isLocalCli)
  // What the total is made of. Cache reads are named as the extra they are: the CLI row values
  // above count fresh tokens only, exactly like the ledger.
  const totalSplit = [
    ledger.apiTokens ? `${fmtTok(ledger.apiTokens)} api` : null,
    ledger.cliTokens ? `${fmtTok(ledger.cliTokens)} cli` : null,
    ledger.cliCacheTokens ? `+${fmtTok(ledger.cliCacheTokens)} cached, uncounted` : null,
  ].filter(Boolean)

  return createPortal(
    <div
      className="gg-cred-panel"
      role="group"
      aria-label="Provider credits"
      style={{ top: pos.top, left: pos.left }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="gg-cred-head">
        <span className="font-pixel">PROVIDER CREDITS</span>
        <button type="button" className="gg-cred-refresh" onClick={refresh} disabled={loading} aria-label="Refresh credits">
          <RefreshCw size={12} strokeWidth={3} className={loading ? 'gg-cred-spin' : ''} aria-hidden />
        </button>
      </div>

      {ledger.reachable && (
        <div className="gg-cred-total">
          <span className="gg-cred-total-label font-pixel">CITY TOTAL</span>
          <span className="gg-cred-total-value font-pixel">{fmtTok(ledger.tokens)} tok</span>
          <span className="gg-cred-total-sub font-mono">
            {totalSplit.length ? totalSplit.join(' · ') : 'no agent tokens recorded yet'}
          </span>
        </div>
      )}

      <ul className="gg-cred-list">
        {rows.length ? vendorRows.map((r) => <Row key={r.id ?? r.provider} provider={r.provider} row={r} />) : loading ? CREDIT_PROVIDERS.map((p) => <Row key={p} provider={p} row={byProvider.get(p)} />) : null}
      </ul>

      {cliRows.length > 0 && (
        <>
          <div className="gg-cred-group font-pixel">CODING CLIS · LOCAL LOGS</div>
          <ul className="gg-cred-list">
            {cliRows.map((r) => <Row key={r.id ?? r.provider} provider={r.provider} row={r} />)}
          </ul>
        </>
      )}
      {rows.length === 0 && !loading && (
        <p className="gg-cred-foot font-mono">{offline ? 'Backend unreachable — no recorded usage.' : 'No API usage recorded yet.'}</p>
      )}

      {error && <p className="gg-cred-err font-mono">{error}</p>}

      <p className="gg-cred-foot font-mono">
        {loading ? 'Refreshing…' : fetchedAt ? `Updated ${ago}` : 'Loading credits…'}
        {!loading && rows.length ? ' · Backend-recorded usage' : ''}
      </p>
    </div>,
    document.body,
  )
}

/** Wraps the CREDITS chip: opens the panel on hover or keyboard focus. */
export function CreditsHover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // State, not a ref: the panel needs a re-render once the anchor element exists, and a
  // ref's `.current` landing does not cause one.
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // A small close delay lets the pointer travel from the chip into the panel.
  const show = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(true)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(false), 160)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div
      ref={setAnchor}
      className="gg-cred-anchor"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      <CreditsDropdown
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        onPointerEnter={show}
        onPointerLeave={hide}
      />
    </div>
  )
}

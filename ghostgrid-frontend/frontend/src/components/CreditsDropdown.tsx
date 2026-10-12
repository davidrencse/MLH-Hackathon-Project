import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import {
  CREDIT_LABEL,
  CREDIT_PROVIDERS,
  creditLevel,
  creditPct,
  creditSub,
  creditValue,
  type CreditLevel,
  type CreditRow,
} from '../api/providerCredits'
import { useCredits, useRelativeTime } from '../store/credits'
import type { Provider } from '../types'
import './CreditsDropdown.css'

const LEVEL_COLOR: Record<CreditLevel, string> = {
  ok: 'var(--gg-green)',
  warn: 'var(--gg-yellow)',
  alert: 'var(--gg-red)',
  off: 'var(--gg-grey)',
}

const SEGMENTS = 10

function Row({ provider, row }: { provider: Provider; row: CreditRow | undefined }) {
  const r: CreditRow = row ?? { provider, status: 'loading' }
  const level = creditLevel(r)
  const color = LEVEL_COLOR[level]
  const pct = creditPct(r)
  const on = pct == null ? 0 : Math.max(pct > 0 ? 1 : 0, Math.round(pct * SEGMENTS))

  return (
    <li className="gg-cred-row" data-status={r.status} title={r.detail ?? undefined}>
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
  const { rows, loading, error, fetchedAt, via, refresh } = useCredits(open)
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
        <button type="button" className="gg-cred-close" onClick={(event) => { event.stopPropagation(); onClose() }} aria-label="Close provider credits"><X size={16} strokeWidth={2.5} /></button>
        <button type="button" className="gg-cred-refresh" onClick={refresh} disabled={loading} aria-label="Refresh credits">
          <RefreshCw size={12} strokeWidth={3} className={loading ? 'gg-cred-spin' : ''} aria-hidden />
        </button>
      </div>

      <ul className="gg-cred-list">
        {rows.length ? rows.map((r) => <Row key={r.id ?? r.provider} provider={r.provider} row={r} />) : loading ? CREDIT_PROVIDERS.map((p) => <Row key={p} provider={p} row={byProvider.get(p)} />) : null}
      </ul>
      {via === 'backend' && rows.length === 0 && <p className="gg-cred-foot font-mono">No API usage recorded yet.</p>}

      {error && <p className="gg-cred-err font-mono">{error}</p>}

      <p className="gg-cred-foot font-mono">
        {loading ? 'Refreshing…' : fetchedAt ? `Updated ${ago}` : 'Loading credits…'}
        {rows.some(r => r.demo) && !loading ? ' · Demo allowances included' : ''}
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
      role="button"
      tabIndex={0}
      aria-label="View provider credits"
      aria-expanded={open}
      onClick={(event) => { if (anchor?.contains(event.target as Node)) show() }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show() } }}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') show() }}
      onPointerLeave={(event) => { if (event.pointerType !== 'touch') hide() }}
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

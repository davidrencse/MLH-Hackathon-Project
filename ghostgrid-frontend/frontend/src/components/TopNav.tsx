// Game HUD top bar for the city ("/") and the dashboard ("/dashboard/*").
// Logo · resource bar (game resources + separated real-money COST) · tabs · key button · clock. Fixed, 64px, z-40.
import { memo, useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { CreditsHover } from './CreditsDropdown'
import { useKeys } from '../store/keys'
import { useResources } from '../store/resources'
import type { Resource, ResourceLevel } from '../store/resources'
import './TopNav.css'

// 8x8 ghost. P = pink body, W = ink eye, C = cyan pupil. Drawn as box-shadow pixels (3px each).
const GHOST_MAP = ['..PPPP..', '.PPPPPP.', 'PPPPPPPP', 'PWWPPWWP', 'PWCPPWCP', 'PPPPPPPP', 'PPPPPPPP', 'PP.PP.PP']
const GHOST_COLOR: Record<string, string> = { P: 'var(--gg-pink)', W: 'var(--gg-ink)', C: 'var(--gg-cyan)' }
const PX = 3
const GHOST_SHADOW = GHOST_MAP.flatMap((row, y) =>
  [...row].flatMap((ch, x) => (GHOST_COLOR[ch] ? [`${x * PX}px ${y * PX}px 0 0 ${GHOST_COLOR[ch]}`] : [])),
).join(', ')

// ---- Resource icons: 8x8 maps, 2px pixels, one DOM node each (box-shadow), built once ----
// X = resource color (currentColor, so blink/level colors apply), o = void cut-out, W = ink highlight.
type ResKey = Resource['key']
const ICON_MAPS: Record<ResKey, string[]> = {
  energy: ['....XXX.', '...XXX..', '..XXX...', '.XXXXXX.', '....XX..', '...XX...', '..XX....', '.X......'],
  credits: ['..XXXX..', '.XWXXXX.', 'XXXooXXX', 'XXoXXXXX', 'XXoXXXXX', 'XXXooXXX', '.XXXXXX.', '..XXXX..'],
}
const ICON_PAL: Record<string, string> = { X: 'currentColor', o: 'var(--gg-void)', W: 'var(--gg-ink)' }
const IPX = 2
// Shifted one pixel right/down: a box-shadow is clipped under its own 2x2 anchor, so nothing may sit at 0,0.
const ICON_SHADOW = Object.fromEntries(
  Object.entries(ICON_MAPS).map(([k, map]) => [
    k,
    map
      .flatMap((row, y) =>
        [...row].flatMap((ch, x) => (ICON_PAL[ch] ? [`${(x + 1) * IPX}px ${(y + 1) * IPX}px 0 0 ${ICON_PAL[ch]}`] : [])),
      )
      .join(', '),
  ]),
) as Record<ResKey, string>

const OWN_COLOR: Record<ResKey, string> = {
  energy: 'var(--gg-cyan)',
  credits: 'var(--gg-yellow)',
}

function resColor(kind: ResKey, level: ResourceLevel) {
  if (level === 'alert') return 'var(--gg-red)'
  if (level === 'warn') return 'var(--gg-yellow)'
  return OWN_COLOR[kind]
}

const SEGMENTS = 8
const SEG_STEP = 6 // 4px segment + 2px gap (matches the CSS gradient period)

// Inverted "tick" flash; the end keyframe is implicit (back to the element's own style).
const FLASH: Keyframe[] = [{ offset: 0, color: 'var(--gg-void)', backgroundColor: 'var(--gg-ink)', transform: 'translateY(-2px)' }]
const FLASH_OPTS: KeyframeAnimationOptions = { duration: 450, easing: 'steps(3, end)' }

interface ChipProps extends Omit<Resource, 'key'> {
  kind: ResKey
}

// Props are all primitives, so memo skips chips whose numbers did not change.
const ResourceChip = memo(function ResourceChip({ kind, label, value, sub, pct, level, metric }: ChipProps) {
  const valueRef = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)

  // Flash only when the value changes after mount.
  useEffect(() => {
    if (value === prev.current) return
    prev.current = value
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    valueRef.current?.animate(FLASH, FLASH_OPTS)
  }, [value])

  const p = Math.min(1, Math.max(0, pct || 0))
  const on = p > 0 ? Math.max(1, Math.round(p * SEGMENTS)) : 0

  return (
    <div
      role="group"
      aria-label={`${label} ${value}`}
      title={metric}
      data-kind={kind}
      data-level={level}
      className="gg-hud-chip"
      style={{ color: resColor(kind, level) }}
    >
      <span className="gg-hud-icon" aria-hidden>
        <span style={{ boxShadow: ICON_SHADOW[kind] }} />
      </span>
      <span className="gg-hud-body">
        <span className="gg-hud-label font-pixel">{label}</span>
        <span ref={valueRef} className="gg-hud-value font-pixel">
          {value}
        </span>
        <span className="gg-hud-bar" aria-hidden>
          <span className="gg-hud-fill" style={{ width: on * SEG_STEP }} />
        </span>
        <span className="gg-hud-sub font-mono">{sub}</span>
      </span>
    </div>
  )
})

// Own component so resource updates re-render only the bar, never the rest of the nav.
function ResourceBar() {
  const resources = useResources()
  return (
    <div role="group" aria-label="City resources" className="gg-hud self-stretch">
      <div className="gg-hud-game">
        {resources.map(({ key, ...r }) =>
          key === 'credits' ? (
            <CreditsHover key={key}>
              <ResourceChip kind={key} {...r} />
            </CreditsHover>
          ) : (
            <ResourceChip key={key} kind={key} {...r} />
          ),
        )}
      </div>
    </div>
  )
}

const focusRing = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan'

function tabClass({ isActive }: { isActive: boolean }) {
  const base = `font-pixel relative -ml-0.5 first:ml-0 flex h-8 items-center border-2 px-3 text-[10px] leading-none ${focusRing}`
  return isActive
    ? `${base} gg-nav-tab-active z-10 border-gg-cyan bg-gg-cyan text-gg-void`
    : `${base} border-gg-haze bg-gg-void text-gg-ink hover:z-10 hover:border-gg-pink hover:text-gg-pink`
}

function Logo() {
  return (
    <Link to="/" aria-label="Ghost Grid home" className={`gg-nav-logo flex items-center gap-3 ${focusRing}`}>
      <span className="gg-nav-ghost" aria-hidden>
        <span style={{ boxShadow: GHOST_SHADOW }} />
      </span>
      <span className="gg-nav-word font-pixel text-[16px] leading-none text-gg-cyan max-[1250px]:hidden">GHOST GRID</span>
    </Link>
  )
}

function KeyButton() {
  const count = useKeys((s) => s.keys.length)
  const title = count === 0 ? 'No API key — add one' : `${count} provider key${count === 1 ? '' : 's'}`
  return (
    <NavLink
      to="/dashboard/keys"
      title={title}
      aria-label={title}
      className={({ isActive }) =>
        `relative flex h-8 items-center gap-2 border-2 px-2 ${focusRing} ${
          isActive ? 'border-gg-cyan text-gg-cyan' : 'border-gg-haze text-gg-ink hover:border-gg-pink hover:text-gg-pink'
        }`
      }
    >
      <KeyRound size={16} strokeWidth={2.5} aria-hidden />
      <span className={`font-pixel text-[10px] leading-none ${count === 0 ? 'text-gg-yellow' : ''}`}>{count}</span>
      {count === 0 && <span className="gg-nav-keydot" aria-hidden />}
    </NavLink>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return (
    <time
      dateTime={now.toISOString()}
      title="Local time"
      className="whitespace-nowrap text-[20px] leading-none text-gg-mute max-[1150px]:hidden"
    >
      {pad(now.getHours())}
      <span className="gg-nav-colon">:</span>
      {pad(now.getMinutes())}
    </time>
  )
}

const Divider = ({ className = '' }: { className?: string }) => (
  <span aria-hidden className={`h-6 w-0.5 bg-gg-haze ${className}`} />
)

export function TopNav() {
  return (
    <header data-hud-panel className="fixed inset-x-0 top-0 z-40 h-16 border-b-2 border-gg-haze" style={{ background: 'rgba(11,8,32,0.82)' }}>
      <div className="gg-nav-frame grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4">
        <div className="justify-self-start">
          <Logo />
        </div>

        <ResourceBar />

        <div className="flex items-center gap-3 justify-self-end">
          <nav aria-label="Main" className="gg-nav-tabs flex">
            <NavLink to="/" end className={tabClass}>
              CITY
            </NavLink>
            {/* "DASH" on phones: the full word squeezed the resource bar until it clipped. */}
            <NavLink to="/dashboard" aria-label="Dashboard" className={tabClass}>
              <span className="max-[760px]:hidden">DASHBOARD</span>
              <span className="hidden max-[760px]:inline">DASH</span>
            </NavLink>
          </nav>
          <KeyButton />
          <Divider className="max-[1150px]:hidden" />
          <Clock />
        </div>
      </div>

      {/* pixel accent on the bottom border, under the logo */}
      <span aria-hidden className="pointer-events-none absolute -bottom-0.5 left-0 flex h-0.5 gap-2">
        <span className="w-16 bg-gg-pink" />
        <span className="w-4 bg-gg-pink" />
        <span className="w-2 bg-gg-cyan" />
      </span>
    </header>
  )
}

// SimCity-style build menu: pixel toolbar (left), placement banner (top-center), NEW BOT dialog.
// DOM only. Selectors return primitives / stable values, so this re-renders only when credits, buildMode or lots change.
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BOT_KINDS, CATALOG } from '@/constants'
import { BUILDABLE_LOTS } from '@/city3d/world'
import { useGrid, useOccupiedLots } from '@/store/grid'
import type { BuildMode } from '@/store/grid'
import type { BotKind, BuildingType } from '@/types'
import { PixelIcon } from './build/icons'
import type { IconName } from './build/icons'
import { NewBotDialog } from './build/NewBotDialog'

interface Tool {
  id: IconName
  type: BuildingType
  label: string
  hint: string
  cost: number
  accent: string
  botKind?: BotKind // bot tools open the NEW BOT dialog with this kind preselected
}

const TOOLS: Tool[] = [
  ...(['codex', 'cursor', 'claude', 'deepseek', 'groq', 'bot'] as const)
    .filter((t) => CATALOG[t].buildable)
    .map((t): Tool => {
      const c = CATALOG[t]
      return {
        id: t,
        type: t,
        label: c.label,
        hint: c.role,
        cost: c.cost,
        accent: c.accent,
        botKind: t === 'bot' ? 'custom' : undefined,
      }
    }),
  {
    id: 'trading',
    type: 'bot',
    label: BOT_KINDS.trading.label,
    hint: BOT_KINDS.trading.description,
    cost: CATALOG.bot.cost,
    accent: BOT_KINDS.trading.color,
    botKind: 'trading',
  },
]

const activeToolId = (m: BuildMode | null): IconName | null => {
  if (!m) return null
  if (m.type === 'bot') return m.bot?.kind === 'trading' ? 'trading' : 'bot'
  return TOOLS.some((t) => t.id === m.type) ? (m.type as IconName) : null
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid'

export function BuildMenu() {
  const credits = useGrid((s) => s.credits)
  const buildMode = useGrid((s) => s.buildMode)
  const occupied = useOccupiedLots()
  const [botKind, setBotKind] = useState<BotKind | null>(null)

  const free = BUILDABLE_LOTS.filter((l) => !occupied.includes(l)).length
  const active = activeToolId(buildMode)
  const placing = buildMode !== null

  // ESC cancels placement. Capture phase + preventDefault so the side panel does not also close on the same press.
  useEffect(() => {
    if (!placing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const s = useGrid.getState()
      if (s.task?.phase === 'approval') return // approval dialog owns Esc
      e.preventDefault()
      s.setBuildMode(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [placing])

  // Leaving the city must not leave a stale build mode behind.
  useEffect(
    () => () => {
      const s = useGrid.getState()
      if (s.buildMode) s.setBuildMode(null)
    },
    [],
  )

  const pick = (t: Tool) => {
    if (credits < t.cost || free === 0) return
    const s = useGrid.getState()
    if (t.botKind) {
      if (s.buildMode) s.setBuildMode(null)
      setBotKind(t.botKind)
      return
    }
    s.setBuildMode(s.buildMode?.type === t.type ? null : { type: t.type })
  }

  return (
    <>
      <nav
        aria-label="Build menu"
        className="absolute top-24 left-4 z-40 flex w-14 flex-col border-2 border-gg-haze bg-gg-night/90 shadow-[4px_4px_0_0_rgba(0,0,0,0.6)] min-[900px]:w-48"
      >
        <div className="flex items-center justify-between gap-2 border-b-2 border-gg-haze px-2 py-2">
          <span className="font-pixel text-[8px] leading-none text-gg-ink min-[900px]:text-[10px]">BUILD</span>
          <span aria-hidden className="hidden h-2 gap-1 min-[900px]:flex">
            <span className="w-2 bg-gg-pink" />
            <span className="w-1 bg-gg-cyan" />
          </span>
        </div>

        <ul className="flex flex-col gap-1 p-1">
          {TOOLS.map((t) => {
            const broke = credits < t.cost
            const disabled = broke || free === 0
            const on = active === t.id
            const tip = broke ? 'Not enough build points' : free === 0 ? 'No free lots' : `${t.label} · ${t.cost} BP · ${t.hint}`
            return (
              <li key={t.id}>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label={`${t.label}, ${t.cost} build points${broke ? ', not enough build points' : ''}`}
                    aria-disabled={disabled || undefined}
                    aria-pressed={t.botKind ? undefined : on}
                    aria-haspopup={t.botKind ? 'dialog' : undefined}
                    onClick={() => pick(t)}
                    className={`flex w-full items-center justify-center gap-2 border-2 p-1.5 text-left transition-colors duration-100 min-[900px]:justify-start ${FOCUS} ${
                      disabled
                        ? 'cursor-not-allowed border-gg-haze bg-gg-void/60 opacity-40'
                        : on
                          ? 'bg-gg-dusk'
                          : 'border-gg-haze bg-gg-void/70 shadow-[2px_2px_0_0_rgba(0,0,0,0.6)] hover:border-[color:var(--bm-accent)] hover:bg-gg-dusk active:translate-x-0.5 active:translate-y-0.5 active:shadow-none'
                    }`}
                    style={
                      {
                        '--bm-accent': t.accent,
                        ...(on && !disabled
                          ? {
                              borderColor: t.accent,
                              boxShadow: `2px 2px 0 0 rgba(0,0,0,0.6), 0 0 10px 0 color-mix(in srgb, ${t.accent} 50%, transparent)`,
                            }
                          : null),
                      } as CSSProperties
                    }
                  >
                    <PixelIcon name={t.id} color={disabled ? 'var(--gg-grey)' : t.accent} />
                    <span className="hidden min-w-0 flex-col gap-1 min-[900px]:flex">
                      <span className="font-pixel text-[8px] leading-tight text-gg-ink">{t.label.toUpperCase()}</span>
                      <span className="text-lg leading-none text-gg-yellow">{t.cost} BP</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {tip}
                  </TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>

        <div
          title="Empty lots you can build on"
          className="border-t-2 border-gg-haze px-2 py-2 text-center font-pixel text-[8px] leading-none min-[900px]:text-left"
        >
          <span className="hidden text-gg-mute min-[900px]:inline">LOTS FREE: </span>
          <span className={free === 0 ? 'text-gg-red' : 'text-gg-green'}>
            {free}/{BUILDABLE_LOTS.length}
          </span>
        </div>
      </nav>

      {buildMode && <PlacingBanner mode={buildMode} />}

      <NewBotDialog kind={botKind} onClose={() => setBotKind(null)} />
    </>
  )
}

function PlacingBanner({ mode }: { mode: BuildMode }) {
  const panelOpen = useGrid((s) => s.panel !== null)
  const accent = mode.bot?.color ?? CATALOG[mode.type].accent
  const what = (mode.name || CATALOG[mode.type].label).toUpperCase()
  // When the side panel (380px, right-4) is open, center the banner in the space left of it.
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-4 ${panelOpen ? 'min-[900px]:right-[396px]' : ''}`}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-3 border-2 bg-gg-night/95 py-1.5 pr-1.5 pl-3 shadow-[4px_4px_0_0_rgba(0,0,0,0.6)] duration-150 ease-[steps(3)] animate-in fade-in-0 slide-in-from-top-2"
        style={{ borderColor: accent }}
      >
        <span
          aria-hidden
          className="size-2 shrink-0 animate-pulse"
          style={{ background: accent, animationDuration: '0.8s', animationTimingFunction: 'steps(2, end)' }}
        />
        <span className="min-w-0 truncate font-pixel text-[10px] leading-none" style={{ color: accent }}>
          PLACING {what}
        </span>
        <span className="hidden text-lg leading-none whitespace-nowrap text-gg-mute min-[900px]:inline">
          — click a glowing lot · ESC to cancel
        </span>
        <Button variant="outline" size="sm" onClick={() => useGrid.getState().setBuildMode(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

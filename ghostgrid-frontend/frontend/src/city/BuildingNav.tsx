// Right HUD rail: every building in the city, one click to open its panel.
// DOM only. Re-renders when a building is added, removed, renamed or changes status.
//
// Bottom-right, next to the panel it opens.
// The side panel owns the right edge when it is open, so the rail steps left of it
// above 900px and hides below that, where the panel grows to nearly the full width.
import type { CSSProperties } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CATALOG } from '@/constants'
import { useGrid } from '@/store/grid'
import type { Building, BuildingStatus } from '@/types'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid'

// Same reading as the city's own status lighting (STATUS_EMISSIVE in city3d/materials.ts), but
// written as CSS vars: importing that module here would pull three.js into the DOM bundle.
const STATUS_COLOR: Record<BuildingStatus, string> = {
  idle: 'var(--gg-cyan)',
  working: 'var(--gg-green)',
  needs_approval: 'var(--gg-yellow)',
  error: 'var(--gg-red)',
}
const STATUS_LABEL: Record<BuildingStatus, string> = {
  idle: 'idle',
  working: 'working',
  needs_approval: 'needs approval',
  error: 'error',
}

/**
 * What a row really is, which is not always its status.
 *
 * Two thirds of the skyline cannot run anything: the demo bots seeded from the
 * backend catalog have no `/api/v1/bots` to run on, and a Wall Street tower is a
 * GitHub repo, not an agent. Both sit at `idle` forever, and "idle" next to a live
 * agent reads as "ready" — which is how a tower called GARAGE becomes a mystery.
 */
function rowKind(b: Building): { note: string; live: boolean; hint: string } {
  if (b.type === 'quant') return { note: 'repo', live: false, hint: 'open-source project, not an agent' }
  return { note: STATUS_LABEL[b.status], live: true, hint: STATUS_LABEL[b.status] }
}

export function BuildingNav() {
  const order = useGrid((s) => s.order)
  const buildings = useGrid((s) => s.buildings)
  const selected = useGrid((s) => s.selected)
  // Same reading the build menu's banner uses, so both HUD pieces clear the panel together.
  const panelOpen = useGrid((s) => s.panel !== null)

  // Store order is the city's own render order, so the rail reads top-down like the map.
  const list = order.map((id) => buildings[id]).filter(Boolean)
  if (list.length === 0) return null

  // The panel is 380px wide at right-4, so it ends 396px in; 412px clears it by one gutter.
  return (
    <nav
      aria-label="Buildings"
      data-hud-panel
      className={`absolute right-4 bottom-4 z-40 flex w-14 flex-col border-2 border-gg-haze bg-gg-night/90 shadow-[4px_4px_0_0_rgba(0,0,0,0.6)] min-[900px]:w-48 ${
        panelOpen ? 'max-[900px]:hidden min-[900px]:right-[412px]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b-2 border-gg-haze px-2 py-2">
        <span className="font-pixel text-[8px] leading-none text-gg-ink min-[900px]:hidden">GO</span>
        <span className="font-pixel hidden text-[10px] leading-none text-gg-ink min-[900px]:inline">BUILDINGS</span>
        <span className="font-pixel text-[8px] leading-none text-gg-mute">{list.length}</span>
      </div>

      <ul className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto overscroll-contain p-1">
        {list.map((b) => {
          const accent = b.bot?.color ?? CATALOG[b.type].accent
          const status = STATUS_COLOR[b.status]
          const on = selected === b.id
          const kind = rowKind(b)
          return (
            <li key={b.id}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  aria-label={`${b.name}, ${kind.note}`}
                  aria-pressed={on}
                  // Clicking the open building closes its panel again, so the rail toggles
                  // rather than stranding the player in a panel they just dismissed.
                  onClick={() => {
                    const s = useGrid.getState()
                    if (s.selected === b.id && s.panel === 'building') s.closePanel()
                    else s.selectBuilding(b.id)
                  }}
                  className={`flex w-full items-center justify-center gap-2 border-2 p-1.5 text-left transition-colors duration-100 min-[900px]:justify-start ${FOCUS} ${
                    on
                      ? 'bg-gg-dusk'
                      : 'border-gg-haze bg-gg-void/70 shadow-[2px_2px_0_0_rgba(0,0,0,0.6)] hover:border-[color:var(--bn-accent)] hover:bg-gg-dusk active:translate-x-0.5 active:translate-y-0.5 active:shadow-none'
                  }`}
                  style={
                    {
                      '--bn-accent': accent,
                      ...(on
                        ? {
                            borderColor: accent,
                            boxShadow: `2px 2px 0 0 rgba(0,0,0,0.6), 0 0 10px 0 color-mix(in srgb, ${accent} 50%, transparent)`,
                          }
                        : null),
                    } as CSSProperties
                  }
                >
                  <span
                    aria-hidden
                    className="relative size-4 shrink-0 border-2"
                    style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 35%, transparent)` }}
                  >
                    <span className="absolute -top-1 -right-1 block size-2" style={{ background: status }} />
                  </span>
                  <span className="hidden min-w-0 flex-col gap-1 min-[900px]:flex">
                    <span className="font-pixel truncate text-[8px] leading-tight text-gg-ink">{b.short}</span>
                    <span className="truncate text-lg leading-none" style={{ color: kind.live ? status : 'var(--gg-mute)' }}>
                      {kind.note}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8}>
                  {b.name} · {kind.hint}
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

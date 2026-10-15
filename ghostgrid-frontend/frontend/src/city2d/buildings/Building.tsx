// One clickable building: positions the art at BUILDING_RECT, maps store state to CSS state classes,
// and draws the overlays (approval "!" sign, selection caret, NO KEY plate, street name plate).
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BUILDINGS, STATUS_COLOR, STATUS_LABEL } from '../../constants'
import { useGrid } from '../../store/grid'
import { useIsOffline } from '../../store/keys'
import { BUILDING_RECT } from '../layout'
import type { StageBuildingId } from '../layout'
import { B, PixelText } from './parts'

const PLATE_TOP = 196 // stage y of the street name plate
const GLYPH_W = 4 // font-pixel advance at 4px

interface BuildingProps {
  id: StageBuildingId // only the buildings the 2D stage has art for
  mark: { x: number; y: number } // local px: bottom-center point above the roof for the "!" sign / caret
  nokeyY: number // local px: top of the NO KEY plate
  glitch: [number, number] // local px: y of the two glitch slices in error state
  children: ReactNode
}

export function Building({ id, mark, nokeyY, glitch, children }: BuildingProps) {
  const navigate = useNavigate()
  const status = useGrid((s) => s.buildings[id].status)
  const selected = useGrid((s) => s.selected === id)
  const noKey = useIsOffline(id)
  const offline = noKey && status === 'idle'
  const state = offline ? 'offline' : status
  const info = BUILDINGS[id]
  const r = BUILDING_RECT[id]

  const plateW = info.short.length * GLYPH_W + 10
  const plateX = Math.floor((r.w - plateW) / 2)
  const caretY = (status === 'needs_approval' ? mark.y - 15 : mark.y) - 5

  const cls = [
    'gg-bld',
    `gg-bld--${status}`,
    offline ? 'gg-bld--offline' : '',
    selected ? 'gg-bld--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={cls}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
      aria-label={`${info.name} — ${STATUS_LABEL[state].toLowerCase()}`}
      title={offline ? 'Add an API key first' : undefined}
      onClick={() => id === 'codex' ? navigate('/office/codex') : useGrid.getState().selectBuilding(id)}
    >
      <span className="gg-bld-body" aria-hidden="true">
        {children}
        <B x={-2} y={glitch[0]} w={r.w + 4} h={1} className="gg-bld-glitch" />
        <B x={-1} y={glitch[1]} w={r.w + 3} h={1} className="gg-bld-glitch gg-bld-glitch--b" />
      </span>

      {/* wet-street reflection in the state color */}
      <B x={4} y={r.h + 1} w={r.w - 8} h={1} className="gg-bld-reflect" />
      <B x={10} y={r.h + 2} w={r.w - 20} h={1} className="gg-bld-reflect gg-bld-reflect--far" />

      {status === 'needs_approval' && (
        <span className="gg-bld-alert" style={{ left: mark.x - 5, top: mark.y - 15 }} aria-hidden="true">
          <span className="gg-bld-alert-box">
            <B x={3} y={1} w={3} h={6} c="var(--gg-yellow)" />
            <B x={3} y={8} w={3} h={2} c="var(--gg-yellow)" />
          </span>
          <B x={5} y={13} w={1} h={2} className="gg-bld-alert-pole" />
        </span>
      )}

      {selected && (
        <span className="gg-bld-caret" style={{ left: mark.x - 2, top: caretY }} aria-hidden="true">
          <B x={0} y={0} w={5} h={1} />
          <B x={1} y={1} w={3} h={1} />
          <B x={2} y={2} w={1} h={1} />
        </span>
      )}

      {offline && (
        <span className="gg-bld-nokey" style={{ left: Math.floor((r.w - 30) / 2), top: nokeyY }} aria-hidden="true">
          <PixelText text="NO KEY" size={4} />
        </span>
      )}

      <span className="gg-bld-plate" style={{ left: plateX, top: PLATE_TOP - r.y, width: plateW }} aria-hidden="true">
        <span className="gg-bld-dot" style={{ background: STATUS_COLOR[state] }} />
        <PixelText text={info.short} size={GLYPH_W} className="gg-bld-plate-txt" />
      </span>
      <B x={plateX + 2} y={PLATE_TOP - r.y + 10} w={1} h={4} className="gg-bld-leg" />
      <B x={plateX + plateW - 3} y={PLATE_TOP - r.y + 10} w={1} h={4} className="gg-bld-leg" />
    </button>
  )
}

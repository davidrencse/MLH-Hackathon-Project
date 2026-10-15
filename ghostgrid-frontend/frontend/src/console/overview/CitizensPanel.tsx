// Row 3 left: every building as a compact citizen card, plus a "+ BUILD" card back to the city.
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { CATALOG, botLabel } from '@/constants'
import { useBuildingList } from '@/store/grid'
import { useIsOffline } from '@/store/keys'
import type { Building } from '@/types'
import { C, Panel } from './parts'

const CARD =
  'gg-ov-frame flex min-w-0 items-center gap-3 border-2 bg-gg-void/60 p-3 outline-none hover:bg-gg-dusk/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan'

function CitizenCard({ b }: { b: Building }) {
  const offline = useIsOffline(b.id)
  const status = offline && b.status === 'idle' ? 'offline' : b.status
  const accent = b.bot?.color ?? CATALOG[b.type].accent
  const running = b.sessions.filter((s) => s.status === 'running').length
  const kind = b.bot ? botLabel(b.bot).toUpperCase() : CATALOG[b.type].short

  return (
    <Link to={`/dashboard/agents/${b.id}`} className={`${CARD} border-gg-haze`} aria-label={`${b.name}, open agent`}>
      <span aria-hidden className="gg-ov-icon size-8 flex-none" style={{ background: accent }} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xl leading-none text-gg-ink">{b.name}</span>
        <span className="font-pixel truncate text-[8px] leading-none" style={{ color: accent }}>
          {kind}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-lg leading-none text-gg-mute">
            SESS <span className="tabular-nums text-gg-ink">{running}</span>/{b.sessions.length}
          </span>
        </span>
      </span>
    </Link>
  )
}

export function CitizensPanel() {
  const buildings = useBuildingList()
  return (
    <Panel title="CITIZENS" pip={C.pink} meta={<span className="text-lg leading-none text-gg-mute">{buildings.length} buildings</span>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {buildings.map((b) => (
          <CitizenCard key={b.id} b={b} />
        ))}
        <Link to="/" className={`${CARD} border-dashed border-gg-pink`} aria-label="Build a new building in the city">
          <span aria-hidden className="flex size-8 flex-none items-center justify-center border-2 border-gg-pink text-gg-pink">
            <Plus size={16} strokeWidth={2.5} />
          </span>
          <span className="flex min-w-0 flex-col gap-2">
            <span className="font-pixel text-[10px] leading-none text-gg-pink">+ BUILD</span>
            <span className="truncate text-lg leading-none text-gg-mute">Open BUILD menu</span>
          </span>
        </Link>
      </div>
    </Panel>
  )
}

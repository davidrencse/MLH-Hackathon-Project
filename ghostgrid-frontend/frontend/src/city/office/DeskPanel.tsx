// What used to be the SESSION MENU: a runtime picker and a START button that opened a desk.
// Nothing behind it reached the backend — it slept, flipped the desk to "running", waited six
// seconds and called it done — so the desks in this room were theatre whatever the backend was
// doing. It is replaced by the two things that are real: a read of the sessions this building's
// agent actually has, and the way new ones are made (hiring an employee in the office page).
import { RefreshCw, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useGrid } from '@/store/grid'
import type { Building } from '@/types'

export function DeskPanel({ building }: { building: Building }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const desks = building.sessions.length

  const refresh = async () => {
    setBusy(true)
    setError('')
    try { await useGrid.getState().loadSessions(building.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read this building’s sessions.') }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[16px] leading-[20px] text-gg-mute">
        {desks
          ? `${desks} ${desks === 1 ? 'desk' : 'desks'}, read from the backend. A desk is one of this building’s sessions.`
          : 'No desks. This building’s agent has no sessions on the backend — hire someone in the office to give it one.'}
      </p>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        className="gg-of-btn font-pixel flex h-8 items-center justify-center gap-1 border-2 border-gg-haze bg-gg-void px-2 text-[8px] leading-none text-gg-mute uppercase hover:border-gg-ink hover:text-gg-ink disabled:opacity-50"
      >
        <RefreshCw size={16} strokeWidth={2.5} />
        {busy ? 'Reading…' : 'Refresh desks'}
      </button>
      <button
        type="button"
        onClick={() => navigate(`/office/${encodeURIComponent(building.id)}`)}
        className="gg-of-btn font-pixel flex h-8 items-center justify-center gap-1 border-2 border-gg-pink bg-gg-void px-2 text-[8px] leading-none text-gg-pink uppercase hover:bg-gg-pink hover:text-gg-void"
      >
        <Users size={16} strokeWidth={2.5} />
        Staff this office
      </button>
      {error && <p role="alert" className="text-[16px] leading-[18px] text-gg-red">{error}</p>}
    </div>
  )
}

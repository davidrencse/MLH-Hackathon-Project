// An engineer hiring an intern of their own.
//
// The office's other hiring happens in the org editor, where an operator adds an employee to the
// chart. This is different and deliberately sits on the engineer rather than in that editor: an
// intern is not a member of the team, they belong to one engineer who stays accountable for their
// work. Putting the control anywhere else would make them look like a junior hire.
//
// Only an implementing role gets this. A lead that could hire its own helper would be
// implementing through the back door, and an intern that could hire would leave the office with
// no bottom — the backend refuses both with a 409, and OfficePage hides the control so the rule
// is visible before it is hit.
import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { backend, type OfficeEmployee } from '@/api/backend'

export function HireIntern({ projectId, buildingId, engineer, onHired }: {
  projectId: string
  buildingId: string
  engineer: OfficeEmployee
  /** Re-read the staff list, so the new stool appears in the room. */
  onHired: () => void
}) {
  const [open, setOpen] = useState(false)
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const hire = async () => {
    if (busy) return
    setBusy(true)
    setNote('')
    try {
      const answer = await backend.hireIntern({
        projectId,
        buildingId,
        engineerSessionId: engineer.sessionId,
        // An empty box is a hire with nothing to do yet, which is allowed: the engineer can
        // brief them from the chat afterwards. It is not sent as an empty task.
        task: task.trim() || undefined,
      })
      setNote(answer.task
        ? `${answer.intern.name} hired and started on it.`
        : `${answer.intern.name} hired. Give them something to do from their desk.`)
      setTask('')
      setOpen(false)
      onHired()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'could not hire an intern')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="native-hire-intern">
      {open ? (
        <div className="native-hire-intern-form">
          <label htmlFor="intern-task">
            What should {engineer.name}&rsquo;s intern do?
          </label>
          <textarea
            id="intern-task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="One piece of your task — small enough to hand over whole."
            rows={2}
          />
          <div className="native-hire-intern-actions">
            <button type="button" onClick={() => void hire()} disabled={busy}>
              {busy ? 'Hiring…' : 'Hire'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setNote('') }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="native-hire-intern-open" onClick={() => setOpen(true)}>
          <UserPlus size={14} strokeWidth={2.5} />
          Hire an intern
        </button>
      )}
      {note && <p role="status" className="native-hire-intern-note">{note}</p>}
    </div>
  )
}

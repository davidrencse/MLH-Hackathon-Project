// Why: who is working on what, for one office. The projects are the folders this machine's coding
// CLIs are actually open in (see lanes.ts), so eight `claude` terminals in one repo show up as one
// project with eight people on it and nothing to set up. The player can name extra lanes for work
// that has no terminal yet, and drag anyone between them.
//
// Full-width lanes rather than narrow columns: a project here collects many people while the list
// of projects stays short, and a lane gives a name, a folder path and a terminal's uptime the room
// they need to be read. It also means no sideways scrolling on a laptop or a phone.
import { useState, type DragEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useOrg } from './org'
import { BENCH, lanesFrom, laneOf, type Lane } from './lanes'
import { LaneRun } from './LaneRun'
import { useLaneRuns } from './laneRuns'
import { shortPath, type CrewMember } from './crew'
import { shortRole } from './org'

// Seniority order for the mix bar. Any title the office invented sorts after the three it
// ships with, so a custom role appears without having to be registered here.
const ROLE_ORDER = ['Manager', 'Team Lead', 'Engineer']
const rolesIn = (members: CrewMember[]): string[] =>
  [...new Set(members.map((member) => member.role))].sort((left, right) => {
    const l = ROLE_ORDER.indexOf(left), r = ROLE_ORDER.indexOf(right)
    return (l < 0 ? ROLE_ORDER.length : l) - (r < 0 ? ROLE_ORDER.length : r) || left.localeCompare(right)
  })
const SOURCE_LABEL: Record<CrewMember['source'], string> = { live: 'live', desk: 'desk', agent: 'backend', subagent: 'subagent' }

/**
 * What to say under a person's name. Inside the lane for their own folder the path is the lane's
 * own heading, repeated on every card in it, so the card drops it and keeps only what is true of
 * this person alone: which terminal, and how long it has been up. Anywhere else — the bench, or a
 * lane they were dragged to — the folder is news, so it stays.
 */
function detailFor(member: CrewMember, lane: string): string {
  const detail = member.detail || 'not running'
  // Only a folder lane can repeat itself here: a lane keyed by an office project (`stream`) is
  // named after that project, which the detail line never contains. So this reads cwd directly
  // rather than folderOf, which returns whichever of the two placed the person.
  const cwd = member.cwd?.trim()
  if (!cwd || lane !== cwd) return detail
  const tail = ` · ${shortPath(cwd)}`
  return detail.endsWith(tail) ? detail.slice(0, -tail.length) : detail
}

/** Role mix as one pixel bar, so a project missing a lead reads at a glance. */
function RoleMix({ members }: { members: CrewMember[] }) {
  const counts = rolesIn(members).map((role) => ({ role, count: members.filter((m) => m.role === role).length }))
  return (
    <span className="gg-sb-mix">
      <span className="gg-sb-mix-bar" aria-hidden="true">
        {counts.flatMap(({ role, count }) =>
          Array.from({ length: count }, (_, i) => <i key={`${role}${i}`} data-role={role} />))}
      </span>
      <span className="gg-sb-mix-text">
        {counts.filter(({ count }) => count > 0).map(({ role, count }) => `${count} ${shortRole(role)}`).join(' · ') || 'nobody'}
      </span>
    </span>
  )
}

function Card({ member, lanes, lane, selected, dragging, onSelect, onMove, onDragState }: {
  member: CrewMember
  lanes: Lane[]
  lane: string
  selected: boolean
  dragging: boolean
  onSelect: () => void
  onMove: (laneId: string) => void
  onDragState: (id: string | null) => void
}) {
  return (
    <div className="gg-sb-card" draggable
      // Dragging is mouse-only, so the card is also a button: selecting it opens the move
      // control below, which is how a keyboard or a touchscreen reassigns someone.
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-role={member.role}
      data-source={member.source}
      data-dragging={dragging}
      data-selected={selected}
      title={member.cwd ?? member.detail}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (event.target !== event.currentTarget) return // the move select owns its own keys
        event.preventDefault()
        onSelect()
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', member.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragState(member.id)
      }}
      onDragEnd={() => onDragState(null)}>
      <span className="gg-sb-card-top">
        <span className="gg-role" data-role={member.role} data-source={member.source}>{shortRole(member.role)}</span>
        <b>{member.name}</b>
      </span>
      {/* "live"/"desk" says where the process came from, which the detail does not. */}
      <span className="gg-sb-card-detail">
        {`${SOURCE_LABEL[member.source]} · ${detailFor(member, lane)}`}
      </span>
      {selected && (
        <label className="gg-sb-move">
          <span className="native-label">Move to</span>
          <select value={lane} aria-label={`Move ${member.name} to a project`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onMove(event.target.value)}>
            <option value={BENCH}>Bench</option>
            {lanes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

export function ProjectBoard({ crew, streams = [], selected, onSelect, projectId, buildingId }: {
  crew: CrewMember[]
  /** The backend's work streams: projects the server holds, whether or not a terminal is in one. */
  streams?: { id: string; name: string }[]
  selected: string | null
  onSelect: (id: string | null) => void
  /** Empty until the backend has booted; the run controls stay inert without it. */
  projectId: string
  buildingId: string
}) {
  const runs = useLaneRuns(projectId, buildingId)
  const { projects, assign, assignTo, addProject, removeProject } = useOrg()
  const [over, setOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const lanes = lanesFrom(crew, projects, streams)
  const real = crew.length // every member is a real process now
  const membersIn = (laneId: string) => crew.filter((member) => laneOf(member, assign, lanes) === laneId)
  const benched = membersIn(BENCH)

  const drop = (laneId: string) => (event: DragEvent) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain')
    if (id) assignTo(id, laneId)
    setOver(null)
    setDragging(null)
  }
  const dropProps = (laneId: string) => ({
    'data-hot': over === laneId,
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(laneId) },
    onDragLeave: () => setOver((current) => (current === laneId ? null : current)),
    onDrop: drop(laneId),
  })
  const cardProps = (member: CrewMember) => ({
    member,
    lanes,
    lane: laneOf(member, assign, lanes),
    selected: selected === member.id,
    dragging: dragging === member.id,
    onSelect: () => onSelect(selected === member.id ? null : member.id),
    onMove: (laneId: string) => assignTo(member.id, laneId),
    onDragState: setDragging,
  })

  return (
    <section className="gg-sb" aria-label="Staffing board">
      <header>
        <h2>Staffing board</h2>
        <span className="native-label">
          {crew.length} on staff · {real} at a real terminal · give a lane a goal and run it
        </span>
        {runs.outage && <span className="gg-sb-outage">{runs.outage}</span>}
        <form className="gg-sb-add" onSubmit={(event) => { event.preventDefault(); addProject(draft); setDraft('') }}>
          <input aria-label="New project name" value={draft} placeholder="Name a project…"
            onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="gg-pixel-button" data-tone="accent" disabled={!draft.trim()}>
            <Plus size={14} strokeWidth={2.5} /> Add
          </button>
        </form>
      </header>

      <div className="gg-sb-lanes">
        {lanes.map((lane) => {
          const members = membersIn(lane.id)
          return (
            <div key={lane.id} className="gg-sb-lane" {...dropProps(lane.id)}>
              <header>
                <h3>{lane.name}</h3>
                {/* A folder lane shows where it is; a hand-named one is already marked by the
                    close button only it gets, so it needs no label saying so. */}
                {lane.path && <span className="gg-sb-lane-path" title={lane.id}>{lane.path}</span>}
                <RoleMix members={members} />
                <span className="gg-sb-lane-count">{members.length}</span>
                {lane.manual && (
                  <button type="button" className="gg-pixel-button" data-tone="danger"
                    title={`Close ${lane.name} and bench its staff`} onClick={() => removeProject(lane.id)}>
                    <X size={14} strokeWidth={2.5} />
                  </button>
                )}
              </header>
              {projectId && <LaneRun lane={lane} runs={runs} staffed={members.length} />}
              <div className="gg-sb-cards">
                {members.map((member) => <Card key={member.id} {...cardProps(member)} />)}
                {!members.length && <p className="gg-sb-empty">Drag someone here</p>}
              </div>
            </div>
          )
        })}

        {/* An office with nobody in it gets the invitation on its own: a bench with a zero
            counter and an empty role meter is chrome describing nothing. */}
        {crew.length > 0 && (
          <div className="gg-sb-lane" data-bench="true" {...dropProps(BENCH)}>
            <header>
              <h3>Bench</h3>
              <span className="gg-sb-lane-path">Not on a project yet</span>
              <RoleMix members={benched} />
              <span className="gg-sb-lane-count">{benched.length}</span>
            </header>
            <div className="gg-sb-cards">
              {benched.map((member) => <Card key={member.id} {...cardProps(member)} />)}
              {!benched.length && <p className="gg-sb-empty">Everyone is on a project</p>}
            </div>
          </div>
        )}

        {!lanes.length && (
          <p className="gg-sb-none">
            {crew.length > 0
              ? 'No projects yet. Open a coding terminal in a folder and it becomes one, or name a lane above to plan work that has not started.'
              : 'Nobody is working here yet. Open a coding terminal in a project folder and it takes a desk, or add a worker on the right.'}
          </p>
        )}
      </div>
    </section>
  )
}

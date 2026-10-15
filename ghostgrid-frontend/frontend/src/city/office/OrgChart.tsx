// Why: who is working on what, for one building. An office here is a project, and the only way to
// open one is to add the project — so this chart is a list of projects with the people standing in
// each, and the one creative act it offers is naming a new project.
//
// It used to offer "new office / hire / promote / fire" over a roster of invented people. None of
// those existed anywhere but this panel: the invented staff had no folder, so they could never
// stand in a project, and the offices they belonged to stopped being what the floor was drawn
// from. An employee is a coding CLI you hired — a `claude`, `codex` or `deepseek` process already
// running on the machine, or a window Ghost Grid opened for you — so hiring happens by starting
// one (Add a worker, beside this panel), not by inventing a name here.
//
// Selecting anyone here selects the same desk in the room and the same card on the staffing board.
import { useState, type ReactNode } from 'react'
import { Building2, Plus, X } from 'lucide-react'
import { shortRole, useOrg } from './org'
import { BENCH, lanesFrom, laneOf, type Lane } from './lanes'
import { treeOf, type OrgNode } from './orgTree'
import type { CrewMember } from './crew'


export function OrgChart({ buildingName, roster, selected, onSelect }: {
  buildingName: string
  roster: { live: CrewMember[]; desks: CrewMember[] }
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const { projects, assign, assignTo, addProject, removeProject } = useOrg()
  const [closing, setClosing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const crew = [...roster.live, ...roster.desks]
  const lanes = lanesFrom(crew, projects)

  // Everyone, grouped by the project they stand in. A lane with nobody on it is still a project:
  // it is an office waiting for its first hire.
  const inLane = (lane: Lane) => crew.filter((member) => laneOf(member, assign, lanes) === lane.id)
  const benched = crew.filter((member) => laneOf(member, assign, lanes) === BENCH)
  const picked = crew.find((member) => member.id === selected) ?? null

  const closeProject = (name: string) => {
    removeProject(name)
    setClosing(null)
  }

  const person = (node: OrgNode): ReactNode => {
    const { member } = node
    return (
      <li key={member.id}>
        <button type="button" className="gg-oc-person" aria-pressed={selected === member.id}
          onClick={() => onSelect(selected === member.id ? null : member.id)}>
          <span className="gg-role" data-role={member.role} data-source={member.source}>{shortRole(member.role)}</span>
          <b>{member.name}</b>
          <em data-lane="true">{member.detail}</em>
        </button>
        {node.reports.length > 0 && <ul>{node.reports.map(person)}</ul>}
      </li>
    )
  }

  const branch = (key: string, label: ReactNode, count: number, actions: ReactNode, people: CrewMember[], note: string) => (
    <li key={key}>
      <div className="gg-oc-branch">
        <h3>{label}</h3>
        <span className="gg-oc-branch-count">{count}</span>
        {actions}
      </div>
      {people.length
        ? <ul>{treeOf(people).map(person)}</ul>
        : <p className="gg-oc-branch-empty">{note}</p>}
    </li>
  )

  return (
    <section className="gg-oc" aria-label={`Projects in ${buildingName}`}>
      <header>
        <h2>Projects</h2>
        <span className="native-label">{buildingName}</span>
      </header>

      <ul className="gg-oc-tree">
        <li>
          <div className="gg-oc-root"><b>You</b><span className="native-label">Running this office</span></div>
          <ul>
            {lanes.map((lane) => branch(
              lane.id,
              <><Building2 size={13} strokeWidth={2.5} aria-hidden="true" />{lane.name}</>,
              inLane(lane).length,
              <span className="gg-oc-branch-actions">
                {/* A folder lane exists because a terminal is open in it; closing it would be a
                    lie the next scan undoes. Only a project you named can be closed. */}
                {lane.manual && (closing === lane.id
                  ? <>
                    <button type="button" className="gg-pixel-button" data-tone="danger" onClick={() => closeProject(lane.id)}>Close it</button>
                    <button type="button" className="gg-pixel-button" onClick={() => setClosing(null)}>Keep</button>
                  </>
                  : <button type="button" className="gg-pixel-button" title={`Close ${lane.name}`} onClick={() => setClosing(lane.id)}>
                    <X size={13} strokeWidth={2.5} />
                  </button>)}
                {!lane.manual && <span className="gg-oc-live-tag">live</span>}
              </span>,
              inLane(lane),
              'Nobody hired onto this yet. Start a CLI in its folder, or add a worker and assign them here.',
            ))}
            {benched.length > 0 && branch(
              'bench',
              'On the bench',
              benched.length,
              null,
              benched,
              '',
            )}
            <li>
              <form className="gg-oc-add-form" onSubmit={(event) => { event.preventDefault(); addProject(draft); setDraft('') }}>
                <input
                  aria-label="New project name"
                  placeholder="New project"
                  maxLength={60}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" className="gg-pixel-button gg-oc-add" disabled={!draft.trim()}>
                  <Plus size={14} strokeWidth={2.5} /> Add project
                </button>
              </form>
            </li>
          </ul>
        </li>
      </ul>

      {/* One detail strip under the whole chart, so opening it never reshuffles the tree. */}
      {picked && (
        <div className="gg-oc-detail">
          <div className="gg-oc-detail-who">
            <span className="gg-role" data-role={picked.role} data-source={picked.source}>{shortRole(picked.role)}</span>
            <b>{picked.name}</b>
            <span className="native-label">{picked.role}</span>
          </div>
          <p>{picked.source === 'live'
            ? `A terminal running on this machine · ${picked.detail}`
            : `A window Ghost Grid opened · ${picked.detail}`}</p>
          <label>
            <span className="native-label">Project</span>
            <select value={laneOf(picked, assign, lanes)} aria-label={`Assign ${picked.name} to a project`}
              onChange={(event) => assignTo(picked.id, event.target.value)}>
              <option value={BENCH}>Bench</option>
              {lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}

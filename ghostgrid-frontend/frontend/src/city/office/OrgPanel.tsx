// Why: clicking someone inside the 3D room opens this over the canvas. It is the same assignment
// control as the staffing board and the org chart, so it must resolve a person's project the same
// way they do — an explicit assignment first, otherwise the folder their terminal is really open
// in. It used to read `assign` on its own, so anyone standing in a real project was reported here
// as unassigned, and the lane they were in was not even offered in the list.
import { useState } from 'react'
import { X } from 'lucide-react'
import { shortRole, useOrg } from './org'
import { BENCH, laneForId, laneLabel, type Lane, type Staffed } from './lanes'


export function OrgPanel({ nameOf, lanes, crew }: {
  nameOf: (id?: string) => string
  lanes: Lane[]
  crew?: Map<string, Staffed>
}) {
  const { picked, pick, assign, assignTo, addProject } = useOrg()
  const [draft, setDraft] = useState('')
  if (!picked) return null
  const current = laneForId(picked.id, crew, assign, lanes)
  const name = laneLabel(current, lanes)
  return (
    <div className="gg-room-panel" onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <h3>{picked.name}</h3>
        <button type="button" aria-label="Close" onClick={() => pick(null)}><X size={14} strokeWidth={2.5} /></button>
      </header>
      <p><span className="gg-role" data-role={picked.role}>{shortRole(picked.role)}</span> reports to {picked.reportsTo ? nameOf(picked.reportsTo) : 'CEO (you)'}</p>
      <label htmlFor="room-panel-project" className="native-label">Project</label>
      <select id="room-panel-project" value={current} onChange={(event) => assignTo(picked.id, event.target.value)}>
        <option value={BENCH}>— Bench —</option>
        {lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
      </select>
      <form onSubmit={(event) => {
        event.preventDefault()
        const typed = draft.trim()
        if (!typed) return
        addProject(typed)
        assignTo(picked.id, typed)
        setDraft('')
      }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="New project…" aria-label="New project name" />
        <button type="submit" className="gg-pixel-button" data-tone="accent">Add</button>
      </form>
      {name
        ? <p className="gg-room-panel-ok">✔ On {name}</p>
        : <p className="gg-orc-hint">On the bench — pick a project above.</p>}
    </div>
  )
}

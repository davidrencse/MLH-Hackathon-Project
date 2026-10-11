import { useState } from 'react'
import { useOrg } from './org'

const BADGE: Record<string, string> = { Manager: '#ff004d', 'Team Lead': '#ffa300', Engineer: '#29adff' }

export function OrgPanel({ nameOf }: { nameOf: (id?: string) => string }) {
  const { picked, pick, projects, assign, assignTo, addProject } = useOrg()
  const [draft, setDraft] = useState('')
  if (!picked) return null
  const current = assign[picked.id] ?? ''
  const box = { position: 'absolute' as const, right: 12, top: 12, zIndex: 30, width: 260, background: '#fffbe8', color: '#111', border: '3px solid #111', boxShadow: '5px 5px 0 #111', padding: 12, font: "10px/1.6 'Press Start 2P', monospace" }
  return (
    <div style={box} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ fontSize: 11 }}>{picked.name}</b>
        <button onClick={() => pick(null)} style={{ font: 'inherit', background: 'none', border: 0, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'inline-block', margin: '6px 0', padding: '2px 6px', background: BADGE[picked.role], color: '#fff' }}>{picked.role}</div>
      <div>Reports to: {picked.reportsTo ? nameOf(picked.reportsTo) : 'CEO (you)'}</div>
      <div style={{ marginTop: 8 }}>Project:</div>
      <select value={current} onChange={(e) => assignTo(picked.id, e.target.value)} style={{ width: '100%', font: 'inherit', padding: 4, border: '2px solid #111', background: '#fff' }}>
        <option value="">— Unassigned (bench) —</option>
        {projects.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <form onSubmit={(e) => { e.preventDefault(); addProject(draft); if (draft.trim()) assignTo(picked.id, draft.trim()); setDraft('') }} style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New project…" style={{ flex: 1, minWidth: 0, font: 'inherit', padding: 4, border: '2px solid #111' }} />
        <button style={{ font: 'inherit', border: '2px solid #111', background: '#ffec27', cursor: 'pointer' }}>＋</button>
      </form>
      {current && <div style={{ marginTop: 8, color: '#008751' }}>✔ Assigned to {current}</div>}
    </div>
  )
}

// Drag-and-drop staffing board: drag an employee card onto a project column (or the Bench).
import { useState, type DragEvent } from 'react'
import { useOrg } from './org'
import { useBuildingOffices } from './OrgChart'

const px = "'Press Start 2P', monospace"
const ROLE = { Manager: ['MGR', '#ff004d'], 'Team Lead': ['LEAD', '#ffa300'], Engineer: ['ENG', '#29adff'] } as const
const COLS = ['#ffec27', '#29adff', '#00e436', '#ff77a8', '#ffa300', '#83769c']

export function ProjectBoard({ buildingId }: { buildingId: string }) {
  const offices = useBuildingOffices(buildingId)
  const { projects, assign, assignTo, addProject } = useOrg()
  const [over, setOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const people = offices.flatMap((o) => o.people.map((p) => ({ ...p, office: o.name })))
  const columns = ['', ...projects]

  const drop = (col: string) => (e: DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (id) assignTo(id, col)
    setOver(null); setDragging(null)
  }

  return (
    <section style={{ background: '#1a1040', border: '3px solid #111', boxShadow: '5px 5px 0 #111', padding: 12, marginBottom: 20, font: `9px/1.5 ${px}`, color: '#e8e6ff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ fontSize: 11, color: '#ffec27' }}>STAFFING BOARD</b>
        <span style={{ fontSize: 8, color: '#a99fd0' }}>drag people onto a project</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
        {columns.map((col, i) => {
          const members = people.filter((p) => (assign[p.id] ?? '') === col)
          const color = col ? COLS[(i - 1) % COLS.length] : '#83769c'
          const hot = over === col
          return (
            <div key={col || 'bench'} onDragOver={(e) => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver((o) => (o === col ? null : o))} onDrop={drop(col)}
              style={{ minWidth: 150, flex: '0 0 150px', background: hot ? '#2d2066' : '#120b2a', border: `2px ${hot ? 'solid' : 'dashed'} ${hot ? color : '#3a2f6b'}`, padding: 6, transition: 'background .12s', minHeight: 120 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color }}>
                <b>{col || '🪑 BENCH'}</b><span>{members.length}</span>
              </div>
              {members.map((p) => {
                const [t, c] = ROLE[p.role]
                return (
                  <div key={p.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; setDragging(p.id) }} onDragEnd={() => { setDragging(null); setOver(null) }}
                    title={`${p.name} · ${p.role} · ${p.office} office`}
                    style={{ background: '#fffbe8', color: '#111', border: '2px solid #111', boxShadow: dragging === p.id ? 'none' : '2px 2px 0 #000', opacity: dragging === p.id ? 0.4 : 1, padding: '4px 5px', marginBottom: 5, cursor: 'grab', font: `8px/1.4 ${px}`, borderLeft: `6px solid ${c}` }}>
                    <span style={{ background: c, color: '#fff', padding: '0 3px', marginRight: 4 }}>{t}</span>{p.name}
                    <div style={{ color: '#666', fontSize: 7 }}>{p.office}</div>
                  </div>
                )
              })}
              {!members.length && <div style={{ color: '#5d5390', fontSize: 7, textAlign: 'center', paddingTop: 20 }}>drop here</div>}
            </div>
          )
        })}
        <form onSubmit={(e) => { e.preventDefault(); addProject(draft); setDraft('') }} style={{ minWidth: 150, flex: '0 0 150px', border: '2px dashed #3a2f6b', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New project…" style={{ font: `8px ${px}`, padding: 5, border: '2px solid #111' }} />
          <button style={{ font: `9px ${px}`, background: '#ffec27', border: '2px solid #111', padding: 6, cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>＋ PROJECT</button>
        </form>
      </div>
    </section>
  )
}

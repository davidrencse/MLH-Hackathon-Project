// Visible org-chart UI for a building: offices (teams) -> manager -> employees, click to assign a project.
import { useState } from 'react'
import { create } from 'zustand'
import { useOrg } from './org'

interface Person { id: string; name: string; role: 'Manager' | 'Team Lead' | 'Engineer' }
interface Office { id: string; name: string; people: Person[] }
const KEY = 'gg-offices'
const FIRST = ['Maya', 'Leo', 'Priya', 'Kai', 'Zoe', 'Arjun', 'Nova', 'Sam', 'Iris', 'Theo', 'Luna', 'Rex', 'Jun', 'Ava', 'Omar', 'Mei']
const OFFICE_NAMES = ['Platform', 'Agents R&D', 'Growth', 'Infra', 'Evals', 'Design', 'Security', 'Research']
let n = Date.now() % 1000
const uid = () => `p${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`
const pickName = () => FIRST[Math.floor(Math.random() * FIRST.length)]
const newOffice = (name: string): Office => ({ id: uid(), name, people: [
  { id: uid(), name: `${pickName()}`, role: 'Manager' }, { id: uid(), name: pickName(), role: 'Team Lead' },
  { id: uid(), name: pickName(), role: 'Engineer' }, { id: uid(), name: pickName(), role: 'Engineer' } ] })

const load = (): Record<string, Office[]> => JSON.parse(localStorage.getItem(KEY) ?? '{}')
const useOffices = create<{ by: Record<string, Office[]>; update: (b: string, f: (o: Office[]) => Office[]) => void }>((set) => ({
  by: load(),
  update: (b, f) => set((s) => { const by = { ...s.by, [b]: f(s.by[b] ?? [newOffice('HQ')]) }; localStorage.setItem(KEY, JSON.stringify(by)); return { by } }),
}))

const C = { MGR: '#ff004d', LEAD: '#ffa300', ENG: '#29adff' }
const tag = (r: Person['role']) => r === 'Manager' ? ['MGR', C.MGR] : r === 'Team Lead' ? ['LEAD', C.LEAD] : ['ENG', C.ENG]
const px = "'Press Start 2P', monospace"
const btn = { font: `9px ${px}`, border: '2px solid #111', background: '#ffec27', color: '#111', padding: '6px 8px', cursor: 'pointer', boxShadow: '2px 2px 0 #111' }

export function OrgChart({ buildingId, buildingName, realWorkers }: { buildingId: string; buildingName: string; realWorkers: { id: string; name: string }[] }) {
  const stored = useOffices((s) => s.by[buildingId])
  const update = useOffices((s) => s.update)
  const offices = stored ?? [newOffice('HQ')]
  const { projects, assign, assignTo, addProject } = useOrg()
  const [sel, setSel] = useState<{ office: string; person: Person } | null>(null)
  const [draft, setDraft] = useState('')
  const officesWithReal = offices.map((o, i) => i === 0 ? { ...o, people: [...o.people, ...realWorkers.map((w) => ({ id: w.id, name: `${w.name} (live)`, role: 'Engineer' as const }))] } : o)

  const addOffice = () => update(buildingId, (os) => [...os, newOffice(OFFICE_NAMES[os.length % OFFICE_NAMES.length] + (os.length >= OFFICE_NAMES.length ? ` ${os.length}` : ''))])
  const hire = (oid: string) => update(buildingId, (os) => os.map((o) => o.id === oid ? { ...o, people: [...o.people, { id: uid(), name: pickName(), role: 'Engineer' }] } : o))
  const promote = (oid: string, pid: string) => update(buildingId, (os) => os.map((o) => o.id === oid ? { ...o, people: o.people.map((p) => p.id === pid ? { ...p, role: p.role === 'Engineer' ? 'Team Lead' : p.role } : p) } : o))
  const fire = (oid: string, pid: string) => { update(buildingId, (os) => os.map((o) => o.id === oid ? { ...o, people: o.people.filter((p) => p.id !== pid) } : o)); setSel(null) }
  const closeOffice = (oid: string) => update(buildingId, (os) => os.length > 1 ? os.filter((o) => o.id !== oid) : os)

  return (
    <section style={{ background: '#fffbe8', color: '#111', border: '3px solid #111', boxShadow: '5px 5px 0 #111', padding: 14, marginBottom: 20, font: `10px/1.6 ${px}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 12 }}>ORG CHART · {buildingName}</b>
        <button style={{ ...btn, fontSize: 14, padding: '4px 10px' }} title="Add office" onClick={addOffice}>＋</button>
      </div>
      <div style={{ fontSize: 8, color: '#555', marginBottom: 10 }}>CEO (you) → Office Managers → Leads → Engineers · click anyone to assign</div>
      {officesWithReal.map((o) => {
        const mgr = o.people.find((p) => p.role === 'Manager')
        return (
          <div key={o.id} style={{ border: '2px solid #111', background: '#fff', padding: 8, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>🏢 {o.name} OFFICE</b>
              <span style={{ display: 'flex', gap: 4 }}>
                <button style={btn} onClick={() => hire(o.id)} title="Hire engineer">＋ HIRE</button>
                {offices.length > 1 && <button style={{ ...btn, background: '#c2c3c7' }} onClick={() => closeOffice(o.id)} title="Close office">✕</button>}
              </span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...o.people].sort((a, b) => ['Manager', 'Team Lead', 'Engineer'].indexOf(a.role) - ['Manager', 'Team Lead', 'Engineer'].indexOf(b.role)).map((p) => {
                const [t, c] = tag(p.role)
                const active = sel?.person.id === p.id
                return (
                  <button key={p.id} onClick={() => setSel(active ? null : { office: o.id, person: p })}
                    style={{ font: `8px/1.5 ${px}`, textAlign: 'left', border: `2px solid ${active ? c : '#111'}`, background: active ? '#ffec27' : '#fffbe8', padding: '4px 6px', cursor: 'pointer', marginLeft: p.role === 'Engineer' ? 14 : 0 }}>
                    <span style={{ background: c, color: '#fff', padding: '0 3px', marginRight: 4 }}>{t}</span>{p.name}
                    {assign[p.id] && <div style={{ color: '#008751' }}>▸ {assign[p.id]}</div>}
                  </button>
                )
              })}
            </div>
            {sel && sel.office === o.id && (
              <div style={{ marginTop: 8, borderTop: '2px dashed #111', paddingTop: 8 }}>
                <div>{sel.person.name} · {sel.person.role} · reports to {sel.person.role === 'Manager' ? 'CEO (you)' : mgr?.name ?? 'Manager'}</div>
                <select value={assign[sel.person.id] ?? ''} onChange={(e) => assignTo(sel.person.id, e.target.value)} style={{ width: '100%', font: `9px ${px}`, padding: 4, border: '2px solid #111', marginTop: 6 }}>
                  <option value="">— Unassigned (bench) —</option>
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { addProject(draft); assignTo(sel.person.id, draft.trim()) } setDraft('') }} style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New project…" style={{ flex: 1, minWidth: 0, font: `9px ${px}`, padding: 4, border: '2px solid #111' }} />
                  <button style={btn}>＋</button>
                </form>
                {!sel.person.name.endsWith('(live)') && <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  {sel.person.role === 'Engineer' && <button style={btn} onClick={() => { promote(o.id, sel.person.id); setSel(null) }}>⬆ PROMOTE</button>}
                  {sel.person.role !== 'Manager' && <button style={{ ...btn, background: '#ff004d', color: '#fff' }} onClick={() => fire(o.id, sel.person.id)}>FIRE</button>}
                </div>}
              </div>
            )}
          </div>
        )
      })}
      <button style={{ ...btn, width: '100%', padding: 10, fontSize: 10 }} onClick={addOffice}>＋ NEW OFFICE</button>
    </section>
  )
}

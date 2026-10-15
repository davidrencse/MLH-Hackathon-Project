// Why: the org chart beside the room shows who works here, but every line in it — who reports to
// whom, what job someone holds, who is on which work stream — was fixed at hire time. This is
// where those lines are changed.
//
// Everything here is a write to a backend employee (a session with a role), and every write goes
// through the same route the server rebuilds the standing brief on, so a promotion is not a label
// change: the next task that employee runs is briefed as the new job. That is why the composed
// brief is shown read-only at the bottom rather than edited directly — it is the server's output,
// and seeing it is how the operator checks that a role edit actually landed.
//
// Terminal desks upstairs are not here on purpose. A desk is a window a human types in; it has no
// role, no reporting line and no brief, and the server cannot send it work.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, Plus, Save, UserPlus } from 'lucide-react'
import {
  backend, type BackendSession, type OfficeEmployee, type OfficeRole, type OfficeStream,
} from '@/api/backend'
import { shortRole } from './org'

const KIND_LABEL: Record<OfficeRole['kind'], string> = {
  manage: 'plans', lead: 'leads', build: 'builds', intern: 'helps',
}

interface Node { person: OfficeEmployee; reports: Node[] }

/** The reporting tree, with anyone whose manager is missing or off-building shown at the top. */
function treeOf(staff: OfficeEmployee[]): Node[] {
  const byId = new Map(staff.map((person) => [person.sessionId, person]))
  const nodes = new Map(staff.map((person) => [person.sessionId, { person, reports: [] as Node[] }]))
  const roots: Node[] = []
  for (const node of nodes.values()) {
    const parent = node.person.managerId ? nodes.get(node.person.managerId) : undefined
    if (parent && parent !== node && byId.has(node.person.managerId ?? '')) parent.reports.push(node)
    else roots.push(node)
  }
  return roots
}

/** Everyone below one employee, so the manager picker cannot offer a reporting loop. */
function descendants(staff: OfficeEmployee[], id: string): Set<string> {
  const out = new Set<string>()
  const walk = (managerId: string) => {
    for (const person of staff) {
      if (person.managerId !== managerId || out.has(person.sessionId)) continue
      out.add(person.sessionId)
      walk(person.sessionId)
    }
  }
  walk(id)
  return out
}

export function OrgEditor({ projectId, agentId, buildingId, staff, streams, selected, onSelect, onChanged }: {
  projectId: string
  agentId: string
  buildingId: string
  staff: OfficeEmployee[]
  streams: OfficeStream[]
  selected: string | null
  onSelect: (id: string | null) => void
  /** Re-reads the floor after a write, so the room and the board follow the chart. */
  onChanged: () => void
}) {
  const [roles, setRoles] = useState<OfficeRole[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState('')
  const [record, setRecord] = useState<BackendSession | null>(null)
  const [hiring, setHiring] = useState(false)
  const [hire, setHire] = useState({ name: '', title: '', team: 'Platform', managerId: '', officeProjectId: '' })

  const picked = useMemo(
    () => staff.find((person) => person.sessionId === selected) ?? null,
    [staff, selected],
  )

  useEffect(() => {
    if (!projectId) return
    let active = true
    void backend.officeRoles(projectId)
      .then((catalog) => { if (active) setRoles(catalog.items) })
      .catch(() => { /* the chart still reads without the role list */ })
    return () => { active = false }
  }, [projectId])

  // The employee's own record, for the brief the server composed and the notes it holds. Read on
  // selection rather than polled: it only changes when something here writes it.
  // `stale()` is what keeps a slow read for the previous desk from overwriting the one the
  // operator has already clicked on: two reads in flight can land in either order.
  const loadRecord = useCallback(async (id: string | null, stale: () => boolean = () => false) => {
    if (!id) { setRecord(null); setNotes(''); return }
    try {
      const session = await backend.session(id)
      if (stale()) return
      setRecord(session)
      setNotes(session.briefNotes ?? '')
    } catch { if (!stale()) setRecord(null) }
  }, [])
  useEffect(() => {
    let dropped = false
    void loadRecord(picked?.sessionId ?? null, () => dropped)
    return () => { dropped = true }
  }, [picked?.sessionId, loadRecord])

  const report = (reason: unknown, fallback: string) =>
    setError(reason instanceof Error && /route not found/i.test(reason.message)
      ? 'Restart the backend with ./dev.sh backend to load the org controls.'
      : reason instanceof Error ? reason.message : fallback)

  /**
   * One org write, with the same reporting every time. `told` is what the operator is shown; an
   * action that knows more than the caller did — a promotion knows which rung it landed on —
   * returns its own message instead, and that wins.
   */
  const write = async (
    label: string,
    action: () => Promise<string | unknown>,
    told: string,
  ) => {
    if (busy) return
    setBusy(label); setError(''); setNote('')
    try {
      const said = await action()
      setNote(typeof said === 'string' && said ? said : told)
      onChanged()
      await loadRecord(picked?.sessionId ?? null)
    } catch (reason) { report(reason, 'That change could not be saved.') }
    finally { setBusy('') }
  }

  const step = (direction: 'promote' | 'demote') => {
    if (!picked) return
    void write(direction, async () => {
      const result = direction === 'promote'
        ? await backend.promoteEmployee(picked.sessionId)
        : await backend.demoteEmployee(picked.sessionId)
      return `${picked.name}: ${result.from} → ${result.to}. Brief rebuilt.`
    }, '')
  }

  const addEmployee = async () => {
    if (!agentId || busy) return
    const title = hire.title || roles[roles.length - 1]?.name
    setBusy('hire'); setError(''); setNote('')
    try {
      const created = await backend.hireOfficeEmployee({
        projectId,
        agentId,
        name: hire.name.trim() || `Employee ${staff.length + 1}`,
        title,
        team: hire.team.trim() || 'Platform',
        managerId: hire.managerId || null,
        officeProjectId: hire.officeProjectId || null,
      })
      setNote(`Hired ${created.name} as ${created.title ?? title}.`)
      setHire({ name: '', title: '', team: hire.team, managerId: '', officeProjectId: '' })
      setHiring(false)
      onSelect(created.id)
      onChanged()
    } catch (reason) { report(reason, 'The employee could not be hired.') }
    finally { setBusy('') }
  }

  const row = (node: Node, depth = 0): ReactElement[] => [
    <li key={node.person.sessionId} style={{ marginLeft: depth * 10 }}>
      <button type="button" aria-pressed={selected === node.person.sessionId}
        onClick={() => onSelect(selected === node.person.sessionId ? null : node.person.sessionId)}>
        <span className="gg-role" data-role={node.person.title} data-source="agent">{shortRole(node.person.title)}</span>
        <b>{node.person.name}</b>
        <em>{node.person.title} · {KIND_LABEL[node.person.roleKind]} · {node.person.team}
          {node.person.activeTasks > 0 ? ` · ${node.person.activeTasks} in flight` : ''}</em>
      </button>
    </li>,
    ...node.reports.flatMap((child) => row(child, depth + 1)),
  ]

  if (!projectId) return (
    <section className="gg-orgedit" aria-label="Org editor">
      <p className="gg-roles-empty">Start the backend to edit this office’s org chart.</p>
    </section>
  )

  const senior = roles.length ? roles[0]!.name : ''
  const junior = roles.length ? roles[roles.length - 1]!.name : ''
  const atTop = picked ? picked.title === senior : false
  const atBottom = picked ? picked.title === junior : false

  return (
    <section className="gg-orgedit" aria-label="Org editor">
      <header className="gg-roles-head">
        <div>
          <h2>Reporting lines</h2>
          <p>Backend employees only: these are the staff the orchestrator can give work to.</p>
        </div>
        <button type="button" className="gg-pixel-button" onClick={() => setHiring((open) => !open)}>
          <UserPlus size={13} strokeWidth={2.5} /> {hiring ? 'Cancel' : 'Hire'}
        </button>
      </header>

      {hiring && (
        <form className="gg-orgedit-hire" onSubmit={(event) => { event.preventDefault(); void addEmployee() }}>
          <label htmlFor="hire-name">Name</label>
          <input id="hire-name" maxLength={80} value={hire.name} placeholder={`Employee ${staff.length + 1}`}
            onChange={(event) => setHire({ ...hire, name: event.target.value })} />
          <label htmlFor="hire-title">Role</label>
          <select id="hire-title" value={hire.title} onChange={(event) => setHire({ ...hire, title: event.target.value })}>
            <option value="">{junior || 'Most junior role'}</option>
            {roles.map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
          </select>
          <label htmlFor="hire-team">Team</label>
          <input id="hire-team" maxLength={60} value={hire.team}
            onChange={(event) => setHire({ ...hire, team: event.target.value })} />
          <label htmlFor="hire-manager">Reports to</label>
          <select id="hire-manager" value={hire.managerId}
            onChange={(event) => setHire({ ...hire, managerId: event.target.value })}>
            <option value="">You (nobody in the office)</option>
            {staff.map((person) => (
              <option key={person.sessionId} value={person.sessionId}>{person.name} — {person.title}</option>
            ))}
          </select>
          <label htmlFor="hire-stream">Work stream</label>
          <select id="hire-stream" value={hire.officeProjectId}
            onChange={(event) => setHire({ ...hire, officeProjectId: event.target.value })}>
            <option value="">On the bench</option>
            {streams.map((stream) => <option key={stream.id} value={stream.id}>{stream.name}</option>)}
          </select>
          <button type="submit" className="gg-pixel-button" data-tone="go" disabled={busy === 'hire' || !agentId}>
            <Plus size={13} strokeWidth={2.5} /> {busy === 'hire' ? 'Hiring…' : 'Hire into this office'}
          </button>
          {!agentId && <p className="gg-roles-hint">This building has no backend agent yet.</p>}
        </form>
      )}

      {staff.length
        ? <ul className="gg-orgedit-tree">{treeOf(staff).flatMap((node) => row(node))}</ul>
        : <p className="gg-roles-empty">No backend employees in {buildingId} yet. Hire one to orchestrate work.</p>}

      {picked && (
        <div className="gg-orgedit-detail">
          <div className="gg-orgedit-ladder">
            <button type="button" className="gg-pixel-button" disabled={busy !== '' || atTop}
              title={atTop ? `${picked.name} already holds the most senior role` : `Promote ${picked.name}`}
              onClick={() => step('promote')}>
              <ChevronUp size={13} strokeWidth={2.5} /> Promote
            </button>
            <button type="button" className="gg-pixel-button" disabled={busy !== '' || atBottom}
              title={atBottom ? `${picked.name} already holds the most junior role` : `Demote ${picked.name}`}
              onClick={() => step('demote')}>
              <ChevronDown size={13} strokeWidth={2.5} /> Demote
            </button>
            <span className="native-label">{picked.title}</span>
          </div>

          <label htmlFor="org-role">Role</label>
          <select id="org-role" value={picked.title} disabled={busy !== ''}
            onChange={(event) => void write('role', () =>
              backend.assignOfficeEmployee(picked.sessionId, { title: event.target.value }),
              `${picked.name} is now ${event.target.value}. Brief rebuilt.`)}>
            {roles.map((role) => <option key={role.id} value={role.name}>{role.name} — {KIND_LABEL[role.kind]}</option>)}
            {!roles.some((role) => role.name === picked.title) && <option value={picked.title}>{picked.title}</option>}
          </select>

          <label htmlFor="org-manager">Reports to</label>
          <select id="org-manager" value={picked.managerId ?? ''} disabled={busy !== ''}
            onChange={(event) => void write('manager', () =>
              backend.assignOfficeEmployee(picked.sessionId, { managerId: event.target.value || null }),
              event.target.value
                ? `${picked.name} now reports to ${staff.find((p) => p.sessionId === event.target.value)?.name ?? 'them'}.`
                : `${picked.name} now reports to you.`)}>
            <option value="">You (nobody in the office)</option>
            {staff
              .filter((person) => person.sessionId !== picked.sessionId
                && !descendants(staff, picked.sessionId).has(person.sessionId))
              .map((person) => (
                <option key={person.sessionId} value={person.sessionId}>{person.name} — {person.title}</option>
              ))}
          </select>

          <label htmlFor="org-team">Team</label>
          <input id="org-team" maxLength={60} defaultValue={picked.team} disabled={busy !== ''}
            key={`team-${picked.sessionId}`}
            onBlur={(event) => {
              const team = event.target.value.trim()
              if (!team || team === picked.team) return
              void write('team', () => backend.assignOfficeEmployee(picked.sessionId, { team }),
                `${picked.name} moved to the ${team} team.`)
            }} />

          <label htmlFor="org-stream">Work stream</label>
          <select id="org-stream" value={picked.officeProjectId ?? ''} disabled={busy !== ''}
            onChange={(event) => void write('stream', () =>
              backend.assignOfficeEmployee(picked.sessionId, { officeProjectId: event.target.value || null }),
              event.target.value
                ? `${picked.name} is on ${streams.find((s) => s.id === event.target.value)?.name ?? 'that stream'}.`
                : `${picked.name} is on the bench.`)}>
            <option value="">On the bench</option>
            {streams.map((stream) => <option key={stream.id} value={stream.id}>{stream.name}</option>)}
          </select>

          <label htmlFor="org-notes">Standing note for {picked.name} only</label>
          <textarea id="org-notes" rows={3} maxLength={4000} value={notes}
            placeholder="e.g. Never touch the migrations folder."
            onChange={(event) => setNotes(event.target.value)} />
          <button type="button" className="gg-pixel-button" data-tone="go"
            disabled={busy !== '' || notes === (record?.briefNotes ?? '')}
            onClick={() => void write('notes', () =>
              backend.assignOfficeEmployee(picked.sessionId, { briefNotes: notes }),
              'Saved. It is in their brief from the next task on.')}>
            <Save size={13} strokeWidth={2.5} /> Save note
          </button>

          {record?.brief && (
            <details className="gg-orgedit-brief">
              <summary>The brief {picked.name} carries ({record.brief.length} characters)</summary>
              <pre>{record.brief}</pre>
            </details>
          )}
        </div>
      )}

      {note && <p className="gg-roles-note" role="status">{note}</p>}
      {error && <p className="native-office-error" role="alert">{error}</p>}
    </section>
  )
}

// Why: a role brief is the prompt every employee of that job carries into every task, and until
// now the three jobs and their briefs were compiled into the backend. This is the editor for
// them: rename a job, rewrite what it is accountable for, add jobs the office never had.
//
// Two things keep it honest. The brief text is composed on the server from the role plus the
// employee's own org fields, so nothing here renders a preview of a prompt that might differ from
// the one that runs — what it reports instead is how many employees the server re-briefed. And a
// role's *kind* is edited as plainly as its name, because kind is what decides where a holder
// lands in an orchestration run; a job called "Reviewer" that declares `build` would be handed
// implementation work, and the operator should be able to see that.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Save, Trash2, Wand2 } from 'lucide-react'
import { backend, type OfficeRole, type OfficeRoleCatalog, type RoleKind } from '@/api/backend'

const KIND_LABEL: Record<RoleKind, string> = {
  manage: 'Plans & signs off',
  lead: 'Designs & reviews',
  build: 'Implements',
  // Not a rung below Engineer: an intern is hired by one engineer for one piece of their task
  // and answers to them, so the orchestrator never plans a node for one.
  intern: "Helps one engineer",
}
const KIND_ORDER: RoleKind[] = ['manage', 'lead', 'build', 'intern']

interface Draft {
  name: string
  kind: RoleKind
  rank: number
  remit: string
  answer: string
}

const draftOf = (role: Pick<OfficeRole, 'name' | 'kind' | 'rank' | 'remit' | 'answer'>): Draft => ({
  name: role.name,
  kind: role.kind,
  rank: role.rank,
  remit: role.remit.join('\n'),
  answer: role.answer.join('\n'),
})
const linesOf = (value: string): string[] =>
  value.split('\n').map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean)

export function RolesDeck({ projectId, onRolesChanged }: {
  projectId: string
  /** Fired after any write, so the floor and the org editor re-read who holds what. */
  onRolesChanged?: () => void
}) {
  const [catalog, setCatalog] = useState<OfficeRoleCatalog | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [reassignTo, setReassignTo] = useState('')

  const load = useCallback(async (keep?: string) => {
    if (!projectId) return
    try {
      const answer = await backend.officeRoles(projectId)
      setCatalog(answer)
      const next = keep ?? picked
      const found = answer.items.find((role) => role.id === next) ?? answer.items[0]
      if (found) {
        setPicked(found.id)
        setDraft(draftOf(found))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read this office’s roles.')
    }
    // `picked` is read as a starting preference only; adding it would reload on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // Memoised so the selected role is not recomputed against a fresh array every render.
  const roles = useMemo(() => catalog?.items ?? [], [catalog])
  const current = useMemo(() => roles.find((role) => role.id === picked) ?? null, [roles, picked])
  const dirty = Boolean(current && draft && (
    draft.name !== current.name ||
    draft.kind !== current.kind ||
    draft.rank !== current.rank ||
    draft.remit !== current.remit.join('\n') ||
    draft.answer !== current.answer.join('\n')
  ))

  const select = (id: string) => {
    const role = roles.find((entry) => entry.id === id)
    if (!role) return
    setPicked(id)
    setDraft(draftOf(role))
    setConfirming(false)
    setError('')
    setNote('')
  }

  const save = async () => {
    if (!current || !draft || busy) return
    const remit = linesOf(draft.remit)
    const answer = linesOf(draft.answer)
    if (!draft.name.trim()) { setError('A role needs a name.'); return }
    if (!remit.length) { setError('Give this role at least one line of remit — it is what the brief is built from.'); return }
    if (!answer.length) { setError('Say how this role must answer, in at least one line.'); return }
    setBusy(true); setError(''); setNote('')
    try {
      const saved = await backend.updateOfficeRole(current.id, {
        projectId, name: draft.name.trim(), kind: draft.kind, rank: draft.rank, remit, answer,
      })
      setNote(saved.rebriefed
        ? `Saved. ${saved.rebriefed} ${saved.rebriefed === 1 ? 'employee was' : 'employees were'} re-briefed${saved.renamedFrom ? ` and moved from “${saved.renamedFrom}”` : ''}.`
        : 'Saved. Nobody holds this role yet, so no briefs changed.')
      await load(saved.id)
      onRolesChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The role could not be saved.')
    } finally { setBusy(false) }
  }

  const create = async (preset?: OfficeRoleCatalog['presets'][number]) => {
    if (busy) return
    setBusy(true); setError(''); setNote('')
    try {
      const taken = new Set(roles.map((role) => role.name.toLowerCase()))
      const base = preset?.name ?? 'New role'
      let name = base
      for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`
      const created = await backend.createOfficeRole({
        projectId,
        name,
        kind: preset?.kind ?? 'build',
        rank: preset?.rank ?? 0,
        remit: preset?.remit ?? ['Say what this role is accountable for, one line at a time.'],
        answer: preset?.answer ?? ['Say what shape this role’s answers must take.'],
      })
      setNote(preset
        ? `Added ${created.name}. Edit the brief before hiring into it.`
        : `Added ${created.name}. It has placeholder text — write the brief before hiring into it.`)
      await load(created.id)
      onRolesChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The role could not be added.')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!current || busy) return
    setBusy(true); setError(''); setNote('')
    try {
      const result = await backend.deleteOfficeRole(current.id, projectId, reassignTo || undefined)
      setNote(result.moved
        ? `Deleted. ${result.moved} ${result.moved === 1 ? 'employee is' : 'employees are'} now ${result.movedTo}.`
        : 'Deleted. Nobody held it.')
      setConfirming(false)
      setReassignTo('')
      setPicked(null)
      await load()
      onRolesChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The role could not be deleted.')
    } finally { setBusy(false) }
  }

  if (!projectId) return (
    <section className="gg-roles" aria-label="Roles">
      <p className="gg-roles-empty">Start the backend to edit this office’s roles.</p>
    </section>
  )

  return (
    <section className="gg-roles" aria-label="Roles and briefs">
      <header className="gg-roles-head">
        <div>
          <h2>Roles</h2>
          <p>What each job is accountable for. Every employee carries their role’s brief into every task.</p>
        </div>
        <button type="button" className="gg-pixel-button" disabled={busy} onClick={() => void create()}>
          <Plus size={13} strokeWidth={2.5} /> New role
        </button>
      </header>

      <ul className="gg-roles-list">
        {roles.map((role) => (
          <li key={role.id}>
            <button type="button" aria-pressed={picked === role.id} onClick={() => select(role.id)}>
              <b>{role.name}</b>
              <span className="gg-roles-kind" data-kind={role.kind}>{KIND_LABEL[role.kind]}</span>
              <em>{role.holders ? `${role.holders} on staff` : 'nobody yet'} · rank {role.rank}</em>
            </button>
          </li>
        ))}
      </ul>

      {catalog?.presets.length ? (
        <div className="gg-roles-presets">
          <span className="native-label"><Wand2 size={12} strokeWidth={2.5} aria-hidden="true" /> Start from</span>
          {catalog.presets.map((preset) => (
            <button key={preset.name} type="button" className="gg-pixel-button" disabled={busy}
              title={`Add ${preset.name}: ${preset.remit[0] ?? ''}`} onClick={() => void create(preset)}>
              {preset.name}
            </button>
          ))}
        </div>
      ) : null}

      {current && draft && (
        <form className="gg-roles-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <label htmlFor="role-name">Job title</label>
          <input id="role-name" maxLength={80} value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          {current.holders > 0 && draft.name !== current.name && (
            <p className="gg-roles-hint">Renaming moves {current.holders} {current.holders === 1 ? 'employee' : 'employees'} onto the new title.</p>
          )}

          <fieldset className="gg-roles-kinds">
            <legend>What this role does in a run</legend>
            {KIND_ORDER.map((kind) => (
              <label key={kind} data-selected={draft.kind === kind}>
                <input type="radio" name="role-kind" value={kind} checked={draft.kind === kind}
                  onChange={() => setDraft({ ...draft, kind })} />
                <b>{KIND_LABEL[kind]}</b>
                <em>{catalog?.kinds.find((entry) => entry.kind === kind)?.summary}</em>
              </label>
            ))}
          </fieldset>

          <label htmlFor="role-rank">Seniority</label>
          <input id="role-rank" type="number" min={-50} max={50} value={draft.rank}
            onChange={(event) => setDraft({ ...draft, rank: Number(event.target.value) || 0 })} />
          <p className="gg-roles-hint">Promote and demote step to the nearest rank above or below. Equal ranks are a flat org.</p>

          <label htmlFor="role-remit">Remit — one line each</label>
          <textarea id="role-remit" rows={7} spellCheck value={draft.remit}
            onChange={(event) => setDraft({ ...draft, remit: event.target.value })} />
          <p className="gg-roles-hint">Written in the second person: “You own…”. This becomes the brief’s remit section.</p>

          <label htmlFor="role-answer">How to answer — one line each</label>
          <textarea id="role-answer" rows={5} spellCheck value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })} />

          <div className="gg-roles-actions">
            <button type="submit" className="gg-pixel-button" data-tone="go" disabled={busy || !dirty}>
              <Save size={13} strokeWidth={2.5} /> {busy ? 'Saving…' : 'Save role & re-brief'}
            </button>
            <button type="button" className="gg-pixel-button" disabled={busy || !dirty}
              onClick={() => setDraft(draftOf(current))}>
              <RotateCcw size={13} strokeWidth={2.5} /> Revert
            </button>
            {confirming ? (
              <>
                {current.holders > 0 && (
                  <label className="gg-roles-reassign">
                    <span className="native-label">Move {current.holders} to</span>
                    <select value={reassignTo} onChange={(event) => setReassignTo(event.target.value)}>
                      <option value="">Nearest role below</option>
                      {roles.filter((role) => role.id !== current.id)
                        .map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className="gg-pixel-button" data-tone="danger" disabled={busy}
                  onClick={() => void remove()}>Delete it</button>
                <button type="button" className="gg-pixel-button" disabled={busy}
                  onClick={() => setConfirming(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="gg-pixel-button" disabled={busy || roles.length < 2}
                title={roles.length < 2 ? 'An office needs at least one role' : `Delete ${current.name}`}
                onClick={() => setConfirming(true)}>
                <Trash2 size={13} strokeWidth={2.5} /> Delete
              </button>
            )}
          </div>
        </form>
      )}

      {note && <p className="gg-roles-note" role="status">{note}</p>}
      {error && <p className="native-office-error" role="alert">{error}</p>}
    </section>
  )
}

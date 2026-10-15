// Why: skills are what makes one terminal better at a job than another, so the office sells them
// like equipment. The deck downloads real skill folders through `skills.sh` on the backend
// machine, in one of two scopes:
//
//   MODEL     -> the CLI's own folder (~/.claude/skills). Every terminal of that model gets it.
//   EMPLOYEE  -> that employee's project folder (<cwd>/.claude/skills). Only their terminal does.
//
// The employee list is the same roster the room and the staffing board use, so you equip the
// person whose desk you were just looking at. Only staff with a real working directory can be
// equipped — invented headcount has no folder to install into.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Trash2 } from 'lucide-react'
import { backend, type SkillCard, type SkillCatalog, type SkillRuntime } from '@/api/backend'
import type { CrewMember } from './crew'
import { shortPath } from './crew'

const MODEL_SCOPE = 'model'

export function SkillsDeck({ runtime, model, crew, selected, onSelect }: {
  runtime: SkillRuntime
  model: string
  crew: CrewMember[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  // Only staff with a working directory can hold a project-scoped skill.
  const equippable = useMemo(() => crew.filter((member) => Boolean(member.cwd)), [crew])
  const [scope, setScope] = useState<string>(MODEL_SCOPE)
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('')

  // Selecting a desk anywhere else points the deck at that employee, so "equip the one I just
  // clicked" needs no second choice.
  useEffect(() => {
    if (selected && equippable.some((member) => member.id === selected)) setScope(selected)
  }, [selected, equippable])

  const employee = scope === MODEL_SCOPE ? null : equippable.find((member) => member.id === scope) ?? null
  const workspace = employee?.cwd ?? undefined
  // A scope the crew no longer has (their terminal closed) falls back to the model.
  const effectiveScope = scope !== MODEL_SCOPE && !employee ? MODEL_SCOPE : scope

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setCatalog(await backend.officeSkills(runtime, workspace)) }
    catch (reason) {
      setCatalog(null)
      setError(reason instanceof Error && /route not found/i.test(reason.message)
        ? 'Restart the backend with ./dev.sh backend to load the skills deck.'
        : reason instanceof Error ? reason.message : 'Could not read the skill catalog.')
    }
    finally { setLoading(false) }
  }, [runtime, workspace])

  useEffect(() => { void load() }, [load])

  const install = async (skill: SkillCard) => {
    if (busy) return
    setBusy(skill.name)
    setError('')
    setNote(`Downloading ${skill.name}…`)
    try {
      const result = await backend.installOfficeSkills({ runtime, skills: [skill.name], workspace })
      setNote(result.installed.length
        ? `${result.installed.join(', ')} installed for ${employee ? employee.name : model}.`
        : `${skill.name} was not installed.`)
      await load()
    } catch (reason) {
      setNote('')
      setError(reason instanceof Error ? reason.message : `Could not install ${skill.name}.`)
    } finally { setBusy(null) }
  }

  const remove = async (skill: SkillCard) => {
    if (busy) return
    setBusy(skill.name)
    setError('')
    try {
      await backend.removeOfficeSkill({ runtime, skill: skill.name, workspace })
      setNote(`${skill.name} removed.`)
      await load()
    } catch (reason) {
      setNote('')
      setError(reason instanceof Error ? reason.message : `Could not remove ${skill.name}.`)
    } finally { setBusy(null) }
  }

  const items = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const cards = catalog?.items ?? []
    const matching = needle
      ? cards.filter((card) => card.name.toLowerCase().includes(needle) || (card.description ?? '').toLowerCase().includes(needle))
      : cards
    // Installed first: the deck doubles as the loadout for whoever is in scope.
    return [...matching].sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }, [catalog, filter])
  const installed = catalog?.items.filter((card) => card.installed).length ?? 0

  return (
    <section className="gg-sd" aria-label="Skills deck">
      <header>
        <h2>Skills deck · {model}</h2>
        <span className="native-label">{installed} equipped{catalog ? ` · ${catalog.repo}` : ''}</span>
      </header>

      <div className="gg-sd-controls">
        <label htmlFor="skills-scope" className="native-label">Install for</label>
        <select id="skills-scope" value={effectiveScope} onChange={(event) => {
          setScope(event.target.value)
          setNote('')
          if (event.target.value !== MODEL_SCOPE) onSelect(event.target.value)
        }}>
          <option value={MODEL_SCOPE}>{model} — every terminal ({crew.filter((member) => member.source === 'live').length} live)</option>
          {equippable.map((member) => (
            <option key={member.id} value={member.id}>{member.name} — {shortPath(member.cwd)}</option>
          ))}
        </select>
        <input aria-label="Filter skills" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter skills…" />
        <button type="button" className="gg-pixel-button" onClick={() => void load()} disabled={loading || busy !== null} title="Re-read the catalog">
          <RefreshCw size={14} strokeWidth={2.5} /> Refresh
        </button>
      </div>

      <p className="gg-sd-target">
        {employee
          ? <>Installs into <b>{employee.name}</b>’s project only — <code>{catalog?.target ?? `${employee.cwd}/.${runtime}/skills`}</code></>
          : <>Installs for every {model} terminal on this machine — <code>{catalog?.target ?? `~/.${runtime}/skills`}</code></>}
      </p>

      {loading && !catalog && <p className="gg-sd-empty">Reading the {model} skill catalog…</p>}
      {error && <p role="alert" className="native-office-error">{error}</p>}
      {note && !error && <p className="gg-sd-note" role="status">{note}</p>}

      {catalog && <div className="gg-sd-cards">
        {items.map((card) => (
          <article key={card.name} className="gg-sd-card" data-installed={card.installed}>
            <h3>{card.name}{card.experimental && <em>exp</em>}{card.local && <em>local</em>}</h3>
            <p>{card.description ?? (card.local ? 'Installed on this machine, not in the catalog.' : 'No description upstream.')}</p>
            <footer>
              {card.installed
                ? <button type="button" className="gg-pixel-button" data-tone="danger" disabled={busy !== null} onClick={() => void remove(card)}>
                    <Trash2 size={14} strokeWidth={2.5} /> {busy === card.name ? 'Working…' : 'Remove'}
                  </button>
                : <button type="button" className="gg-pixel-button" data-tone="accent" disabled={busy !== null} onClick={() => void install(card)}>
                    <Download size={14} strokeWidth={2.5} /> {busy === card.name ? 'Downloading…' : 'Download'}
                  </button>}
            </footer>
          </article>
        ))}
        {!items.length && <p className="gg-sd-empty">{filter ? `No skill matches “${filter}”.` : 'This catalog is empty.'}</p>}
      </div>}
    </section>
  )
}

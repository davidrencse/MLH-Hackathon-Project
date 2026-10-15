// Why: the walk-in office for one building. Two kinds of desk share the room: terminals already
// running on the machine, which the backend finds by itself (nine `claude` shells are nine
// employees), and windows Ghost Grid opens on request. Both feed one roster, so the room, the
// staffing board and the org chart always agree on who works here, and selecting someone in any
// of them selects them everywhere.
//
// The layout is one screen with no page scroll: the room takes the height that is left, and
// everything that describes the office lives in the right rail as tabs. It used to stack the
// board, the skills deck and the chart below the room — 2.8 screens tall, with the same eight
// people drawn five times — so the rail states the roster once and the room is the other
// representation of it. Only a tab body and the terminal scroll.
//
// The tabs are the office's whole control surface: who is here (ROSTER), what they are staffed
// on (BOARD), who reports to whom (ORG), what each job *is* (ROLES), the work the server is
// actually running (RUNS) and what they are equipped with (SKILLS).
import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy, type CSSProperties, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Monitor, Plus, Trash2 } from 'lucide-react'
import { backend, type CliSubagent, type OfficeRuntime, type OfficeStream, type OfficeWorker } from '@/api/backend'
import { HireIntern } from './HireIntern'
import { backendStatus } from '@/api/config'
import { bootstrap } from '@/api/live'
import { CATALOG, hasOfficePage } from '@/constants'
import { useGrid } from '@/store/grid'
import type { BuildingType } from '@/types'
import './native-office.css'
// Loaded after it: the one-screen layout and the rail (see office-rail.css).
import './office-rail.css'
import { SceneBoundary } from '../SceneBoundary'
import { OrgChart } from './OrgChart'
import { OrgEditor } from './OrgEditor'
import { ProjectBoard } from './ProjectBoard'
import { RolesDeck } from './RolesDeck'
import { SkillsDeck } from './SkillsDeck'
import { Orchestrator } from './Orchestrator'
import { asRoomWorker, isLiveCrewId, useBackendStaff, useCrewRoster, useDetectedCrew } from './crew'
import { shortRole } from './org'
import { CrewTerminal } from './CrewTerminal'
import { EmployeeChat } from './EmployeeChat'
import type { SkillRuntime } from '@/api/backend'
const OfficeRoom3D = lazy(() => import('./OfficeRoom3D').then((module) => ({ default: module.OfficeRoom3D })))

const RUNTIME_NAMES: Record<OfficeRuntime, string> = {
  codex: 'Codex terminal', claude: 'Claude terminal', deepseek: 'DeepSeek terminal',
  'chatgpt-browser': 'ChatGPT browser', 'claude-browser': 'Claude browser',
  'deepseek-browser': 'DeepSeek browser',
}

// Each office opens on its own provider's runtime; the rest stay selectable.
const HOME_RUNTIME: Partial<Record<BuildingType, OfficeRuntime>> = {
  claude: 'claude', deepseek: 'deepseek', codex: 'codex',
}
// Each office's own CLI is also its skill catalog: Claude's office stocks anthropics/skills.
const SKILL_RUNTIME: Partial<Record<BuildingType, SkillRuntime>> = {
  claude: 'claude', codex: 'codex', deepseek: 'deepseek',
}
// The rail's tabs. One of these is the whole right-hand column at a time, which is what keeps
// the page to one screen.
//
// Hiring is its own tab rather than a form stapled under the roster. Reading who is here and
// adding somebody new are different jobs, and sharing one tab meant the roster scrolled past
// the fold as soon as the office had more than a few people in it.
type Tab = 'roster' | 'hire' | 'org' | 'roles' | 'runs' | 'skills'
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'roster', label: 'Roster', hint: 'Everyone in this office right now' },
  { id: 'hire', label: 'Hire', hint: 'Open a terminal or browser window for a new worker' },
  { id: 'org', label: 'Org', hint: 'Reporting lines, promotions and standing notes' },
  { id: 'roles', label: 'Roles', hint: 'What each job is accountable for' },
  { id: 'runs', label: 'Runs', hint: 'Give the team a goal and run it once — plan, build, review, sign-off' },
  { id: 'skills', label: 'Skills', hint: 'What each CLI is equipped with' },
]

const OFFICE_TITLE: Partial<Record<BuildingType, string>> = {
  claude: 'Claude’s cozy office', codex: 'Codex’s cozy office', deepseek: 'DeepSeek’s cozy office',
}

/**
 * What a desk Ghost Grid opened is doing. A desk is a window on this machine, and the backend can
 * only see it if its CLI leaves a transcript — when it does, the live crew carries a pid and the
 * CRT above shows the real session. Without one there is nothing to report, and this used to
 * animate a list of plausible commands (`npm run build`, `tests 24/24`) under the desk instead.
 */
function DeskState({ worker }: { worker: OfficeWorker }) {
  return <p className="native-desk-activity">
    {RUNTIME_NAMES[worker.runtime]} window · no transcript to read, so nothing is reported here.
    {worker.workspace ? ` Working in ${worker.workspace}.` : ''}
  </p>
}

export function OfficePage() {
  const { buildingId = '' } = useParams()
  const building = useGrid((state) => state.buildings[buildingId])
  const [desks, setDesks] = useState<OfficeWorker[]>([])
  const [options, setOptions] = useState<Awaited<ReturnType<typeof backend.officeOptions>> | null>(null)
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<OfficeRuntime>(HOME_RUNTIME[building?.type as BuildingType] ?? 'codex')
  const [workspace, setWorkspace] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const main = useRef<HTMLDivElement>(null)
  const [opening, setOpening] = useState(false)
  const [floor, setFloor] = useState(0)
  const [agentId, setAgentId] = useState('')
  const [tab, setTab] = useState<Tab>('roster')
  const valid = hasOfficePage(building?.type)

  // The machine's own terminals, polled while the tab is visible.
  const scan = useDetectedCrew(building?.type, valid)
  // The server's own employees and work streams, so the floor shows the org chart the backend
  // holds and not just the terminals this machine happens to have open.
  const agents = useBackendStaff(projectId, buildingId, valid && Boolean(projectId))
  const [streams, setStreams] = useState<OfficeStream[]>([])
  // Subagents the open terminal has reported, keyed by the pid that spawned them. CrewTerminal
  // already polls that transcript, so this is filled from its reads rather than a second poll.
  const [spawned, setSpawned] = useState<Map<number, CliSubagent[]>>(new Map())
  const takeSubagents = useCallback((pid: number, list: CliSubagent[]) => {
    setSpawned((prev) => {
      const before = prev.get(pid) ?? []
      // Identity-stable: re-setting on every poll would rebuild the roster, and with it every
      // desk in the 3D room, four times a second.
      if (before.length === list.length && before.every((agent, i) => agent.id === list[i].id)) return prev
      const next = new Map(prev)
      next.set(pid, list)
      return next
    })
  }, [])

  const roster = useCrewRoster(scan.crew, desks, agents.crew, spawned)
  // Live terminals take the front desks: they are the work actually happening.
  const roomWorkers = useMemo(
    () => [
      ...scan.crew.map((member) => asRoomWorker(member, buildingId)),
      // Seated on the floor like anyone else: the point of reading them off the transcript is
      // that a terminal running five agents stops looking like one person typing.
      ...roster.subagents.map((member) => asRoomWorker(member, buildingId)),
      ...desks,
    ],
    [scan.crew, roster.subagents, desks, buildingId],
  )

  useEffect(() => {
    if (!valid) { setLoading(false); return }
    let active = true
    setLoading(true)
    setError('')
    setDesks([])
    setOptions(null)
    setRuntime(HOME_RUNTIME[building.type] ?? 'codex')
    void (async () => {
      try {
        const status = await backendStatus()
        if (!status.live) throw new Error('Start the Ghost Grid backend to open real workers. Run ./dev.sh from the hackathon folder.')
        const [boot, available] = await Promise.all([bootstrap(), backend.officeOptions()])
        const id = boot.projectId
        const saved = await backend.officeWorkers(id, buildingId)
        if (!active) return
        setProjectId(id)
        // The building's own backend agent: its provider identity, and what an employee is hired
        // against. A player-built building may not have one, which the org tab says plainly.
        setAgentId(boot.agents[buildingId] ?? '')
        void backend.officeStreams(id).then((answer) => { if (active) setStreams(answer.items) }).catch(() => { /* the office still works on folders alone */ })
        setOptions(available)
        setWorkspace(available.workspaces[0] ?? '')
        setDesks(saved.items)
      } catch (reason) {
        if (active) setError(reason instanceof Error && /route not found/i.test(reason.message)
          ? 'Your backend is running an older version. Restart it with ./dev.sh backend to load the office controls.'
          : reason instanceof Error ? reason.message : 'Could not load the office. Try again after starting the backend.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [buildingId, valid, building?.type])

  // The panel under the room opens below the fold on a laptop — the room above it takes 300px of
  // the viewport on its own — so selecting somebody brings their panel into view. One place for
  // both kinds of person: a desk's terminal and an employee's conversation share the same box.
  //
  // `block: 'nearest'` is not enough: with the panel's top on screen it considers the job done
  // and leaves its bottom — the message box — hanging past the fold. So the bottom edge is what
  // is checked, and the scroll is repeated once the first transcript has landed and grown the
  // panel, which happens a poll after the click.
  useEffect(() => {
    if (!selected) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const bringIntoView = () => {
      const node = main.current?.querySelector('.native-selected-worker')
      if (!node) return
      const { top, bottom } = node.getBoundingClientRect()
      if (bottom <= window.innerHeight && top >= 0) return // already all there
      node.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' })
    }
    bringIntoView()
    const settled = window.setTimeout(bringIntoView, 1200)
    return () => window.clearTimeout(settled)
  }, [selected])

  const terminal = runtime === 'codex' || runtime === 'claude' || runtime === 'deepseek'
  const supported = options?.runtimes.includes(runtime) ?? false
  const addWorker = async (event: FormEvent) => {
    event.preventDefault()
    if (adding || !supported || !projectId) return
    setAdding(true)
    setError('')
    try {
      const worker = await backend.createOfficeWorker({ projectId, buildingId,
        name: name.trim() || `Worker ${desks.length + 1}`, runtime,
        workspace: terminal ? workspace.trim() : undefined })
      setDesks((current) => [...current, worker])
      setSelected(worker.id)
      setFloor(Math.floor((roomWorkers.length) / 12))
      setName('')
      // Hiring ends on the roster: the result of the action is a new person in that list, and
      // leaving the operator on an empty form hid the one thing that changed.
      setTab('roster')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The worker could not open. Please try again.') }
    finally { setAdding(false) }
  }

  const removeWorker = async (id: string) => {
    if (removing) return
    setRemoving(id)
    setError('')
    try {
      await backend.removeOfficeWorker(id)
      setDesks((current) => current.filter((desk) => desk.id !== id))
      setSelected(null)
      setFloor((current) => Math.min(current, Math.max(0, Math.ceil((roomWorkers.length - 1) / 12) - 1)))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove this desk.') }
    finally { setRemoving(null) }
  }

  if (!valid) return <main className="native-office"><Link to="/">Return to the city</Link><h1>Office not found</h1></main>
  const accent = CATALOG[building.type].accent
  const selectedMember = selected ? roster.byId.get(selected) ?? null : null
  const selectedWorker = roomWorkers.find((worker) => worker.id === selected)
  // A backend employee is a session with a role: clicking one opens their conversation, because
  // that is the only thing you can do with an employee that a desk cannot do.
  const selectedEmployee = agents.staff.find((person) => person.sessionId === selected) ?? null
  const live = isLiveCrewId(selected)
  const skillRuntime = SKILL_RUNTIME[building.type]
  const floorCount = Math.max(1, Math.ceil(roomWorkers.length / 12))
  const floorWorkers = roomWorkers.slice(floor * 12, floor * 12 + 12)
  const openAgain = async () => {
    if (!selectedWorker || opening || live) return
    setOpening(true)
    setError('')
    try { await backend.openOfficeWorker(selectedWorker.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the window.') }
    finally { setOpening(false) }
  }
  return (
    <main className="native-office" style={{ '--office-accent': accent } as CSSProperties}>
      <header className="native-office-header">
        <Link className="native-office-back" to="/"><ArrowLeft size={16} strokeWidth={2.5} /> City</Link>
        <div className="native-office-id">
          <h1>{OFFICE_TITLE[building.type] ?? `${building.name} office`}</h1>
          <p>A little room for big ideas. Every terminal you have open already works here.</p>
        </div>
        {/* Counted apart on purpose: terminals are processes on this machine, desks are windows
            Ghost Grid opened, employees are backend sessions the orchestrator can send work to.
            One total would read as if the machine had more terminals open than it does — and a
            single "8 running · 2 desks · 3 employees" string made the three impossible to tell
            apart at a glance. Three readouts, each with the colour its kind carries everywhere
            else in this office. */}
        <dl className="native-office-readouts">
          <div className="native-readout" data-kind="live" data-zero={scan.crew.length === 0}>
            <dt>Terminals</dt><dd>{scan.crew.length}</dd>
          </div>
          <div className="native-readout" data-kind="desk" data-zero={desks.length === 0}>
            <dt>Desks</dt><dd>{desks.length}</dd>
          </div>
          <div className="native-readout" data-kind="agent" data-zero={agents.staff.length === 0}>
            <dt>Employees</dt><dd>{agents.staff.length}</dd>
          </div>
        </dl>
      </header>
      <div className="native-office-layout">
        <div className="native-office-main" ref={main}>
          {/* The room gives up height while a conversation is open: the chat panel is its sibling
              below, and at the room's full 540px the chat started below the fold. */}
          <section className="native-room" data-compact={Boolean(selectedEmployee || selectedWorker)}
            aria-label={`${building.name} isometric office`}>
            <div className="native-room-toolbar"><span>{loading ? 'Opening office…' : roomWorkers.length ? 'Select a desk · drag to look around · scroll to zoom' : 'Add your first worker · drag to explore the room'}</span>
              {floorCount > 1 && <div><button type="button" disabled={floor === 0} onClick={() => setFloor((current) => current - 1)}>←</button><span>Floor {floor + 1}/{floorCount}</span><button type="button" disabled={floor + 1 === floorCount} onClick={() => setFloor((current) => current + 1)}>→</button></div>}
            </div>
            {/* A WebGL context the driver refuses took the whole page with it: the room threw
                inside its Canvas, nothing above it caught, and the office rendered as a blank
                void — no roster, no rail, no chat. The room is scenery; everything else on this
                page works without it, so it gets a boundary of its own. */}
            <SceneBoundary label="office room" fallback={
              <p role="alert" className="native-room-notice">
                The 3D room could not start (the console has the error). Everything else on this
                page still works — pick anyone from the roster on the right.
              </p>
            }>
              <Suspense fallback={<p role="status" className="native-room-notice">Building your room…</p>}>
                <OfficeRoom3D workers={floorWorkers} accent={accent} selected={selected} onSelect={setSelected} buildingId={buildingId} crew={roster.byId} streams={streams} />
              </Suspense>
            </SceneBoundary>
          </section>
          {/* Fixed height under the room, so opening a desk never pushes the room off screen. */}
          {/* Three kinds of person share this floor, and clicking one has to answer the same
              question for each: what is this one actually doing? A hired employee answers with
              their conversation, a live CLI with its own transcript, a desk with the plain fact
              that it keeps none. */}
          {selectedEmployee
            ? <section className="native-selected-worker" data-kind="employee" aria-label={`Chat with ${selectedEmployee.name}`}>
              {/* Only an engineer may hire: a lead that could hire its own helper would be
                  implementing through the back door, and an intern that could hire would leave
                  the office with no bottom. The backend enforces it; this hides the control so
                  the rule is visible before it is hit. */}
              {selectedEmployee.roleKind === 'build' && (
                <HireIntern
                  key={selectedEmployee.sessionId}
                  projectId={projectId}
                  buildingId={buildingId}
                  engineer={selectedEmployee}
                  onHired={agents.reload}
                />
              )}
              <EmployeeChat
                key={selectedEmployee.sessionId}
                sessionId={selectedEmployee.sessionId}
                name={selectedEmployee.name}
                role={selectedEmployee.title}
                readOnly={selectedEmployee.roleKind === 'intern'
                  ? `${selectedEmployee.name} is an intern and answers to ${
                      agents.staff.find((person) => person.sessionId === selectedEmployee.managerId)?.name
                      ?? 'the engineer who hired them'
                    }, not to you. Brief that engineer instead — what they hand down is theirs to decide.`
                  : undefined}
                detail={[
                  `${selectedEmployee.team} team`,
                  streams.find((stream) => stream.id === selectedEmployee.officeProjectId)?.name ?? 'no work stream',
                  selectedEmployee.activeTasks
                    ? `${selectedEmployee.activeTasks} in flight`
                    : `${selectedEmployee.totalTasks} ${selectedEmployee.totalTasks === 1 ? 'turn' : 'turns'} so far`,
                ].join(' · ')}
              />
            </section>
            : selectedWorker
            ? <section className="native-selected-worker" data-kind="desk" aria-label="Selected worker">
              {/* Identity and actions on one line, then the terminal underneath at full width.
                  They used to sit side by side and vertically centred, which squeezed the CRT
                  into half the panel and cut its own heading off the top. */}
              <header className="native-desk-head">
                <strong>{selectedWorker.name}{live && <span className="native-live-badge">live</span>}</strong>
                <p>{RUNTIME_NAMES[selectedWorker.runtime]}{selectedMember?.detail ? ` · ${selectedMember.detail}` : selectedWorker.workspace ? ` · ${selectedWorker.workspace}` : ''}</p>
                <span className="native-desk-actions">
                  {live
                    ? <span className="native-crew-note">Open on your machine{selectedMember?.pid ? ` · pid ${selectedMember.pid}` : ''} — close that terminal to clear the desk.</span>
                    : <>
                      <button type="button" className="native-open-worker" disabled={opening} title="Open a fresh window in the native app" onClick={() => void openAgain()}><Monitor size={16} strokeWidth={2.5} />{opening ? 'Opening…' : 'Open another window'}</button>
                      <button type="button" className="native-remove-worker" disabled={removing !== null} onClick={() => void removeWorker(selectedWorker.id)}><Trash2 size={16} strokeWidth={2.5} />Remove desk</button>
                    </>}
                </span>
              </header>
              {/* This panel was read-only, with no reason given, which is why it read as broken.
                  A Claude terminal keeps a session the CLI can continue, so a desk can be
                  answered; a window with no transcript still cannot, and says so. */}
              <p className="native-desk-why">
                {live
                  ? `A message below continues this terminal's own session — same history, same folder — so ${selectedWorker.name} answers in the transcript here. The window on your machine stays as it is.`
                  : <>
                    Ghost Grid opened this window but keeps no transcript for it, so there is nothing
                    to read and nowhere to send a message.{' '}
                    <button type="button" className="native-desk-link" onClick={() => setTab('org')}>
                      Hire an employee
                    </button>
                    {' to send work from here instead.'}
                  </>}
              </p>
              {live && selectedMember?.pid
                ? <CrewTerminal key={selectedMember.pid} pid={selectedMember.pid} fallbackName={selectedWorker.name} onSubagents={takeSubagents} />
                : <DeskState key={selectedWorker.id} worker={selectedWorker} />}
            </section>
            : <footer className="native-room-footer"><span>Coffee is on the house</span><span>Click anyone on the floor to see what they are doing</span></footer>}
        </div>

        <aside className="native-rail native-hiring" aria-label="Office controls">
          <nav className="native-rail-tabs" aria-label="Office sections">
            {TABS.map((entry) => (
              <button key={entry.id} type="button" title={entry.hint} aria-pressed={tab === entry.id}
                onClick={() => setTab(entry.id)}>{entry.label}</button>
            ))}
          </nav>
          <div className="native-rail-body">
            {/* The roster, stated once for the whole page. Selecting here selects the desk in
                the room, which is the other way the same people are drawn. */}
            {tab === 'roster' && (
              <section className="native-roster" aria-label="Roster">
                <header className="gg-roles-head"><div><h2>In this office</h2>
                  <p>Live terminals first: they are the work actually happening. Pick anyone to see what they are doing.</p></div></header>
                {roster.all.length ? (
                  <ul className="native-roster-list">
                    {roster.all.map((member) => (
                      <li key={member.id}>
                        <button type="button" aria-pressed={selected === member.id}
                          onClick={() => setSelected(selected === member.id ? null : member.id)}>
                          {/* The kind of person, as a colour, in a column of its own: the left
                              edge of this list reads top to bottom as what the office is made
                              of before a single name is read. */}
                          <span className="native-roster-pip" data-source={member.source} aria-hidden="true" />
                          <span className="gg-role" data-role={member.role} data-source={member.source}>{shortRole(member.role)}</span>
                          <b>{member.name}</b>
                          <em>{member.detail}</em>
                          {/* Which of these can be sent a message, said at the point of choosing
                              one: only a backend employee has somewhere for it to go. */}
                          <span className="native-roster-source" data-source={member.source} title={member.source === 'agent'
                            ? 'A backend employee — open them to send a message'
                            : 'A terminal window — Ghost Grid can read it, not type into it'}>
                            {member.source === 'live' ? 'live' : member.source === 'desk' ? 'desk' : 'backend'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="gg-roles-empty">{scan.error ? scan.error
                    : !scan.supported ? 'Desk detection needs a Linux machine. Open the Hire tab to add a worker.'
                    : `No ${scan.runtime ?? 'coding'} terminal open right now. Start one and it takes a desk here.`}</p>
                )}
                <nav aria-label="Other offices"><Link to={building.type === 'claude' ? '/office/codex' : '/office/claude'}>Visit the {building.type === 'claude' ? 'Codex' : 'Claude'} office →</Link></nav>
              </section>
            )}
            {tab === 'hire' && (
              <section className="native-hire" aria-label="Hire a worker">
                <header className="gg-roles-head"><div><h2>Hire a CLI</h2>
                  <p>Pick a coding CLI and the folder it works in. Ghost Grid opens a fresh window for it on this machine.</p></div></header>
                <form onSubmit={(event) => void addWorker(event)}>
                  <label htmlFor="worker-name">Worker name</label><input id="worker-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={`Worker ${desks.length + 1}`} />
                  <fieldset><legend>Where they work</legend>
                    {(Object.keys(RUNTIME_NAMES) as OfficeRuntime[]).map((id) => <label key={id} className="native-runtime" data-selected={runtime === id}><input type="radio" name="office-runtime" value={id} checked={runtime === id} onChange={() => setRuntime(id)} /><Monitor size={16} strokeWidth={2.5} /><span>{RUNTIME_NAMES[id]}</span>{scan.runtime === id && scan.crew.length > 0 && <em>{scan.crew.length} live</em>}</label>)}
                  </fieldset>
                  {terminal && <><label htmlFor="worker-workspace">Project folder</label><input id="worker-workspace" list="office-workspaces" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/path/to/your/project" required /><datalist id="office-workspaces">{options?.workspaces.map((path) => <option key={path} value={path} />)}</datalist><p className="native-form-hint">Use a folder allowed by your Ghost Grid backend.</p></>}
                  {!loading && options && !supported && <p className="native-setup-message">{terminal ? `Install ${runtime} and a terminal app on the Ghost Grid machine, then start the backend in a desktop session.` : 'Start the backend in a desktop session with a browser installed.'}</p>}
                  {terminal && options && options.workspaces.length === 0 && <p className="native-setup-message">Set GHOSTGRID_ALLOWED_WORKSPACES in the backend .env and restart it to enable coding workers.</p>}
                  <button className="native-add-worker" type="submit" disabled={loading || adding || !supported || (terminal && !workspace.trim())}><Plus size={16} strokeWidth={2.5} />{adding ? 'Opening their window…' : 'Open their window'}</button>
                </form>
                <p className="native-form-hint">Windows open on the machine running Ghost Grid, and you sign in inside the app. Desks stay saved; removing one leaves its window open. “Open another window” starts a fresh session — continue an existing chat in the window it already has.</p>
              </section>
            )}
            {tab === 'org' && <>
              <OrgEditor projectId={projectId} agentId={agentId} buildingId={buildingId} staff={agents.staff}
                streams={streams} selected={selected} onSelect={setSelected} onChanged={agents.reload} />
              <OrgChart buildingName={building.name} roster={roster} selected={selected} onSelect={setSelected} />
            </>}
            {tab === 'roles' && <RolesDeck projectId={projectId} onRolesChanged={agents.reload} />}
            {tab === 'runs' && (projectId && agentId
              ? <Orchestrator projectId={projectId} agentId={agentId} buildingId={buildingId} buildingName={building.name} />
              : <p className="gg-roles-empty">{projectId
                ? 'This building has no backend agent, so the orchestrator has nobody to run as.'
                : 'Start the Ghost Grid backend to run work through this office.'}</p>)}
            {tab === 'skills' && (skillRuntime
              ? <SkillsDeck runtime={skillRuntime} model={CATALOG[building.type].short}
                crew={roster.all} selected={selected} onSelect={setSelected} />
              : <p className="gg-roles-empty">This office has no CLI of its own to equip.</p>)}
          </div>
          {error && <p role="alert" className="native-office-error">{error}</p>}
        </aside>
      </div>
      {/* The staffing board is its own surface under the office, not a panel in the rail: it is
          the width of the floor it describes, and it stays put while the rail changes tabs. */}
      <section className="native-office-staffing" aria-label="Staffing board">
        <ProjectBoard crew={roster.all} streams={streams} selected={selected} onSelect={setSelected}
          projectId={projectId} buildingId={buildingId} />
      </section>
    </main>
  )
}

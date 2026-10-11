import { lazy, Suspense, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Monitor, Plus, Trash2 } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { backend, type OfficeRuntime, type OfficeWorker } from '@/api/backend'
import { backendStatus } from '@/api/config'
import { bootstrap } from '@/api/live'
import { CATALOG } from '@/constants'
import { useGrid } from '@/store/grid'
import './native-office.css'
import { DESK_COMMANDS } from './deskCommands'
import { OrgChart } from './OrgChart'
const OfficeRoom3D = lazy(() => import('./OfficeRoom3D').then((module) => ({ default: module.OfficeRoom3D })))

const RUNTIME_NAMES: Record<OfficeRuntime, string> = {
  codex: 'Codex terminal', claude: 'Claude terminal',
  'chatgpt-browser': 'ChatGPT browser', 'claude-browser': 'Claude browser',
}

function DeskActivity({ worker }: { worker: OfficeWorker }) {
  const [step, setStep] = useState(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) return
    const timer = setInterval(() => setStep((current) => (current + 1) % 6), 1800)
    return () => clearInterval(timer)
  }, [reduce])
  return <p className="native-desk-activity">Desk animation: <span>{DESK_COMMANDS[worker.runtime][step]}</span></p>
}

export function OfficePage() {
  const { buildingId = '' } = useParams()
  const building = useGrid((state) => state.buildings[buildingId])
  const [workers, setWorkers] = useState<OfficeWorker[]>([])
  const [options, setOptions] = useState<Awaited<ReturnType<typeof backend.officeOptions>> | null>(null)
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<OfficeRuntime>(building?.type === 'claude' ? 'claude' : 'codex')
  const [workspace, setWorkspace] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [floor, setFloor] = useState(0)
  const valid = building?.type === 'codex' || building?.type === 'claude'

  useEffect(() => {
    if (!valid) { setLoading(false); return }
    let active = true
    setLoading(true)
    setError('')
    setWorkers([])
    setOptions(null)
    setRuntime(building.type === 'claude' ? 'claude' : 'codex')
    void (async () => {
      try {
        const status = await backendStatus()
        if (!status.live) throw new Error('Start the Ghost Grid backend to open real workers. Run ./dev.sh from the hackathon folder.')
        const [{ projectId: id }, available] = await Promise.all([bootstrap(), backend.officeOptions()])
        const saved = await backend.officeWorkers(id, buildingId)
        if (!active) return
        setProjectId(id)
        setOptions(available)
        setWorkspace(available.workspaces[0] ?? '')
        setWorkers(saved.items)
      } catch (reason) {
        if (active) setError(reason instanceof Error && /route not found/i.test(reason.message)
          ? 'Your backend is running an older version. Restart it with ./dev.sh backend to load the office controls.'
          : reason instanceof Error ? reason.message : 'Could not load the office. Try again after starting the backend.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [buildingId, valid, building?.type])

  const terminal = runtime === 'codex' || runtime === 'claude'
  const supported = options?.runtimes.includes(runtime) ?? false
  const addWorker = async (event: FormEvent) => {
    event.preventDefault()
    if (adding || !supported || !projectId) return
    setAdding(true)
    setError('')
    try {
      const worker = await backend.createOfficeWorker({ projectId, buildingId,
        name: name.trim() || `Worker ${workers.length + 1}`, runtime,
        workspace: terminal ? workspace.trim() : undefined })
      setWorkers((current) => [...current, worker])
      setSelected(worker.id)
      setFloor(Math.floor(workers.length / 12))
      setName('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The worker could not open. Please try again.') }
    finally { setAdding(false) }
  }

  const removeWorker = async (id: string) => {
    if (removing) return
    setRemoving(id)
    setError('')
    try {
      await backend.removeOfficeWorker(id)
      setWorkers((current) => current.filter((worker) => worker.id !== id))
      setSelected(null)
      setFloor((current) => Math.min(current, Math.max(0, Math.ceil((workers.length - 1) / 12) - 1)))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove this desk.') }
    finally { setRemoving(null) }
  }

  if (!valid) return <main className="native-office"><Link to="/">Return to the city</Link><h1>Office not found</h1></main>
  const accent = CATALOG[building.type].accent
  const selectedWorker = workers.find((worker) => worker.id === selected)
  const floorCount = Math.max(1, Math.ceil(workers.length / 12))
  const floorWorkers = workers.slice(floor * 12, floor * 12 + 12)
  const openAgain = async () => {
    if (!selectedWorker || opening) return
    setOpening(true)
    setError('')
    try { await backend.openOfficeWorker(selectedWorker.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the window.') }
    finally { setOpening(false) }
  }
  return (
    <main className="native-office" style={{ '--office-accent': accent } as CSSProperties}>
      <header className="native-office-header">
        <Link className="native-office-back" to="/"><ArrowLeft size={16} /> Back to city</Link>
        <div><h1>{building.type === 'claude' ? 'Claude’s cozy office' : 'Codex’s cozy office'}</h1>
          <p>A little room for big ideas. Give every worker their own window.</p></div>
        <span className="native-office-count">{workers.length} {workers.length === 1 ? 'worker' : 'workers'}</span>
      </header>
      <div className="native-office-layout">
        <section className="native-room" aria-label={`${building.name} isometric office`}>
          <div className="native-room-toolbar"><span>{loading ? 'Opening office…' : workers.length ? 'Select a desk · drag to look around · scroll to zoom' : 'Add your first worker · drag to explore the room'}</span>
            {floorCount > 1 && <div><button type="button" disabled={floor === 0} onClick={() => setFloor((current) => current - 1)}>←</button><span>Floor {floor + 1}/{floorCount}</span><button type="button" disabled={floor + 1 === floorCount} onClick={() => setFloor((current) => current + 1)}>→</button></div>}
          </div>
          {selectedWorker && <section className="native-selected-worker" aria-label="Selected worker">
            <div><strong>{selectedWorker.name}</strong><p>{RUNTIME_NAMES[selectedWorker.runtime]}{selectedWorker.workspace ? ` · ${selectedWorker.workspace}` : ''}</p><DeskActivity key={selectedWorker.id} worker={selectedWorker} /></div>
            <button type="button" className="native-open-worker" disabled={opening} title="Open a fresh window in the native app" onClick={() => void openAgain()}><Monitor size={16} />{opening ? 'Opening…' : 'Open another window'}</button>
            <button type="button" className="native-remove-worker" disabled={removing !== null} onClick={() => void removeWorker(selectedWorker.id)}><Trash2 size={16} />Remove desk</button>
          </section>}
          <Suspense fallback={<p role="status" className="native-room-notice">Building your room…</p>}><OfficeRoom3D workers={floorWorkers} accent={accent} selected={selected} onSelect={setSelected} buildingId={buildingId} /></Suspense>
          {floorWorkers.length > 0 && <nav className="native-worker-picker" aria-label="Select a worker">{floorWorkers.map((worker) => <button key={worker.id} type="button" aria-pressed={selected === worker.id} onClick={() => setSelected(worker.id)}>{worker.name}</button>)}</nav>}
          <footer className="native-room-footer"><span>COFFEE IS ON THE HOUSE</span><span>ONE WORKER · ONE WINDOW</span></footer>
        </section>
        <aside className="native-hiring">
          <OrgChart buildingId={buildingId} buildingName={building.name} realWorkers={workers} />
          <h2>Add a worker</h2><p>Pick their tools. We’ll open a fresh terminal or browser window for them.</p>
          <form onSubmit={(event) => void addWorker(event)}>
            <label htmlFor="worker-name">Worker name</label><input id="worker-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={`Worker ${workers.length + 1}`} />
            <fieldset><legend>Where they work</legend>
              {(Object.keys(RUNTIME_NAMES) as OfficeRuntime[]).map((id) => <label key={id} className="native-runtime" data-selected={runtime === id}><input type="radio" name="office-runtime" value={id} checked={runtime === id} onChange={() => setRuntime(id)} /><Monitor size={16} /><span>{RUNTIME_NAMES[id]}</span></label>)}
            </fieldset>
            {terminal && <><label htmlFor="worker-workspace">Project folder</label><input id="worker-workspace" list="office-workspaces" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/path/to/your/project" required /><datalist id="office-workspaces">{options?.workspaces.map((path) => <option key={path} value={path} />)}</datalist><p className="native-form-hint">Use a folder allowed by your Ghost Grid backend.</p></>}
            {!loading && options && !supported && <p className="native-setup-message">{terminal ? `Install ${runtime} and a terminal app on the Ghost Grid machine, then start the backend in a desktop session.` : 'Start the backend in a desktop session with a browser installed.'}</p>}
            {terminal && options && options.workspaces.length === 0 && <p className="native-setup-message">Set GHOSTGRID_ALLOWED_WORKSPACES in the backend .env and restart it to enable coding workers.</p>}
            <button className="native-add-worker" type="submit" disabled={loading || adding || !supported || (terminal && !workspace.trim())}><Plus size={16} />{adding ? 'Opening their window…' : 'Add worker & open window'}</button>
          </form>
          {error && <p role="alert" className="native-office-error">{error}</p>}
          <p className="native-form-hint">Windows open on the machine running Ghost Grid. Sign in inside the app. Desks stay saved; removing a desk leaves its window open. “Open another window” starts fresh; continue existing chats in their original window.</p>
          <nav aria-label="Other offices"><Link to={building.type === 'claude' ? '/office/codex' : '/office/claude'}>Visit the {building.type === 'claude' ? 'Codex' : 'Claude'} office →</Link></nav>
        </aside>
      </div>
    </main>
  )
}

// City state machine. All building status changes go through here.
// Flow: runCommand → dispatch (drone router→codex) → working (codex 4s) → approval (security) → done | rejected
// Players can also build new buildings (Codex / Claude / DeepSeek clones, custom bots) on empty lots.
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../api/client'
import { BOT_SEEDS } from '../bots/seeds'
import { CATALOG, DEFAULT_BUILDINGS, RUNTIMES, TIMING } from '../constants'
import { BUILDABLE_LOTS } from '../city3d/world'
import type {
  BotConfig,
  Building,
  BuildingId,
  BuildingStatus,
  BuildingType,
  Flight,
  FlightKind,
  LogEntry,
  LogLevel,
  PlaygroundParams,
  RuntimeId,
  Session,
  Task,
} from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let n = 0
const id = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`

export type PanelMode = 'building' | 'result' | null

export interface BuildMode {
  type: BuildingType
  name?: string
  bot?: BotConfig
}

export interface CityStats {
  approvals: number
  rejections: number
  tokensToday: number
  costToday: number // real USD (mock)
  budgetToday: number
}

interface GridState {
  buildings: Record<BuildingId, Building>
  order: BuildingId[] // render / list order
  logs: LogEntry[]
  task: Task | null
  flights: Flight[]
  selected: BuildingId | null
  panel: PanelMode
  credits: number // game currency (not real money)
  stats: CityStats
  buildMode: BuildMode | null
  office: BuildingId | null // the building whose office interior is open (src/city/office)

  // derived helpers
  isBusy: () => boolean

  // actions
  loadInitialLogs: () => Promise<void>
  runCommand: (command: string) => Promise<void>
  approve: () => Promise<void>
  reject: () => Promise<void>
  selectBuilding: (id: BuildingId | null) => void
  openResult: () => void
  closePanel: () => void
  setStatus: (id: BuildingId, status: BuildingStatus) => void
  pushLog: (id: BuildingId, level: LogLevel, text: string) => void
  launchFlight: (kind: FlightKind, from: BuildingId, to: BuildingId, durationMs: number) => string
  setBuildMode: (mode: BuildMode | null) => void
  placeBuilding: (lot: number) => BuildingId | null // uses buildMode; returns new id or null
  removeBuilding: (id: BuildingId) => void
  updateBot: (id: BuildingId, patch: Partial<BotConfig>) => void
  renameBuilding: (id: BuildingId, name: string) => void
  openOffice: (id: BuildingId) => void
  closeOffice: () => void
  startSession: (id: BuildingId, input: { title: string; runtime: RuntimeId; model: string }) => Promise<void>
  stopSession: (id: BuildingId, sessionId: string) => Promise<void>
  clearSession: (id: BuildingId, sessionId: string) => void
  runPlayground: (
    agentId: BuildingId,
    prompt: string,
    params: PlaygroundParams,
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }>
}

const MIN = 60_000
// Seed desks for each office: a mix of local and connected runtimes so the session menu's
// two modes are both visible on first load.
const seedSessions = (type: BuildingType): Session[] => {
  const now = Date.now()
  if (type === 'codex')
    return [
      { id: 's_cx1', title: 'Refactor drone flight paths', status: 'done', startedAt: now - 42 * MIN, tokens: 18_230, runtime: 'local-cli', model: 'codex-cli', branch: 'feat/arcs' },
      { id: 's_cx2', title: 'Fix failing auth test', status: 'queued', startedAt: now - 3 * MIN, tokens: 0, runtime: 'openai', model: 'gpt-5-codex', branch: 'fix/auth' },
    ]
  if (type === 'claude')
    return [
      { id: 's_cl1', title: 'Review: city state machine', status: 'done', startedAt: now - 25 * MIN, tokens: 31_904, runtime: 'anthropic', model: 'claude-opus-5-5' },
      { id: 's_cl2', title: 'Architecture: plugin bots', status: 'running', startedAt: now - 6 * MIN, tokens: 12_480, runtime: 'local-cli', model: 'claude-code' },
    ]
  if (type === 'deepseek')
    return [
      { id: 's_ds1', title: 'Generate unit tests for mock.ts', status: 'done', startedAt: now - 58 * MIN, tokens: 44_310, runtime: 'deepseek', model: 'deepseek-v4-pro' },
      { id: 's_ds2', title: 'Batch: summarize 120 request logs', status: 'running', startedAt: now - 2 * MIN, tokens: 9_870, runtime: 'local-ollama', model: 'qwen3-coder:30b' },
    ]
  if (type === 'groq')
    return [
      { id: 's_gq1', title: 'Draft 40 commit messages', status: 'done', startedAt: now - 11 * MIN, tokens: 6_120, runtime: 'groq', model: 'openai/gpt-oss-120b' },
      { id: 's_gq2', title: 'Realtime: explain this stack trace', status: 'running', startedAt: now - 1 * MIN, tokens: 2_040, runtime: 'groq', model: 'openai/gpt-oss-20b' },
    ]
  return []
}


// Patch one session of one building in place (no-op when either is gone).
function patchSession(
  set: (fn: (s: GridState) => Partial<GridState>) => void,
  bid: BuildingId,
  sessionId: string,
  patch: Partial<Session>,
) {
  set((s) => {
    const b = s.buildings[bid]
    if (!b) return {}
    return {
      buildings: {
        ...s.buildings,
        [bid]: { ...b, sessions: b.sessions.map((x) => (x.id === sessionId ? { ...x, ...patch } : x)) },
      },
    }
  })
}

function makeBuilding(
  bid: BuildingId,
  type: BuildingType,
  lot: number,
  extra?: { name?: string; short?: string; bot?: BotConfig },
): Building {
  const c = CATALOG[type]
  return {
    id: bid,
    type,
    name: extra?.name || c.label,
    short: extra?.short || (extra?.bot ? extra.name?.slice(0, 10).toUpperCase() || c.short : c.short),
    role: c.role,
    model: c.model,
    status: 'idle',
    lot,
    sessions: seedSessions(type),
    bot: extra?.bot,
    builtAt: Date.now(),
  }
}

// Default buildings first, then one tower per bot in the backend's demo catalog (see bots/seeds.ts).
// Catalog towers are ordinary player-grade buildings: they can be renamed, reconfigured and demolished.
const initialBuildings = Object.fromEntries([
  ...DEFAULT_BUILDINGS.map((b) => [b.id, makeBuilding(b.id, b.type, b.lot)] as const),
  ...BOT_SEEDS.map((s) => [s.id, makeBuilding(s.id, 'bot', s.lot, { name: s.name, short: s.short, bot: s.bot })] as const),
]) as Record<BuildingId, Building>

export const useGrid = create<GridState>()((set, get) => ({
  buildings: initialBuildings,
  order: [...DEFAULT_BUILDINGS.map((b) => b.id), ...BOT_SEEDS.map((s) => s.id)],
  logs: [],
  task: null,
  flights: [],
  selected: null,
  panel: null,
  credits: 1280,
  stats: { approvals: 23, rejections: 1, tokensToday: 182_400, costToday: 0.42, budgetToday: 5 },
  buildMode: null,
  office: null,

  isBusy: () => {
    const p = get().task?.phase
    return p === 'dispatch' || p === 'working' || p === 'approval'
  },

  loadInitialLogs: async () => {
    const all = await Promise.all(get().order.filter((b) => get().buildings[b].type !== 'router').map((b) => api.getLogs(b, 5)))
    set({ logs: all.flat().sort((a, b) => a.ts - b.ts) })
  },

  setStatus: (b, status) =>
    set((s) => (s.buildings[b] ? { buildings: { ...s.buildings, [b]: { ...s.buildings[b], status } } } : s)),

  pushLog: (b, level, text) =>
    set((s) => ({ logs: [...s.logs, { id: id('log'), ts: Date.now(), buildingId: b, level, text }].slice(-300) })),

  launchFlight: (kind, from, to, durationMs) => {
    const fid = id('flight')
    set((s) => ({ flights: [...s.flights, { id: fid, kind, from, to, durationMs, startedAt: Date.now() }] }))
    setTimeout(() => set((s) => ({ flights: s.flights.filter((f) => f.id !== fid) })), durationMs + 600) // hover at the dock briefly
    return fid
  },

  runCommand: async (command) => {
    const { isBusy, setStatus, pushLog, launchFlight } = get()
    if (isBusy() || !command.trim()) return
    get().order.forEach((b) => get().buildings[b].status !== 'idle' && setStatus(b, 'idle'))
    set({ task: { id: 'pending', command, phase: 'dispatch', createdAt: Date.now() } })

    // 1) Router receives and dispatches a drone to Codex
    setStatus('router', 'working')
    pushLog('router', 'info', `received: "${command}"`)
    const { taskId, plan } = await api.submitCommand(command)
    plan.forEach((p) => pushLog('router', 'info', p))
    const sessionId = id('s')
    set((s) => ({
      task: s.task && { ...s.task, id: taskId },
      buildings: {
        ...s.buildings,
        codex: {
          ...s.buildings.codex,
          sessions: [
            { id: sessionId, title: command.slice(0, 48), status: 'running' as const, startedAt: Date.now(), tokens: 0, runtime: 'openai' as const, model: s.buildings.codex.model, branch: `task/${taskId.slice(-5)}` },
            ...s.buildings.codex.sessions,
          ].slice(0, 6),
        },
      },
    }))
    launchFlight('drone', 'router', 'codex', TIMING.droneFlight)
    pushLog('router', 'ok', 'drone dispatched → codex')
    await sleep(TIMING.droneFlight)

    // 2) Codex works for 4s
    setStatus('router', 'idle')
    setStatus('codex', 'working')
    set((s) => ({ task: s.task && { ...s.task, phase: 'working' } }))
    const steps = ['reading repo (142 files)', 'patching src/App.tsx (+12 −3)', 'npm run build', 'needs: rm -rf /tmp/build']
    for (const step of steps) {
      pushLog('codex', step.startsWith('needs') ? 'warn' : 'info', step)
      await sleep(TIMING.codexWork / steps.length)
    }

    // 3) Security asks a human
    setStatus('codex', 'idle')
    launchFlight('packet', 'codex', 'security', TIMING.packetFlight)
    await sleep(TIMING.packetFlight)
    setStatus('security', 'needs_approval')
    pushLog('security', 'warn', 'approval required: rm -rf /tmp/build')
    set((s) => ({
      task: s.task && {
        ...s.task,
        phase: 'approval',
        approval: {
          buildingId: 'security',
          requester: 'codex',
          action: 'rm -rf /tmp/build',
          message: 'Codex wants to delete /tmp/build. Approve?',
        },
      },
    }))
  },

  approve: async () => {
    const { task, setStatus, pushLog, launchFlight } = get()
    if (task?.phase !== 'approval') return
    setStatus('security', 'idle')
    pushLog('security', 'ok', 'approved by human: rm -rf /tmp/build')
    set((s) => ({ task: { ...task, phase: 'working' }, stats: { ...s.stats, approvals: s.stats.approvals + 1 } }))
    const result = await api.approve(task.id)
    pushLog('codex', 'ok', 'deleted /tmp/build · rebuilt · 24/24 tests passed')
    launchFlight('drone-cargo', 'codex', 'router', TIMING.returnFlight)
    await sleep(TIMING.returnFlight)
    pushLog('router', 'ok', `task ${task.id} merged · ${result.tokens.toLocaleString()} tokens`)
    set((s) => ({
      task: { ...task, phase: 'done', result },
      panel: 'result',
      selected: null,
      credits: s.credits + 120,
      stats: { ...s.stats, tokensToday: s.stats.tokensToday + result.tokens, costToday: +(s.stats.costToday + result.costUsd).toFixed(4) },
      buildings: {
        ...s.buildings,
        codex: {
          ...s.buildings.codex,
          sessions: s.buildings.codex.sessions.map((x, i): Session => (i === 0 && x.status === 'running' ? { ...x, status: 'done', tokens: result.tokens } : x)),
        },
      },
    }))
  },

  reject: async () => {
    const { task, setStatus, pushLog, launchFlight } = get()
    if (task?.phase !== 'approval') return
    setStatus('security', 'error')
    pushLog('security', 'error', 'rejected by human: rm -rf /tmp/build')
    pushLog('codex', 'error', 'aborted: delete was denied')
    set((s) => ({
      task: { ...task, phase: 'rejected' },
      stats: { ...s.stats, rejections: s.stats.rejections + 1 },
      buildings: {
        ...s.buildings,
        codex: {
          ...s.buildings.codex,
          sessions: s.buildings.codex.sessions.map((x, i): Session => (i === 0 && x.status === 'running' ? { ...x, status: 'error' } : x)),
        },
      },
    }))
    launchFlight('drone', 'codex', 'router', TIMING.returnFlight)
    await api.reject(task.id)
  },

  selectBuilding: (b) => { if (b && get().buildings[b]?.type === 'router') return; set({ selected: b, panel: b ? 'building' : null }) },
  openResult: () => set({ panel: 'result', selected: null }),
  closePanel: () => set({ panel: null, selected: null }),

  setBuildMode: (mode) => set({ buildMode: mode }),

  placeBuilding: (lot) => {
    const { buildMode, buildings, credits, pushLog } = get()
    if (!buildMode || !BUILDABLE_LOTS.includes(lot)) return null
    if (Object.values(buildings).some((b) => b.lot === lot)) return null
    const cost = CATALOG[buildMode.type].cost
    if (credits < cost) return null
    const bid = id('b')
    const b = makeBuilding(bid, buildMode.type, lot, { name: buildMode.name, bot: buildMode.bot })
    set((s) => ({
      buildings: { ...s.buildings, [bid]: b },
      order: [...s.order, bid],
      credits: s.credits - cost,
      buildMode: null,
      selected: bid,
      panel: 'building',
    }))
    pushLog(bid, 'ok', `built on lot ${lot} · −${cost} BP`)
    if (b.bot) pushLog(bid, 'info', `endpoint: ${b.bot.endpoint || '(not set)'} · waiting for backend`)
    return bid
  },

  removeBuilding: (bid) => {
    if (DEFAULT_BUILDINGS.some((d) => d.id === bid)) return
    set((s) => {
      const rest = { ...s.buildings }
      const refund = Math.floor(CATALOG[rest[bid]?.type ?? 'bot'].cost / 2)
      delete rest[bid]
      return {
        buildings: rest,
        order: s.order.filter((x) => x !== bid),
        selected: s.selected === bid ? null : s.selected,
        panel: s.selected === bid ? null : s.panel,
        credits: s.credits + refund,
      }
    })
  },

  updateBot: (bid, patch) =>
    set((s) => {
      const b = s.buildings[bid]
      if (!b?.bot) return s
      return { buildings: { ...s.buildings, [bid]: { ...b, bot: { ...b.bot, ...patch } } } }
    }),

  renameBuilding: (bid, name) =>
    set((s) => (s.buildings[bid] ? { buildings: { ...s.buildings, [bid]: { ...s.buildings[bid], name } } } : s)),

  openOffice: (bid) => set((s) => (s.buildings[bid] && s.buildings[bid].type !== 'router' ? { office: bid } : s)),
  closeOffice: () => set({ office: null }),

  // Start one desk in a building's office. The runtime decides where the work happens:
  // a 'local' runtime runs on this machine, a 'connected' one calls the provider's API.
  // Demo arc: queued → running → done, with log lines that match the chosen runtime.
  startSession: async (bid, input) => {
    const { buildings, pushLog, setStatus } = get()
    const building = buildings[bid]
    if (!building) return
    const rt = RUNTIMES[input.runtime]
    const title = input.title.trim() || 'Untitled session'
    const sid = id('s')

    set((s) => {
      const b = s.buildings[bid]
      if (!b) return s
      const session: Session = {
        id: sid,
        title: title.slice(0, 64),
        status: 'queued',
        startedAt: Date.now(),
        tokens: 0,
        runtime: input.runtime,
        model: input.model,
      }
      return { buildings: { ...s.buildings, [bid]: { ...b, sessions: [session, ...b.sessions].slice(0, 8) } } }
    })
    pushLog(bid, 'info', `session queued: "${title.slice(0, 40)}" · ${rt.short} · ${input.model}`)

    try {
      const res = await api.startSession(bid, { title, runtime: input.runtime, mode: rt.mode, model: input.model })
      await sleep(TIMING.sessionQueue)
      patchSession(set, bid, sid, { status: 'running' })
      if (get().buildings[bid]?.status === 'idle') setStatus(bid, 'working')
      pushLog(
        bid,
        'ok',
        rt.mode === 'local'
          ? `running locally on ${res.host} · no key left this machine`
          : `connected to ${res.host} · streaming`,
      )

      // The session works for a while, then reports back. Tokens scale with the runtime:
      // local models are free but slower, hosted ones bill what they stream.
      await sleep(TIMING.sessionWork)
      if (!get().buildings[bid]?.sessions.some((x) => x.id === sid)) return // stopped or demolished
      const tokens = rt.mode === 'local' ? 2_400 + Math.floor(Math.random() * 3_000) : 6_000 + Math.floor(Math.random() * 9_000)
      patchSession(set, bid, sid, { status: 'done', tokens })
      set((s) => ({ stats: { ...s.stats, tokensToday: s.stats.tokensToday + tokens } }))
      pushLog(bid, 'ok', `session done · ${tokens.toLocaleString()} tokens · ${rt.short}`)
    } catch (e) {
      patchSession(set, bid, sid, { status: 'error' })
      pushLog(bid, 'error', `session failed: ${String(e)}`)
    } finally {
      // Only hand the building back to idle if nothing else is still running in it.
      const b = get().buildings[bid]
      if (b?.status === 'working' && !b.sessions.some((x) => x.status === 'running') && !get().isBusy()) setStatus(bid, 'idle')
    }
  },

  stopSession: async (bid, sessionId) => {
    const { buildings, pushLog, setStatus } = get()
    const session = buildings[bid]?.sessions.find((x) => x.id === sessionId)
    if (!session || session.status === 'done') return
    patchSession(set, bid, sessionId, { status: 'error' })
    pushLog(bid, 'warn', `session stopped: "${session.title.slice(0, 40)}"`)
    const b = get().buildings[bid]
    if (b?.status === 'working' && !b.sessions.some((x) => x.status === 'running') && !get().isBusy()) setStatus(bid, 'idle')
    await api.stopSession(bid, sessionId)
  },

  clearSession: (bid, sessionId) =>
    set((s) => {
      const b = s.buildings[bid]
      if (!b) return s
      return { buildings: { ...s.buildings, [bid]: { ...b, sessions: b.sessions.filter((x) => x.id !== sessionId) } } }
    }),

  runPlayground: async (agentId, prompt, params, onToken, signal) => {
    const { setStatus, pushLog } = get()
    setStatus(agentId, 'working')
    pushLog(agentId, 'info', `playground: "${prompt.slice(0, 60)}"`)
    try {
      const res = await api.runPlayground(agentId, prompt, params, onToken, signal)
      pushLog(agentId, 'ok', `playground reply · ${res.tokensOut} tokens · ${res.latencyMs}ms`)
      return res
    } catch (e) {
      setStatus(agentId, 'error')
      pushLog(agentId, 'error', `playground failed: ${String(e)}`)
      throw e
    } finally {
      if (get().buildings[agentId]?.status === 'working') setStatus(agentId, 'idle')
    }
  },
}))

// Last n logs for one building, oldest first. useShallow avoids a new-array re-render loop.
export const useBuildingLogs = (b: BuildingId, count = 5) =>
  useGrid(useShallow((s) => s.logs.filter((l) => l.buildingId === b).slice(-count)))

// Ordered list of all buildings (stable reference while nothing changes).
export const useBuildingList = () => useGrid(useShallow((s) => s.order.map((bid) => s.buildings[bid])))

// Lots that already have a building.
export const useAgentBuildingList = () => useGrid(useShallow((s) => s.order.map((bid) => s.buildings[bid]).filter((b) => b.type !== 'router')))

export const useOccupiedLots = () => useGrid(useShallow((s) => s.order.map((bid) => s.buildings[bid].lot)))

// Dev hook for browser checks: window.__gg.getState().setStatus('codex', 'error')
if (import.meta.env.DEV) (window as unknown as { __gg: typeof useGrid }).__gg = useGrid

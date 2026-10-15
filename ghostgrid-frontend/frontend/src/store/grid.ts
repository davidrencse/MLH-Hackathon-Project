// City state machine. All building status changes go through here.
// Players can also build new buildings (Codex / Claude / DeepSeek clones, custom bots) on empty lots.
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../api/client'
import { fetchWallStreet, type WallStreetPayload } from '../api/wallstreet'
import { WALL_STREET_SEEDS, staticRepo } from '../wallstreet/roster'
import { CATALOG, DEFAULT_BUILDINGS } from '../constants'
import { isLotLeasable } from '../city3d/world'
import { openPlots } from './plots'
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
  QuantRepo,
} from '../types'

let n = 0
const id = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`

export type PanelMode = 'building' | null

export interface BuildMode {
  type: BuildingType
  name?: string
  bot?: BotConfig
}

interface GridState {
  buildings: Record<BuildingId, Building>
  order: BuildingId[] // render / list order
  logs: LogEntry[]
  flights: Flight[]
  selected: BuildingId | null
  panel: PanelMode
  credits: number // game currency (not real money)
  buildMode: BuildMode | null
  office: BuildingId | null // the building whose office interior is open (src/city/office)


  // actions
  loadInitialLogs: () => Promise<void>
  /** Refreshes the Wall Street towers from GET /api/v1/wallstreet (never throws). */
  loadWallStreet: (options?: { refresh?: boolean }) => Promise<void>
  wallStreetStatus: { source: WallStreetPayload['source']; updatedAt: string | null; loading: boolean }
  selectBuilding: (id: BuildingId | null) => void
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
  /** Replace a building's desk list with the sessions its backend agent actually has. */
  loadSessions: (id: BuildingId) => Promise<void>
  clearSession: (id: BuildingId, sessionId: string) => void
  runPlayground: (
    agentId: BuildingId,
    prompt: string,
    params: PlaygroundParams,
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }>
}

// Desks start empty and are filled from the backend by `loadSessions`. They used to be seeded
// with two invented sessions per office type — "Refactor drone flight paths · 18,230 tokens" on
// a building that had never run anything — which sat in the same list as real ones.


function makeBuilding(
  bid: BuildingId,
  type: BuildingType,
  lot: number,
  extra?: { name?: string; short?: string; role?: string; bot?: BotConfig; repo?: QuantRepo },
): Building {
  const c = CATALOG[type]
  return {
    id: bid,
    type,
    name: extra?.name || c.label,
    short: extra?.short || (extra?.bot ? extra.name?.slice(0, 10).toUpperCase() || c.short : c.short),
    role: extra?.role || c.role,
    model: c.model,
    status: 'idle',
    lot,
    sessions: [],
    bot: extra?.bot,
    repo: extra?.repo,
    builtAt: Date.now(),
  }
}

// Wall Street: one tower per open-source quant project. Seeded from the vendored roster so the
// district stands with no backend; `loadWallStreet` then fills in the live GitHub metadata.
const wallStreetId = (slug: string) => `ws_${slug}`
const WALL_STREET_BUILDINGS = WALL_STREET_SEEDS.map(
  (seed) =>
    [
      wallStreetId(seed.slug),
      makeBuilding(wallStreetId(seed.slug), 'quant', seed.lot, {
        name: seed.name,
        short: seed.short,
        repo: staticRepo(seed),
      }),
    ] as const,
)

// The demo catalog's bot towers and the seeded Agent Row houses used to be added here. Neither
// ran anything — `/api/v1/bots` does not exist and a personal agent's endpoint was always empty
// — so the city opened full of buildings nobody had built. Both are gone; the build menu still
// offers the 'bot' and 'agent' types for buildings you place yourself.
const initialBuildings = Object.fromEntries([
  ...DEFAULT_BUILDINGS.map((b) => [b.id, makeBuilding(b.id, b.type, b.lot)] as const),
  ...WALL_STREET_BUILDINGS,
]) as Record<BuildingId, Building>

export const useGrid = create<GridState>()((set, get) => ({
  buildings: initialBuildings,
  order: [
    ...DEFAULT_BUILDINGS.map((b) => b.id),
    ...WALL_STREET_BUILDINGS.map(([bid]) => bid),
  ],
  logs: [],
  flights: [],
  selected: null,
  panel: null,
  credits: 1280,
  buildMode: null,
  office: null,

  // Called with `void` from four screens, so it must settle on its own. A backend that
  // cannot answer leaves the ticker empty — the connection badge is what reports why — and
  // never an invented history.
  loadInitialLogs: async () => {
    try {
      const all = await Promise.all(get().order.map((b) => api.getLogs(b, 5)))
      set({ logs: all.flat().sort((a, b) => a.ts - b.ts) })
    } catch (error) {
      console.warn('[ghostgrid] initial logs unavailable:', error)
    }
  },

  wallStreetStatus: { source: 'offline', updatedAt: null, loading: false },

  loadWallStreet: async (options = {}) => {
    set((s) => ({ wallStreetStatus: { ...s.wallStreetStatus, loading: true } }))
    const payload = await fetchWallStreet(options)
    set((s) => {
      const buildings = { ...s.buildings }
      for (const repo of payload.buildings) {
        const bid = wallStreetId(repo.slug)
        const current = buildings[bid]
        // The player can rename a tower; keep their name, replace the repository data.
        if (current) buildings[bid] = { ...current, repo }
        else buildings[bid] = makeBuilding(bid, 'quant', repo.lot, { name: repo.name, short: repo.short, repo })
      }
      const order = s.order.includes(wallStreetId(payload.buildings[0]!.slug))
        ? s.order
        : [...s.order, ...payload.buildings.map((r) => wallStreetId(r.slug))]
      return {
        buildings,
        order,
        wallStreetStatus: { source: payload.source, updatedAt: payload.updatedAt, loading: false },
      }
    })
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

  selectBuilding: (b) => set({ selected: b, panel: b ? 'building' : null }),
  closePanel: () => set({ panel: null, selected: null }),

  setBuildMode: (mode) => set({ buildMode: mode }),

  placeBuilding: (lot) => {
    const { buildMode, buildings, credits, pushLog } = get()
    // Outer-plot lots only count once their plate is open (store/plots.ts).
    if (!buildMode || !isLotLeasable(lot, openPlots())) return null
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
    // Wall Street towers are district layout: their lots are not leasable, so a demolished one
    // could never be rebuilt.
    if (get().buildings[bid]?.type === 'quant' || get().buildings[bid]?.type === 'agent') return
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

  openOffice: (bid) => set((s) => (s.buildings[bid] ? { office: bid } : s)),
  closeOffice: () => set({ office: null }),

  // Start one desk in a building's office. The runtime decides where the work happens:
  // a 'local' runtime runs on this machine, a 'connected' one calls the provider's API.
  // Demo arc: queued → running → done, with log lines that match the chosen runtime.
  loadSessions: async (bid) => {
    // One read of what the backend has. No local session is ever invented, so a building with
    // no backend agent — or with the backend down — shows an empty desk list.
    const sessions = await api.listSessions(bid)
    set((s) => {
      const b = s.buildings[bid]
      if (!b) return {}
      return { buildings: { ...s.buildings, [bid]: { ...b, sessions } } }
    })
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
export const useBuildingList = () =>
  // `order` is a second, hand-maintained list of which buildings exist, written in four
  // separate places. When it skews from `buildings` this selector materialises `undefined`
  // while claiming `Building[]`, and its consumers deref it inside the Canvas. Keep it total.
  useGrid(useShallow((s) => s.order.map((bid) => s.buildings[bid]).filter((b): b is Building => b !== undefined)))


export const useOccupiedLots = () =>
  useGrid(useShallow((s) => s.order.map((bid) => s.buildings[bid]?.lot).filter((lot): lot is number => lot !== undefined)))

// Dev hook for browser checks: window.__gg.getState().setStatus('codex', 'error')
if (import.meta.env.DEV) (window as unknown as { __gg: typeof useGrid }).__gg = useGrid

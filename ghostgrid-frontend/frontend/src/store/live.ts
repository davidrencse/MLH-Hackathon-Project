// Bridges the backend's durable event stream into the city.
//
// Backend events (tasks, agent output, tool calls, library imports) become the
// building log tickers and building status lights, so the city reacts to real work
// — including work started outside the browser (CLI, another tab, a workflow).
//
// Imported once from main.tsx; it is a no-op when the backend is unreachable.
import { backendStatus, type BackendStatus } from '../api/config'
import { subscribeEvents, tailEventCursor, type BackendEvent } from '../api/backend'
import { bootstrap } from '../api/live'
import { describeEvent } from '../api/liveOps'
import type { BuildingId, BuildingStatus } from '../types'
import { useGrid } from './grid'
import { useCreditsStore } from './credits'

// ---------- backend status, for the connection badge ----------

let statusListeners: ((status: BackendStatus) => void)[] = []
let currentStatus: BackendStatus = { live: false, message: 'probing' }

export function getBackendStatus(): BackendStatus {
  return currentStatus
}

export function onBackendStatus(listener: (status: BackendStatus) => void): () => void {
  statusListeners.push(listener)
  listener(currentStatus)
  return () => {
    statusListeners = statusListeners.filter((candidate) => candidate !== listener)
  }
}

function setStatus(status: BackendStatus) {
  currentStatus = status
  for (const listener of statusListeners) listener(status)
}

// ---------- event → city ----------

/** Status a building should show after this event. `null` leaves it unchanged. */
function statusFromEvent(type: string): BuildingStatus | null {
  if (type === 'task.started' || type === 'agent.output' || type === 'agent.tool.started') return 'working'
  if (type === 'task.failed') return 'error'
  if (type === 'agent.approval.required') return 'needs_approval'
  if (type === 'task.completed' || type === 'task.cancelled') return 'idle'
  return null
}

let agentToBuilding = new Map<string, BuildingId>()
let refreshing: Promise<void> | null = null

async function refreshAgentMap() {
  refreshing ??= bootstrap()
    .then(({ agentToBuilding: map }) => {
      agentToBuilding = new Map(Object.entries(map))
    })
    .catch(() => undefined)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function handleEvent(event: BackendEvent) {
  if (event.type === 'usage.updated') void useCreditsStore.getState().load(true)
  if (!event.agentId) return
  let buildingId = agentToBuilding.get(event.agentId)
  if (!buildingId) {
    void refreshAgentMap()
    return
  }
  if (buildingId === 'router') return
  const grid = useGrid.getState()
  if (!grid.buildings[buildingId]) buildingId = event.agentId // agent with no building in this city
  const described = describeEvent(event)
  grid.pushLog(buildingId, described.level, described.text)
  const next = statusFromEvent(event.type)
  if (next && grid.buildings[buildingId]) grid.setStatus(buildingId, next)
}

// ---------- lifecycle ----------

let stop: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** Starts the bridge. Safe to call repeatedly; later calls are ignored. */
export async function startLiveBridge(): Promise<void> {
  if (stop) return
  const status = await backendStatus()
  setStatus(status)
  if (!status.live) {
    if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void startLiveBridge() }, 5000)
    return
  }

  await refreshAgentMap()
  // Start from the current tail so the city does not replay its whole history.
  const cursor = await tailEventCursor().catch(() => 0)

  stop = subscribeEvents({ after: cursor }, handleEvent, (error) =>
    setStatus({ ...currentStatus, message: error instanceof Error ? error.message : 'stream interrupted' }),
  )
}

export function stopLiveBridge() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  stop?.()
  stop = null
}

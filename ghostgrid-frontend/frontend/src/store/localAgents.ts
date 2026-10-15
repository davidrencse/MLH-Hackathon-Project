// How many coding CLIs are actually running on this machine, for the HUD's AGENTS chip.
//
// The chip used to read "N/M agents busy" off building status, so it sat at 0/21 whenever no
// building happened to be mid-task — while the user had nine Claude Code shells open. The count
// now comes from the backend's /proc scan (GET /api/v1/office/processes), which reports the real
// fleet: one entry per interactive CLI, background daemons and helper invocations excluded.
//
// One store, every reader. The scan walks all of /proc with sync fs (~16ms of blocked event loop),
// so the HUD chip and the office's crew list share this cache instead of polling the route each on
// their own clock — which had the backend scanning roughly every two seconds, per open tab. A
// reader asks whenever it likes; `load` only goes to the network when what we hold is stale.
//
// A failed scan is never an alarm. The backend may be older than the route, or not on Linux, and
// the city still works; each reader words the failure for the surface it sits on.
import { create } from 'zustand'
import { backend, isBackendError, type DetectedCli, type DetectedRuntime } from '../api/backend'
import { useVisibleInterval } from '../lib/useVisibleInterval'

/** 'stale' = the backend predates the route and 404s; 'unreadable' = the scan itself failed. */
export type LocalAgentsErrorKind = 'stale' | 'unreadable'

/**
 * How long a scan counts as current. Terminals are started and quit by hand, so this only needs
 * to be shorter than a reader's poll — it exists to collapse several readers onto one request.
 */
const FRESH_MS = 2_500

export interface LocalAgentsState {
  items: DetectedCli[]
  /** False off Linux, where the backend cannot read /proc — not "nothing is running". */
  supported: boolean
  scannedAt: string | null
  /** Set when the scan could not be read at all; the count is then unknown, not zero. */
  errorKind: LocalAgentsErrorKind | null
  /** When this client last heard back, successfully or not. Drives the freshness check. */
  fetchedAt: number
  load: (force?: boolean) => Promise<void>
}

let inflight: Promise<void> | null = null

export const useLocalAgentsStore = create<LocalAgentsState>()((set, get) => ({
  items: [],
  supported: true,
  scannedAt: null,
  errorKind: null,
  fetchedAt: 0,
  load: async (force = false) => {
    if (!force && Date.now() - get().fetchedAt < FRESH_MS) return
    inflight ??= (async () => {
      try {
        const scan = await backend.officeProcesses()
        set({ items: scan.items, supported: scan.supported, scannedAt: scan.scannedAt, errorKind: null, fetchedAt: Date.now() })
      } catch (error) {
        // A backend predating the route 404s rather than failing, so say what to do about it.
        const stale = isBackendError(error) && (error.status === 404 || /route not found/i.test(error.message))
        set({ items: [], errorKind: stale ? 'stale' : 'unreadable', fetchedAt: Date.now() })
      } finally {
        inflight = null
      }
    })()
    return inflight
  },
}))

/** Runtime tallies, biggest first — what the chip's sub-line is built from. */
export function countByRuntime(items: DetectedCli[]): { runtime: DetectedRuntime; count: number }[] {
  const counts = new Map<DetectedRuntime, number>()
  for (const item of items) counts.set(item.runtime, (counts.get(item.runtime) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([runtime, count]) => ({ runtime, count }))
}

/**
 * Keeps the shared scan fresh while `active` and the tab is visible. Every reader calls this; the
 * store's freshness window means the extra callers cost nothing.
 */
export function useLocalAgentsPoll(active = true) {
  const load = useLocalAgentsStore((s) => s.load)
  // CLIs are started and quit by hand, so a 4s poll is as live as this needs to be.
  useVisibleInterval(() => void load(), active ? 4000 : 0)
}

export interface LocalAgents {
  total: number | null
  /** Runtimes present, biggest first, e.g. `[{ runtime: 'claude', count: 9 }]`. */
  byRuntime: { runtime: DetectedRuntime; count: number }[]
  supported: boolean
  error: string | null
}

const CHIP_ERROR: Record<LocalAgentsErrorKind, string> = {
  stale: 'backend too old — restart it',
  unreadable: 'could not read this machine',
}

/** The HUD chip's view of the scan. */
export function useLocalAgents(active = true): LocalAgents {
  const items = useLocalAgentsStore((s) => s.items)
  const supported = useLocalAgentsStore((s) => s.supported)
  const scannedAt = useLocalAgentsStore((s) => s.scannedAt)
  const errorKind = useLocalAgentsStore((s) => s.errorKind)

  useLocalAgentsPoll(active)

  return {
    // Before the first scan lands the count is unknown; 0 would claim nothing is running. A host
    // the backend cannot scan at all (`supported: false` — not Linux, or /proc unreadable) is the
    // same kind of unknown: it still returns a `scannedAt` with an empty list, which was being
    // rendered as a confident 0 next to the caveat "needs a Linux host".
    total: errorKind || !supported ? null : scannedAt ? items.length : null,
    byRuntime: countByRuntime(items),
    supported,
    error: errorKind ? CHIP_ERROR[errorKind] : null,
  }
}

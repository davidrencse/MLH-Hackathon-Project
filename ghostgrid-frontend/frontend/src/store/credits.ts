// Backend usage cache shared by the HUD, dashboard, and usage dropdown.
// Refreshes after usage events, once per minute while visible, and retries failed reads.
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { fetchCredits, type CreditRow, type CreditsSnapshot } from '../api/providerCredits'

const TTL_MS = 60_000
/**
 * An "offline" snapshot holds no numbers at all, so it is worth almost nothing: cached for a
 * full minute it left the city showing "backend unavailable" long after the backend answered
 * again (the health probe re-checks a dead backend every 5s). Matched to that probe instead.
 */
const OFFLINE_TTL_MS = 5_000
let refreshPending = false
let pendingVendorRefresh = false

/** How long the snapshot in hand stays usable. */
const ttlFor = (snapshot: CreditsSnapshot | null) => (snapshot?.offline ? OFFLINE_TTL_MS : TTL_MS)

interface CreditsState {
  snapshot: CreditsSnapshot | null
  loading: boolean
  error: string | null
  /**
   * Fetches unless a fresh-enough snapshot is already cached. `force` ignores the TTL;
   * `refreshVendors` additionally asks the backend to re-poll the vendor balance APIs, which
   * only a user pressing refresh should do.
   */
  load: (force?: boolean, refreshVendors?: boolean) => Promise<void>
}

let inflight: Promise<void> | null = null

export const useCreditsStore = create<CreditsState>()((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  load: async (force = false, refreshVendors = false) => {
    const { snapshot, loading } = get()
    if (loading) {
      // Only a forced reload is queued, so the vendor flag is only remembered alongside one;
      // otherwise it would leak into whatever forced reload came next.
      if (force) {
        refreshPending = true
        pendingVendorRefresh ||= refreshVendors
      }
      return inflight ?? undefined
    }
    if (!force && snapshot && Date.now() - snapshot.fetchedAt < ttlFor(snapshot)) return
    set({ loading: true, error: null })
    inflight = (async () => {
      try {
        set({ snapshot: await fetchCredits(refreshVendors), loading: false })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : 'failed to read credits' })
      } finally {
        inflight = null
        if (refreshPending) {
          refreshPending = false
          const vendors = pendingVendorRefresh
          pendingVendorRefresh = false
          void get().load(true, vendors)
        }
      }
    })()
    return inflight
  },
}))

export interface UseCredits {
  rows: CreditRow[]
  loading: boolean
  error: string | null
  fetchedAt: number | null
  via: CreditsSnapshot['via'] | null
  /** The backend is unreachable, so no usage could be read. */
  offline: boolean
  refresh: () => void
}

/** Subscribes to the cached credits and triggers a load while `active` is true. */
export function useCredits(active: boolean): UseCredits {
  const snapshot = useCreditsStore((s) => s.snapshot)
  const loading = useCreditsStore((s) => s.loading)
  const error = useCreditsStore((s) => s.error)
  const load = useCreditsStore((s) => s.load)
  // While the backend is unreachable there are no numbers on screen at all, so the tick has to
  // match the shorter offline TTL — otherwise a backend that comes up a second after page load
  // stays invisible to the HUD for a full minute.
  const offline = snapshot?.offline ?? false

  useEffect(() => {
    if (!active) return
    void load()
    const refresh = () => { if (!document.hidden) void load() }
    // Matched to the snapshot's TTL: a shorter tick only re-ran the cache check, and usage
    // events already force a refresh through the live store, so nothing waits on this timer.
    const timer = setInterval(refresh, offline ? OFFLINE_TTL_MS : TTL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, load, offline])

  // The button is a user asking the vendors again, so this is the one path that re-polls them.
  const refresh = useCallback(() => void load(true, true), [load])

  return {
    rows: snapshot?.rows ?? [],
    loading,
    error,
    fetchedAt: snapshot?.fetchedAt ?? null,
    via: snapshot?.via ?? null,
    offline: snapshot?.offline ?? false,
    refresh,
  }
}

/** "12s ago" / "3m ago", for the dropdown footer. */
export function useRelativeTime(ts: number | null): string {
  const [, tick] = useState(0)
  useEffect(() => {
    if (ts == null) return
    const t = setInterval(() => tick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [ts])
  if (ts == null) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 60) return `${secs}s ago`
  return `${Math.round(secs / 60)}m ago`
}

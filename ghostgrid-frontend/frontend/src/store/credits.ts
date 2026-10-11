// Backend usage cache shared by the HUD, dashboard, and usage dropdown.
// Refreshes after usage events, once per minute while visible, and retries failed reads.
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { fetchCredits, type CreditRow, type CreditsSnapshot } from '../api/providerCredits'

const TTL_MS = 60_000
let refreshPending = false

interface CreditsState {
  snapshot: CreditsSnapshot | null
  loading: boolean
  error: string | null
  /** Fetches unless a fresh-enough snapshot is already cached. `force` ignores the TTL. */
  load: (force?: boolean) => Promise<void>
}

let inflight: Promise<void> | null = null

export const useCreditsStore = create<CreditsState>()((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  load: async (force = false) => {
    const { snapshot, loading } = get()
    if (loading) {
      if (force) refreshPending = true
      return inflight ?? undefined
    }
    if (!force && snapshot && Date.now() - snapshot.fetchedAt < TTL_MS) return
    set({ loading: true, error: null })
    inflight = (async () => {
      try {
        set({ snapshot: await fetchCredits(force), loading: false })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : 'failed to read credits' })
      } finally {
        inflight = null
        if (refreshPending) {
          refreshPending = false
          void get().load(true)
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
  refresh: () => void
}

/** Subscribes to the cached credits and triggers a load while `active` is true. */
export function useCredits(active: boolean): UseCredits {
  const snapshot = useCreditsStore((s) => s.snapshot)
  const loading = useCreditsStore((s) => s.loading)
  const error = useCreditsStore((s) => s.error)
  const load = useCreditsStore((s) => s.load)

  useEffect(() => {
    if (!active) return
    void load()
    const refresh = () => { if (!document.hidden) void load() }
    const timer = setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, load])

  const refresh = useCallback(() => void load(true), [load])

  return {
    rows: snapshot?.rows ?? [],
    loading,
    error,
    fetchedAt: snapshot?.fetchedAt ?? null,
    via: snapshot?.via ?? null,
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

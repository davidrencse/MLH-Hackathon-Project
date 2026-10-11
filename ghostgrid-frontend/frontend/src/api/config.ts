// Runtime configuration for the real Ghost Grid backend.
//
// Live mode is opt-in-by-availability: the app probes `GET /health` once. If the
// backend answers, every api.* call goes to it; if it does not, the mock backend
// in `mock.ts` keeps the demo working offline. Force either side with
// `VITE_GG_LIVE=1` / `VITE_GG_LIVE=0`.
//
// Env (frontend/.env.local):
//   VITE_GG_API_URL    base URL of the backend, default "/gg" (dev proxy, see vite.config.ts)
//   VITE_GG_API_TOKEN  bearer token when the backend runs with GHOSTGRID_API_TOKEN
//   VITE_GG_PROJECT_ID project UUID to attach to; otherwise the first project is used/created
//   VITE_GG_LIVE       "1" force live, "0" force mock, unset = probe

const env = import.meta.env as Record<string, string | undefined>

export const BASE_URL = (env.VITE_GG_API_URL ?? '/gg').replace(/\/$/, '')
export const API_TOKEN = env.VITE_GG_API_TOKEN ?? null
export const PROJECT_ID = env.VITE_GG_PROJECT_ID ?? null
const FORCED = env.VITE_GG_LIVE === '1' ? true : env.VITE_GG_LIVE === '0' ? false : null

// URL of the hosted Library of Babel web app (the "news"/Medium Library project).
// Clicking the Library building in the city opens this site in a new tab.
// Override with VITE_GG_LIBRARY_SITE_URL, falling back to VITE_GG_LIBRARY_URL.
export const LIBRARY_SITE_URL =
  env.VITE_GG_LIBRARY_SITE_URL ?? env.VITE_GG_LIBRARY_URL ?? 'http://127.0.0.1:8765'

export function openLibrarySite() {
  window.open(LIBRARY_SITE_URL, '_blank', 'noopener,noreferrer')
}

export const apiUrl = (path: string) => `${BASE_URL}${path}`

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return API_TOKEN ? { ...extra, Authorization: `Bearer ${API_TOKEN}` } : extra
}

export interface BackendStatus {
  live: boolean
  version?: string
  workerConcurrency?: number
  storage?: string
  message?: string
}

let probe: Promise<BackendStatus> | null = null
let retryAt = 0

/** Resolved once per page load. Call `resetBackendStatus()` after the backend starts. */
export function backendStatus(): Promise<BackendStatus> {
  if (retryAt && Date.now() >= retryAt) { probe = null; retryAt = 0 }
  probe ??= (async (): Promise<BackendStatus> => {
    if (FORCED === false) return { live: false, message: 'VITE_GG_LIVE=0 (mock backend)' }
    try {
      const health = await fetch(apiUrl('/health'), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(4000),
      })
      if (!health.ok) throw new Error(`health returned HTTP ${health.status}`)
      const status = await fetch(apiUrl('/api/v1/status'), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(4000),
      })
      const info = status.ok ? ((await status.json()) as Record<string, unknown>) : {}
      return {
        live: true,
        version: typeof info.version === 'string' ? info.version : undefined,
        workerConcurrency: typeof info.workerConcurrency === 'number' ? info.workerConcurrency : undefined,
        storage: typeof info.storage === 'string' ? info.storage : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unreachable'
      if (FORCED === true) return { live: true, message: `forced live, but ${message}` }
      retryAt = Date.now() + 5000
      return { live: false, message }
    }
  })()
  return probe
}

export function resetBackendStatus() {
  probe = null
  retryAt = 0
}

export async function isLive(): Promise<boolean> {
  return (await backendStatus()).live
}

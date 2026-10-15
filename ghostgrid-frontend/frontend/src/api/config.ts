// Is the real Ghost Grid backend there, and what is it?
//
// Live mode is opt-in-by-availability: the app probes `GET /health`. If the backend
// answers, every api.* call goes to it; if it does not, those calls fail rather than
// reading as an empty city. Force either side with `VITE_GG_LIVE=1` / `=0`.
//
// The probe result is cached, but not forever and not blindly: a backend that dies
// mid-session is noticed, because http.ts invalidates this cache after repeated
// unreachable calls (and the result expires on its own). The connection badge
// therefore tracks reality instead of the first answer of the page load.
//
// Static configuration (base URL, token, project id) lives in env.ts.
import { FORCED_LIVE } from './env.ts'
import { isBackendError, request, setProbeInvalidator } from './http.ts'

export { API_TOKEN, BASE_URL, LIBRARY_SITE_URL, PROJECT_ID, apiUrl, authHeaders, openLibrarySite } from './env.ts'

export interface BackendStatus {
  live: boolean
  version?: string
  workerConcurrency?: number
  storage?: string
  message?: string
  /** When this verdict was reached, so callers can show staleness. */
  checkedAt: number
}

/** A positive verdict is re-checked after this long even if nothing failed. */
const LIVE_TTL_MS = 30_000
/** A negative verdict is re-checked this soon, so a backend that starts is picked up. */
const DEAD_TTL_MS = 5_000

let probe: Promise<BackendStatus> | null = null
let expiresAt = 0

function cache(status: BackendStatus): BackendStatus {
  expiresAt = Date.now() + (status.live ? LIVE_TTL_MS : DEAD_TTL_MS)
  return status
}

async function runProbe(): Promise<BackendStatus> {
  if (FORCED_LIVE === false) return cache({ live: false, message: 'VITE_GG_LIVE=0 (forced offline)', checkedAt: Date.now() })
  try {
    // No retries: this probe *is* the reachability test, and a slow answer should
    // not hold the first paint. The status call is allowed to fail on its own.
    await request<{ status?: string }>('GET', '/health', { timeoutMs: 4_000, retries: 0, dedupe: false })
    const info = await request<Record<string, unknown>>('GET', '/api/v1/status', { timeoutMs: 4_000, retries: 0 }).catch(
      () => ({}) as Record<string, unknown>,
    )
    return cache({
      live: true,
      version: typeof info.version === 'string' ? info.version : undefined,
      workerConcurrency: typeof info.workerConcurrency === 'number' ? info.workerConcurrency : undefined,
      storage: typeof info.storage === 'string' ? info.storage : undefined,
      checkedAt: Date.now(),
    })
  } catch (error) {
    const message = isBackendError(error) ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : 'unreachable'
    if (FORCED_LIVE === true) return cache({ live: true, message: `forced live, but ${message}`, checkedAt: Date.now() })
    return cache({ live: false, message, checkedAt: Date.now() })
  }
}

/** Cached reachability verdict. Re-probes when the cached one expires. */
export function backendStatus(): Promise<BackendStatus> {
  if (probe && expiresAt && Date.now() >= expiresAt) probe = null
  probe ??= runProbe().catch((error) => {
    probe = null // never cache a thrown probe; the next caller retries
    throw error
  })
  return probe
}

/** Forget the cached verdict (the backend just started, or stopped answering). */
export function resetBackendStatus() {
  probe = null
  expiresAt = 0
}

/**
 * Record that the backend is there but will not serve this app — a rejected token
 * being the case that matters. The badge then says so instead of showing a healthy
 * connection beside panels that cannot load.
 */
export function markBackendUnavailable(message: string) {
  const status = cache({ live: false, message, checkedAt: Date.now() })
  probe = Promise.resolve(status)
}

// Repeated unreachable calls mean the cached "live" verdict is stale.
setProbeInvalidator(resetBackendStatus)

export async function isLive(): Promise<boolean> {
  return (await backendStatus()).live
}

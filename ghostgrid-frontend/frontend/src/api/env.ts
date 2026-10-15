// Static, dependency-free configuration for every backend call.
//
// Kept apart from config.ts so the transport (http.ts) can read the base URL and
// auth header without importing the health probe that itself depends on the
// transport. Nothing in here performs I/O.
//
// Env (frontend/.env.local):
//   VITE_GG_API_URL    base URL of the backend, default "/gg" (dev proxy, see vite.config.ts)
//   VITE_GG_API_TOKEN  bearer token when the backend runs with GHOSTGRID_API_TOKEN
//   VITE_GG_PROJECT_ID project UUID to attach to; otherwise the first project is used/created
//   VITE_GG_LIVE       "1" force live, "0" force offline, unset = probe

// Vite inlines `import.meta.env` at build time. Node (the pipeline tests, any
// script) has no such object, so fall back to `process.env` there — the module
// stays importable outside the bundler.
const env = ((import.meta as { env?: Record<string, string | undefined> }).env ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
  {}) as Record<string, string | undefined>

export const BASE_URL = (env.VITE_GG_API_URL ?? '/gg').replace(/\/$/, '')

// A bearer token in a VITE_ variable is inlined into the production bundle and is
// therefore readable by anyone who loads the app. It is a local-development
// convenience only: in a hosted deployment leave it unset and let a server-side
// proxy attach the token.
export const API_TOKEN = env.VITE_GG_API_TOKEN ?? null

export const PROJECT_ID = env.VITE_GG_PROJECT_ID ?? null

/** "1" force live, "0" force offline, `null` = probe `/health`. */
export const FORCED_LIVE = env.VITE_GG_LIVE === '1' ? true : env.VITE_GG_LIVE === '0' ? false : null

// URL of the hosted Library of Babel web app (the "news"/Medium Library project).
// Clicking the Library building in the city opens this site in a new tab.
// Override with VITE_GG_LIBRARY_SITE_URL, falling back to VITE_GG_LIBRARY_URL.
export const LIBRARY_SITE_URL =
  env.VITE_GG_LIBRARY_SITE_URL ?? env.VITE_GG_LIBRARY_URL ?? 'http://127.0.0.1:8765'

export function openLibrarySite() {
  window.open(LIBRARY_SITE_URL, '_blank', 'noopener,noreferrer')
}

/** Absolute (or proxy-relative) URL for a backend path. */
export const apiUrl = (path: string) => `${BASE_URL}${path}`

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return API_TOKEN ? { ...extra, Authorization: `Bearer ${API_TOKEN}` } : extra
}

export type Query = Record<string, string | number | boolean | undefined | null>

/** Encodes a query object; empty/undefined/null entries are dropped. */
export function queryString(query?: Query) {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

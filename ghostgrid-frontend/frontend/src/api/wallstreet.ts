// Wall Street district → the backend's GET /api/v1/wallstreet.
//
// One tower per open-source quant trading project. The backend merges the static roster with
// live GitHub repository metadata (stars, language, last push) and degrades to cached/static on
// its own, so this client only has to handle "backend not running at all": then the vendored
// roster in ../wallstreet/roster.ts keeps the district standing with `status: 'static'`.
import type { QuantRepo } from '../types'
import { WALL_STREET_DISTRICT, WALL_STREET_FALLBACK } from '../wallstreet/roster.ts'
import { request } from './backend.ts'
import { isLive } from './config.ts'

export interface WallStreetPayload {
  district: string
  updatedAt: string
  /** 'github' = every tower refreshed, 'partial' = some, 'static' = GitHub unreachable. */
  source: 'github' | 'partial' | 'static' | 'offline'
  count: number
  buildings: QuantRepo[]
}

const offline = (message: string): WallStreetPayload => ({
  district: WALL_STREET_DISTRICT,
  updatedAt: new Date().toISOString(),
  source: 'offline',
  count: WALL_STREET_FALLBACK.length,
  buildings: WALL_STREET_FALLBACK.map((b) => ({ ...b, error: message })),
})

/** Never rejects: the city always gets a district back. */
export async function fetchWallStreet(options: { refresh?: boolean } = {}): Promise<WallStreetPayload> {
  if (!(await isLive())) return offline('backend offline — showing the bundled roster')
  try {
    const payload = await request<WallStreetPayload>('GET', '/api/v1/wallstreet', {
      query: options.refresh ? { refresh: '1' } : undefined,
      timeoutMs: 15_000,
    })
    if (!payload?.buildings?.length) return offline('backend returned an empty district')
    return payload
  } catch (error) {
    return offline(error instanceof Error ? error.message : 'request failed')
  }
}

/** One tower, by slug. Falls back to the bundled seed. */
export async function fetchWallStreetBuilding(slug: string): Promise<QuantRepo | null> {
  const fallback = WALL_STREET_FALLBACK.find((b) => b.slug === slug) ?? null
  if (!(await isLive())) return fallback
  try {
    return await request<QuantRepo>('GET', `/api/v1/wallstreet/${encodeURIComponent(slug)}`, { timeoutMs: 15_000 })
  } catch {
    return fallback
  }
}

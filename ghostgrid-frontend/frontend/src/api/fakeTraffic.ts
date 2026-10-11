// Demo-only synthetic API traffic layered on top of real backend data. Set FAKE_TRAFFIC = false to turn off.
import type { BuildingId, RequestLog } from '@/types'

export const FAKE_TRAFFIC = true
const AGENTS = ['codex', 'claude', 'cursor', 'deepseek', 'groq', 'security', 'router'] as BuildingId[]
const PATHS = ['/v1/agents/{a}/run', '/v1/chat/completions', '/v1/tasks', '/v1/sessions/{a}/events', '/v1/approvals', '/v1/embeddings']
const DAY = 86_400_000

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** Requests per day: weekday-heavy growth curve with noise (deterministic per day). */
export function fakeDay(dayIndexFromToday: number) {
  const d = new Date(Date.now() - dayIndexFromToday * DAY)
  const r = rng(d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate())
  const growth = 1 + (30 - Math.min(30, dayIndexFromToday)) * 0.035
  const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.55 : 1
  const requests = Math.round((1800 + r() * 900) * growth * weekend)
  const errors = Math.round(requests * (0.004 + r() * 0.018))
  const tokens = Math.round(requests * (900 + r() * 1400))
  const costUsd = Math.round(tokens * 0.0000021 * 100) / 100
  return { requests, errors, tokens, costUsd, avgLatencyMs: Math.round(380 + r() * 520) }
}

let cache: RequestLog[] | null = null
export function fakeRequests(): RequestLog[] {
  if (cache) return cache
  const r = rng(42)
  const now = Date.now()
  const out: RequestLog[] = []
  for (let i = 0; i < 240; i++) {
    const a = AGENTS[Math.floor(r() * AGENTS.length)]
    const roll = r()
    const status = roll < 0.9 ? (r() < 0.3 ? 201 : 200) : roll < 0.94 ? 429 : roll < 0.97 ? 400 : roll < 0.985 ? 403 : 500
    const tokensIn = Math.round(200 + r() * 6000), tokensOut = status < 300 ? Math.round(50 + r() * 1800) : 0
    const path = PATHS[Math.floor(r() * PATHS.length)].replace('{a}', a)
    out.push({
      id: `req_${(0x1000000 + Math.floor(r() * 0xeffffff)).toString(16)}`,
      ts: now - Math.floor(i * (45_000 + r() * 240_000)),
      agentId: a,
      method: path.includes('events') ? 'GET' : 'POST',
      path, status,
      latencyMs: Math.round(status === 429 ? 12 + r() * 30 : 180 + r() * 2400),
      tokensIn, tokensOut,
      request: { model: a, input: '…', stream: r() < 0.5 },
      response: status < 300 ? { ok: true, usage: { input_tokens: tokensIn, output_tokens: tokensOut } } : { error: status === 429 ? 'rate_limited' : status === 403 ? 'approval_required' : 'bad_request' },
    })
  }
  return (cache = out)
}

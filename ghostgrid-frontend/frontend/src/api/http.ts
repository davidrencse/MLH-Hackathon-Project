// The single HTTP transport for every Ghost Grid backend call.
//
// Everything the frontend sends to the backend goes through `request()` (REST) or
// `openStream()` (SSE). Both apply the same hardening, so no call site has to
// remember it:
//
//   · classified failures   — `BackendError.kind` separates "backend unreachable"
//                             from "backend said no", which is what decides how the
//                             failure is reported (see client.ts).
//   · the backend's error envelope — `{ error: { code, message, requestId } }` is
//                             parsed, so a 403 reports *why* and carries requestId.
//   · bounded waiting       — a per-attempt timeout *and* an overall deadline; a
//                             half-open socket can no longer hang a call forever.
//   · retries               — idempotent calls retry transient failures (network,
//                             timeout, 5xx, 429) with exponential backoff + jitter,
//                             honouring `Retry-After`.
//   · strict bodies         — a response that is not the expected media type is a
//                             `malformed` failure. Previously a proxy's HTML error
//                             page was handed to the UI as if it were a task.
//   · request coalescing    — concurrent identical GETs share one in-flight fetch
//                             (the city has several panels polling the same routes).
//   · health reporting      — repeated transport failures invalidate the cached
//                             `/health` probe, so the connection badge stops lying.
import { apiUrl, authHeaders, queryString, type Query } from './env.ts'

export type { Query }

/** Why a request failed. Only `offline`, `timeout` and `server` are a bad connection. */
export type FailureKind =
  | 'offline' // never reached the backend (DNS, refused, CORS, proxy down)
  | 'timeout' // reached it, no answer in time
  | 'server' // 5xx: the backend is broken, not the request
  | 'rejected' // 4xx: the request itself is wrong (auth, validation, missing id)
  | 'malformed' // answered, but not with the media type the route promises
  | 'aborted' // the caller cancelled

export interface BackendError extends Error {
  status: number
  code?: string
  requestId?: string
  kind: FailureKind
  retryable: boolean
  method: string
  path: string
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof Error && typeof (error as BackendError).kind === 'string'
}

/**
 * True when the failure is the connection having a bad moment: the backend never
 * answered, or answered with its own internal failure, so a retry or a cached read is
 * reasonable. A 4xx means *this request* is wrong — a wrong token, a stale id, a schema
 * mismatch — and is reported as a contract fault instead.
 */
export function shouldDegrade(error: unknown): boolean {
  if (!isBackendError(error)) return true // unknown failure: treat as unreachable
  return error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'server' || error.kind === 'malformed'
}

function makeError(
  message: string,
  init: { status?: number; kind: FailureKind; code?: string; requestId?: string; method: string; path: string; cause?: unknown },
): BackendError {
  const error = new Error(message, init.cause === undefined ? undefined : { cause: init.cause }) as BackendError
  error.name = 'BackendError'
  error.status = init.status ?? 0
  error.kind = init.kind
  error.code = init.code
  error.requestId = init.requestId
  error.method = init.method
  error.path = init.path
  error.retryable = init.kind === 'offline' || init.kind === 'timeout' || init.kind === 'server'
  return error
}

/**
 * The failure for a call that was never attempted because the reachability probe says the
 * backend is not there. Same shape as a transport failure, so a caller cannot tell a call
 * that failed fast from one that went out and found nothing.
 */
export function offlineError(label: string, detail?: string): BackendError {
  return makeError(`backend unreachable: ${label}${detail ? ` (${detail})` : ''}`, {
    kind: 'offline',
    method: 'GET',
    path: label,
  })
}

// ---------- health reporting ----------
//
// config.ts registers its probe invalidator here. Set through a setter rather than
// imported so the transport keeps no dependency on the probe that uses it.

let invalidateProbe: (() => void) | null = null
let consecutiveFailures = 0
const FAILURES_BEFORE_REPROBE = 3

export function setProbeInvalidator(invalidate: () => void) {
  invalidateProbe = invalidate
}

function noteSuccess() {
  consecutiveFailures = 0
}

function noteFailure(error: BackendError) {
  // Only "the backend is not answering" says anything about liveness. A 404 does not.
  if (error.kind !== 'offline' && error.kind !== 'timeout') return
  if (++consecutiveFailures < FAILURES_BEFORE_REPROBE) return
  consecutiveFailures = 0
  invalidateProbe?.()
}

// ---------- error parsing ----------

async function errorFromResponse(response: Response, method: string, path: string): Promise<BackendError> {
  let code: string | undefined
  let message = `HTTP ${response.status}`
  let requestId: string | undefined
  try {
    const text = (await response.text()).slice(0, 4000)
    const body = JSON.parse(text) as { error?: { code?: string; message?: string; requestId?: string } }
    code = body.error?.code
    message = body.error?.message ?? message
    requestId = body.error?.requestId
  } catch {
    // Non-JSON error body (proxy page, gateway error): keep the status line.
  }
  return makeError(message, {
    status: response.status,
    kind: response.status >= 500 ? 'server' : 'rejected',
    code,
    requestId,
    method,
    path,
  })
}

/** `Retry-After` in ms, capped so a hostile value cannot stall the UI. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 10_000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), 10_000)
}

function classifyThrow(error: unknown, method: string, path: string, timedOut: boolean, callerAborted: boolean): BackendError {
  if (isBackendError(error)) return error
  if (callerAborted) return makeError('Request cancelled', { kind: 'aborted', method, path, cause: error })
  if (timedOut) return makeError(`${method} ${path} timed out`, { kind: 'timeout', method, path, cause: error })
  const detail = error instanceof Error ? error.message : 'network error'
  return makeError(`${method} ${path} could not reach the backend (${detail})`, { kind: 'offline', method, path, cause: error })
}

// ---------- retry schedule ----------

export const DEFAULT_TIMEOUT_MS = 20_000
const MAX_BACKOFF_MS = 4_000

/** Exponential backoff with full jitter, so parallel panels do not retry in lockstep. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(300 * 2 ** attempt, MAX_BACKOFF_MS)
  return ceiling / 2 + Math.random() * (ceiling / 2)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })

// ---------- in-flight GET coalescing ----------

const inFlight = new Map<string, Promise<unknown>>()

export interface RequestOptions {
  query?: Query
  body?: unknown
  signal?: AbortSignal
  /** Per-attempt timeout. Default 20s. */
  timeoutMs?: number
  /** Ceiling across all attempts. Default: `timeoutMs` × (retries + 1). */
  deadlineMs?: number
  /** Extra attempts after the first. Defaults to 2 for GET, 0 otherwise. */
  retries?: number
  /** Safe to retry even though it is not a GET (a cancel, for instance). */
  idempotent?: boolean
  /** Expected body. `json` (default) rejects anything else as `malformed`. */
  expect?: 'json' | 'text' | 'none'
  /** Opt out of sharing an identical in-flight GET. */
  dedupe?: boolean
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * One backend call, retried and classified. Rejects with a {@link BackendError};
 * nothing else can escape.
 */
export function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const url = apiUrl(path) + queryString(options.query)
  const idempotent = options.idempotent ?? method === 'GET'
  const shareable = idempotent && method === 'GET' && options.body === undefined && options.dedupe !== false

  if (!shareable) return attempt<T>(method, path, url, options, idempotent)

  const key = `${method} ${url}`
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = attempt<T>(method, path, url, options, idempotent).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key)
  })
  inFlight.set(key, pending)
  return pending
}

async function attempt<T>(method: Method, path: string, url: string, options: RequestOptions, idempotent: boolean): Promise<T> {
  const perAttempt = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = options.retries ?? (idempotent ? 2 : 0)
  const deadline = Date.now() + (options.deadlineMs ?? perAttempt * (retries + 1))
  const expect = options.expect ?? 'json'
  let lastError: BackendError | null = null

  for (let tryIndex = 0; tryIndex <= retries; tryIndex++) {
    if (options.signal?.aborted) throw makeError('Request cancelled', { kind: 'aborted', method, path })
    const budget = Math.min(perAttempt, deadline - Date.now())
    if (budget <= 0) break

    const timeout = AbortSignal.timeout(budget)
    let timedOut = false
    timeout.addEventListener('abort', () => { timedOut = true }, { once: true })
    const signals = options.signal ? [options.signal, timeout] : [timeout]

    try {
      const response = await fetch(url, {
        method,
        headers: authHeaders({
          Accept: expect === 'text' ? 'text/plain, */*' : 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        }),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.any(signals),
        // The backend sets `Cache-Control: no-store`; say so on the request too, so a
        // proxy cannot serve a stale task list.
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
      })

      // It answered, so the backend is reachable whatever the status says.
      noteSuccess()

      if (!response.ok) {
        const error = await errorFromResponse(response, method, path)
        const worthRetrying = (error.retryable || response.status === 429) && idempotent && tryIndex < retries
        if (worthRetrying) {
          lastError = error
          const wait = retryAfterMs(response) ?? backoffMs(tryIndex)
          if (Date.now() + wait < deadline) {
            await sleep(wait, options.signal)
            continue
          }
        }
        throw error
      }

      return await readBody<T>(response, method, path, expect)
    } catch (error) {
      const classified = classifyThrow(error, method, path, timedOut, Boolean(options.signal?.aborted))
      if (classified.kind === 'aborted') throw classified
      noteFailure(classified)
      lastError = classified
      if (!classified.retryable || !idempotent || tryIndex === retries) throw classified
      const wait = backoffMs(tryIndex)
      if (Date.now() + wait >= deadline) throw classified
      await sleep(wait, options.signal)
    }
  }
  throw lastError ?? makeError(`${method} ${path} exhausted its deadline`, { kind: 'timeout', method, path })
}

async function readBody<T>(response: Response, method: string, path: string, expect: 'json' | 'text' | 'none'): Promise<T> {
  if (expect === 'none' || response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (!text) return undefined as T
  if (expect === 'text') return text as unknown as T
  if (!/\bjson\b/i.test(type))
    throw makeError(`${method} ${path} answered ${type || 'an unknown type'} where JSON was expected`, {
      status: response.status,
      kind: 'malformed',
      method,
      path,
    })
  try {
    return JSON.parse(text) as T
  } catch (cause) {
    throw makeError(`${method} ${path} answered with unparseable JSON`, {
      status: response.status,
      kind: 'malformed',
      method,
      path,
      cause,
    })
  }
}

// ---------- shape guards ----------
//
// `JSON.parse(...) as T` is a promise, not a check. These narrow the few envelope
// shapes the city indexes into, so one malformed field cannot crash a render.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `{ items, total }`, or a `malformed` failure.
 *
 * A body without an `items` array is not an empty page: it is a route that changed shape, a
 * proxy answering for the backend, or a response the city cannot read. These used to return
 * `{ items: [], total: 0 }`, which made every one of those look exactly like "the backend has
 * nothing" — a green connection badge over an empty city, which is the failure that removing
 * the mock backend was meant to end. The list routes are the bulk of the read surface, so the
 * substitution there undid the guarantee everywhere else.
 */
export function asPage<T>(value: unknown, path = ''): { items: T[]; total: number } {
  if (!isRecord(value) || !Array.isArray(value.items)) throw malformedPage(path, value)
  const items = value.items.filter(isRecord) as T[]
  return { items, total: typeof value.total === 'number' ? value.total : items.length }
}

/** `{ items, nextCursor }` for the event routes, with the same rule as `asPage`. */
export function asEventPage<T>(value: unknown, fallbackCursor = 0, path = ''): { items: T[]; nextCursor: number } {
  if (!isRecord(value) || !Array.isArray(value.items)) throw malformedPage(path, value)
  const items = value.items.filter(isRecord) as T[]
  const cursor = typeof value.nextCursor === 'number' && Number.isFinite(value.nextCursor) ? value.nextCursor : fallbackCursor
  return { items, nextCursor: cursor }
}

function malformedPage(path: string, value: unknown): BackendError {
  const got = isRecord(value) ? `object without an items array (keys: ${Object.keys(value).slice(0, 6).join(', ') || 'none'})` : `${typeof value}`
  return makeError(`GET ${path || '(unknown path)'} did not answer with a page: got ${got}`, {
    status: 200,
    kind: 'malformed',
    method: 'GET',
    path: path || '(unknown path)',
  })
}

// ---------- SSE ----------

/**
 * Opens an event-stream response with auth applied and non-2xx answers classified
 * the same way `request()` classifies them.
 */
export async function openStream(
  path: string,
  options: { query?: Query; signal: AbortSignal; lastEventId?: string | number | null; connectMs?: number },
): Promise<Response> {
  const url = apiUrl(path) + queryString(options.query)
  let response: Response
  // A stream needs its own connect deadline. `readEventStream`'s stall watchdog only starts once
  // bytes are flowing, so a socket that is accepted and then never answers leaves this await
  // pending forever: the subscriber's loop never iterates, never reports an error and never
  // reconnects, and the city's event bridge is dead for the rest of the page's life.
  const connect = AbortSignal.timeout(options.connectMs ?? 15_000)
  let connectTimedOut = false
  connect.addEventListener('abort', () => { connectTimedOut = true }, { once: true })
  try {
    response = await fetch(url, {
      headers: authHeaders({
        Accept: 'text/event-stream',
        ...(options.lastEventId === undefined || options.lastEventId === null
          ? {}
          : { 'Last-Event-ID': String(options.lastEventId) }),
      }),
      signal: AbortSignal.any([options.signal, connect]),
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch (error) {
    const classified = classifyThrow(error, 'GET', path, connectTimedOut, options.signal.aborted)
    noteFailure(classified)
    throw classified
  }
  if (!response.ok || !response.body) {
    const error = response.ok
      ? makeError(`GET ${path} opened without a stream body`, { status: response.status, kind: 'malformed', method: 'GET', path })
      : await errorFromResponse(response, 'GET', path)
    noteFailure(error)
    throw error
  }
  noteSuccess()
  return response
}

/**
 * Splits an SSE response into parsed `data:` payloads, enforcing a stall timeout:
 * the backend heartbeats every 15s, so silence beyond `stallMs` means a dead
 * connection (a half-open socket reads neither bytes nor EOF) and ends the stream.
 */
export async function* readEventStream(
  response: Response,
  options: { stallMs?: number } = {},
): AsyncGenerator<string> {
  const stallMs = options.stallMs ?? 45_000
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // One watchdog per read, cleared as soon as bytes arrive, so a long-lived stream
  // does not accumulate a timer per chunk.
  const withWatchdog = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<'stalled'>((resolve) => { timer = setTimeout(() => resolve('stalled'), stallMs) }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    for (;;) {
      const chunk = await withWatchdog()
      if (chunk === 'stalled') throw makeError('Event stream went silent past the heartbeat window', {
        kind: 'timeout',
        method: 'GET',
        path: '/api/v1/events/stream',
      })
      if (chunk.done) return
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield data // frames without data are comments: ": heartbeat"
      }
      // A frame larger than this is not a frame the backend sends.
      if (buffer.length > 1_000_000) throw makeError('Event stream frame exceeded 1MB', {
        kind: 'malformed',
        method: 'GET',
        path: '/api/v1/events/stream',
      })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

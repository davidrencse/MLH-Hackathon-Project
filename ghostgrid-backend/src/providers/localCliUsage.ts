// Claude Code and Codex run on the user's own subscription, not on one of our API keys, so
// nothing they spend ever reaches the usage table. Both CLIs do write every response's token
// counts into local JSONL transcripts, so read those instead of an API: the numbers are real,
// no key is needed, and there is no dollar figure to invent for a flat-rate plan.
//
// Transcripts are append-only, so each file is read once and then only from the byte offset
// where the last complete line ended. A cold read of ~350MB takes a couple of seconds; every
// later read touches only the bytes the CLIs have written since.
import { existsSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CreditRow } from "./credits.js";

/**
 * Bytes parsed between two turns of the event loop.
 *
 * This scan used to read and parse every transcript synchronously: a developer box with a
 * year of history holds ~1GB, which took a measured 5.3s in one blocking pass — long enough
 * to stall every other request, the task worker, the task timeouts and the SSE flushes, and
 * to blow this route's own timeout. Reading one chunk per await keeps the longest block to
 * this much parsing (~0.2s) while the whole scan still completes in a single call.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;
const EMPTY = Buffer.alloc(0);
/** Repeated reads inside this window reuse the last answer; `force` ignores it. */
const TTL_MS = 5_000;
/** Depth cap for the dated session tree (`sessions/2026/10/13/*.jsonl`). */
const MAX_DEPTH = 5;

interface Totals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Windows {
  ts: string;
  plan?: string;
  windows: { label: string; usedPercent: number; resetsAt?: string }[];
}

interface FileState {
  size: number;
  offset: number;
  totals: Totals;
  /** Response ids already counted, so a retried or re-logged line is not double counted. */
  seen: Set<string>;
  models: Map<string, { tokens: number; requests: number }>;
  lastActivity: string;
  /** Codex only: turn id -> model, filled by the `turn_context` line that precedes usage. */
  turns: Map<string, string>;
  /** Codex only: the newest plan-window report seen in this file. */
  limits?: Windows;
}

const zero = (): Totals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const newState = (): FileState => ({ size: 0, offset: 0, totals: zero(), seen: new Set(), models: new Map(), lastActivity: "", turns: new Map() });

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

const tokensOf = (t: Totals): number => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

function addTotals(into: Totals, from: Totals): Totals {
  for (const key of Object.keys(into) as (keyof Totals)[]) into[key] += from[key];
  return into;
}

/** Records one response against the file's totals and its model. */
function record(state: FileState, model: string, delta: Totals, timestamp: unknown): void {
  addTotals(state.totals, delta);
  const entry = state.models.get(model) ?? { tokens: 0, requests: 0 };
  entry.tokens += tokensOf(delta);
  entry.requests += delta.requests;
  state.models.set(model, entry);
  if (typeof timestamp === "string" && timestamp > state.lastActivity) state.lastActivity = timestamp;
}

// ---- file reading ----

/** Every `.jsonl` under `root`, depth-capped, newest last. Missing roots yield nothing. */
function listTranscripts(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || !existsSync(root)) return out;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) listTranscripts(path, depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** The bytes between `offset` and `end`. Stays a Buffer: only whole lines are ever decoded. */
async function readChunk(path: string, offset: number, end: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const length = end - offset;
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await file.read(buffer, read, length - read, offset + read);
      if (bytesRead <= 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await file.close();
  }
}

/**
 * Folds the lines appended since the last read into `state`, one CHUNK_BYTES chunk per await.
 *
 * The offset only ever advances past the end of a complete line, so a half-written line is
 * re-read next time rather than parsed, and because a newline is a single byte that can never
 * appear inside a multi-byte UTF-8 sequence, splitting on it means a chunk boundary can never
 * cut a character in half either: `carry` holds the trailing partial line as raw bytes and the
 * next chunk completes it.
 */
async function scanFile(
  path: string,
  cache: Map<string, FileState>,
  onLine: (state: FileState, line: string) => void,
): Promise<FileState | null> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return cache.get(path) ?? null;
  }
  let state = cache.get(path);
  // A transcript that shrank was rotated or rewritten, so the cached totals describe a file
  // that no longer exists: start it over.
  if (!state || size < state.offset) {
    state = newState();
    cache.set(path, state);
  }
  state.size = size;
  if (size <= state.offset) return state;

  const from = state.offset;
  let carry = EMPTY;
  let at = from;
  while (at < size) {
    const to = Math.min(size, at + CHUNK_BYTES);
    const chunk = await readChunk(path, at, to);
    if (!chunk.length) break; // the file was truncated under us; the next call starts it over
    at += chunk.length;
    const buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const cut = buffer.lastIndexOf(NEWLINE);
    if (cut < 0) {
      carry = Buffer.from(buffer);
      continue;
    }
    for (const line of buffer.subarray(0, cut + 1).toString("utf8").split("\n"))
      if (line.length > 2) onLine(state, line);
    carry = Buffer.from(buffer.subarray(cut + 1));
  }
  // Leave the incomplete tail unread so it is parsed once the CLI finishes writing it.
  state.offset = at - carry.length;
  return state;
}

// ---- Claude Code ----

/**
 * Claude Code writes one `assistant` entry per API response, with the raw Anthropic usage
 * block attached. The same response is logged again whenever the entry is rewritten (tool
 * results, thinking replays), so dedupe on the message id before counting it.
 */
function claudeLine(state: FileState, raw: string): void {
  if (!raw.includes('"usage"')) return;
  let entry: {
    type?: string;
    requestId?: string;
    timestamp?: string;
    message?: { id?: string; model?: string; usage?: Record<string, unknown> };
  };
  try {
    entry = JSON.parse(raw);
  } catch {
    return;
  }
  if (entry.type !== "assistant") return;
  const usage = entry.message?.usage;
  if (!usage) return;
  const model = typeof entry.message?.model === "string" ? entry.message.model : "unknown";
  // `<synthetic>` entries are produced locally (errors, interrupts) and cost nothing.
  if (model === "<synthetic>") return;
  const key = entry.message?.id ?? entry.requestId;
  if (typeof key === "string") {
    if (state.seen.has(key)) return;
    state.seen.add(key);
  }
  record(
    state,
    model,
    {
      requests: 1,
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheWriteTokens: num(usage.cache_creation_input_tokens),
    },
    entry.timestamp,
  );
}

// ---- Codex ----

/** "5H" / "7D", from the window length Codex reports in minutes. */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
}

/**
 * Codex logs a `token_usage_record` per response (`usage` is that response alone, while the
 * `turn_`/`thread_` variants are running totals) and a `token_count` event carrying the plan's
 * rolling rate-limit windows. Unlike Anthropic's, Codex's `input_tokens` already includes the
 * cached part, so the cached share is subtracted out to keep both CLIs' fields comparable.
 */
function codexLine(state: FileState, raw: string): void {
  if (!raw.includes('"token_usage_record"') && !raw.includes('"token_count"') && !raw.includes('"turn_context"')) return;
  let entry: {
    type?: string;
    timestamp?: string;
    payload?: {
      type?: string;
      turn_id?: string;
      model?: string;
      response_id?: string;
      usage?: Record<string, unknown>;
      rate_limits?: {
        plan_type?: string;
        primary?: { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
        secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
      } | null;
    };
  };
  try {
    entry = JSON.parse(raw);
  } catch {
    return;
  }
  const payload = entry.payload;
  if (!payload) return;

  if (entry.type === "turn_context") {
    if (typeof payload.turn_id === "string" && typeof payload.model === "string") state.turns.set(payload.turn_id, payload.model);
    return;
  }

  if (entry.type === "token_usage_record" && payload.usage) {
    const key = payload.response_id;
    if (typeof key === "string") {
      if (state.seen.has(key)) return;
      state.seen.add(key);
    }
    const cacheRead = num(payload.usage.cached_input_tokens);
    const input = num(payload.usage.input_tokens);
    record(
      state,
      (typeof payload.turn_id === "string" && state.turns.get(payload.turn_id)) || "unknown",
      {
        requests: 1,
        inputTokens: Math.max(0, input - cacheRead),
        outputTokens: num(payload.usage.output_tokens),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: num(payload.usage.cache_write_input_tokens),
      },
      entry.timestamp,
    );
    return;
  }

  if (payload.type === "token_count" && payload.rate_limits) {
    const limits = payload.rate_limits;
    const windows = [limits.primary, limits.secondary]
      .filter((w): w is { used_percent?: number; window_minutes?: number; resets_at?: number } => !!w)
      .filter((w) => typeof w.used_percent === "number" && typeof w.window_minutes === "number")
      .map((w) => ({
        label: windowLabel(w.window_minutes as number),
        usedPercent: w.used_percent as number,
        resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : undefined,
      }));
    // A report with both windows null says nothing about the plan, so keep the last one that did.
    if (!windows.length) return;
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (state.limits && state.limits.ts >= ts) return;
    state.limits = { ts, plan: typeof limits.plan_type === "string" ? limits.plan_type : undefined, windows };
  }
}

// ---- aggregation ----

interface Cli {
  provider: string;
  name: string;
  roots: () => string[];
  onLine: (state: FileState, line: string) => void;
  home: string;
}

const caches = new Map<string, Map<string, FileState>>();

const claudeHome = () => process.env.GHOSTGRID_CLAUDE_HOME ?? join(homedir(), ".claude");
const codexHome = () => process.env.GHOSTGRID_CODEX_HOME ?? join(homedir(), ".codex");

const CLIS: Cli[] = [
  {
    provider: "claude-code",
    name: "Claude Code",
    home: "~/.claude",
    roots: () => [join(claudeHome(), "projects")],
    onLine: claudeLine,
  },
  {
    provider: "codex-cli",
    name: "Codex CLI",
    home: "~/.codex",
    roots: () => [join(codexHome(), "sessions"), join(codexHome(), "archived_sessions")],
    onLine: codexLine,
  },
];

async function readCli(cli: Cli): Promise<CreditRow | null> {
  const files = cli.roots().flatMap((root) => listTranscripts(root));
  if (!files.length) return null;
  const cache = caches.get(cli.provider) ?? caches.set(cli.provider, new Map()).get(cli.provider)!;
  const totals = zero();
  const models = new Map<string, { tokens: number; requests: number }>();
  let sessions = 0;
  let lastActivity = "";
  let limits: Windows | undefined;
  for (const file of files) {
    const state = await scanFile(file, cache, cli.onLine);
    if (!state) continue;
    addTotals(totals, state.totals);
    if (state.totals.requests > 0) sessions += 1;
    if (state.lastActivity > lastActivity) lastActivity = state.lastActivity;
    if (state.limits && (!limits || state.limits.ts > limits.ts)) limits = state.limits;
    for (const [model, entry] of state.models) {
      const into = models.get(model) ?? { tokens: 0, requests: 0 };
      into.tokens += entry.tokens;
      into.requests += entry.requests;
      models.set(model, into);
    }
  }
  if (!totals.requests) return null;
  return {
    id: cli.provider,
    provider: cli.provider,
    name: cli.name,
    status: "ok",
    source: "local-cli",
    ...totals,
    tokensUsed: tokensOf(totals),
    sessions,
    lastActivity: lastActivity || undefined,
    plan: limits?.plan,
    windows: limits?.windows,
    models: [...models]
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 4)
      .map(([model, entry]) => ({ model, ...entry })),
    detail: `Read from ${cli.home} transcripts — subscription usage, so there is no API balance or dollar cost to report`,
  };
}

let snapshot: { fetchedAt: number; rows: CreditRow[] } | null = null;
let inflight: Promise<CreditRow[]> | null = null;

async function scanClis(): Promise<CreditRow[]> {
  const rows: CreditRow[] = [];
  for (const cli of CLIS) {
    try {
      const row = await readCli(cli);
      if (row) rows.push(row);
    } catch (e) {
      rows.push({
        id: cli.provider,
        provider: cli.provider,
        name: cli.name,
        status: "error",
        source: "local-cli",
        detail: e instanceof Error ? e.message : `could not read ${cli.home}`,
      });
    }
  }
  snapshot = { fetchedAt: Date.now(), rows };
  return rows;
}

/**
 * Usage rows for the local coding CLIs. A CLI with no transcripts produces no row at all,
 * which keeps the credits panel free of placeholders for tools that were never run here.
 *
 * Async on purpose: the scan reads hundreds of megabytes on a well-used machine, and doing
 * that synchronously froze the server for seconds at a time. Concurrent callers share one
 * scan rather than each starting their own over the same files.
 */
export function localCliUsage(force = false): Promise<CreditRow[]> {
  if (process.env.GHOSTGRID_LOCAL_CLI_USAGE === "0") return Promise.resolve([]);
  if (inflight) return inflight;
  if (!force && snapshot && Date.now() - snapshot.fetchedAt < TTL_MS)
    return Promise.resolve(snapshot.rows);
  inflight = scanClis().finally(() => {
    inflight = null;
  });
  return inflight;
}

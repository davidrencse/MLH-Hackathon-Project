// Why: the office can see that eight `claude` terminals are running (processScan) but not what
// any of them is doing, so a selected desk could only show a canned animation. Claude Code
// records every turn of every session as JSONL, and its own session registry maps a live pid to
// the session that owns it — together that is a real activity feed for a desk.
//
// Two files per desk, both written by the CLI itself:
//   ~/.claude/sessions/<pid>.json          — pid -> { sessionId, cwd, name, status }
//   ~/.claude/projects/<slug(cwd)>/<id>.jsonl — the transcript, append-only
//
// Only the tail of the transcript is read (they reach hundreds of megabytes), and only from
// inside the projects directory: `cwd` and `sessionId` come off disk, so both are treated as
// untrusted when they are turned into a path.
import { readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { safePath } from "../security/index.js";

/** Same override the local-CLI usage reader uses, so both agree on where the CLI writes. */
const claudeHome = () => process.env.GHOSTGRID_CLAUDE_HOME ?? join(homedir(), ".claude");

/** Bytes of transcript read from the end. One turn is a few KB, so this covers many turns. */
const TAIL_BYTES = 256 * 1024;
const MAX_LINES = 200;
const DEFAULT_LINES = 40;
/** One line of a terminal, not a document: long output is a wall of text in a 3D office. */
const MAX_TEXT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActivityKind = "prompt" | "say" | "tool" | "result" | "error" | "hook" | "subagent";

export interface ActivityLine {
  kind: ActivityKind;
  text: string;
  at?: string;
}

/**
 * A subagent the CLI spawned for itself.
 *
 * A coding CLI does not only do its own work: it delegates, and those delegates are real workers
 * that the office was blind to — their output arrived folded into one desk's transcript as if
 * that desk had done everything. The office draws one desk per entry here, under the desk that
 * spawned it, so a terminal running five agents looks like five agents.
 *
 * Detected from the CLI's own transcript rather than reported by it: the spawn is a `tool_use`
 * block named `Agent` (or `Task` on older builds), whose input carries the description the
 * operator gave it and the agent type it was launched as.
 */
export interface CliSubagent {
  /** Stable within a transcript: the tool_use id of the spawn. */
  id: string;
  /** The one-line description the CLI gave the subagent; the desk's label. */
  description: string;
  /** The agent type it was launched as ("fork", "general-purpose", a named agent). */
  agentType: string | null;
  at: string | null;
}

export interface CliActivity {
  pid: number;
  sessionId: string;
  /** The CLI's own name for the session, e.g. "hackathon-28". */
  name: string | null;
  /** What the CLI last reported itself doing: "busy", "idle", "shell". */
  status: string | null;
  cwd: string | null;
  version: string | null;
  startedAt: string | null;
  /** When the session last wrote anything, which is how idle time is shown. */
  updatedAt: string | null;
  lines: ActivityLine[];
  /** Subagents this CLI spawned itself, newest last. Empty for a CLI that works alone. */
  subagents: CliSubagent[];
}

export interface Registry {
  sessionId: string;
  cwd: string | null;
  name: string | null;
  status: string | null;
  version: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const asTime = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : asString(value);

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};

/**
 * Claude Code names a project directory after its cwd with every character that is not
 * alphanumeric replaced by a dash, so `/home/u/p/.agents` becomes `-home-u-p--agents`.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** The session registry entry a live pid owns, or null when the CLI wrote none. */
export function readRegistry(pid: number): Registry | null {
  let raw: string;
  try {
    raw = readFileSync(join(claudeHome(), "sessions", `${pid}.json`), "utf8");
  } catch {
    return null; // no registry entry: an older CLI, or a process that is not Claude Code
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId = asString(parsed.sessionId);
  // A session id becomes a filename below, so anything but a uuid is refused outright.
  if (!sessionId || !UUID.test(sessionId)) return null;
  return {
    sessionId,
    cwd: asString(parsed.cwd),
    name: asString(parsed.name),
    status: asString(parsed.status),
    version: asString(parsed.version),
    startedAt: asTime(parsed.startedAt),
    updatedAt: asTime(parsed.updatedAt),
  };
}

/** The single most interesting argument of a tool call, the way a terminal would echo it. */
function toolDetail(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const fields = ["command", "file_path", "path", "pattern", "url", "skill", "prompt", "query", "description"];
  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) return clip(value);
  }
  return "";
}

/** One transcript line -> one terminal line, or null for the lines a terminal would not show. */
function toActivity(entry: Record<string, unknown>): ActivityLine[] {
  const at = asString(entry.timestamp) ?? undefined;
  const type = entry.type;
  if (type === "attachment") {
    const attachment = entry.attachment as Record<string, unknown> | undefined;
    const kind = asString(attachment?.type);
    if (!kind?.startsWith("hook_")) return [];
    const name = asString(attachment?.hookName) ?? asString(attachment?.hookEvent) ?? "hook";
    return [{ kind: "hook", text: clip(`${name} (${kind.replace("hook_", "")})`), at }];
  }
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (type === "user") {
    // A denied or failed tool result is worth a line; a successful one is just noise.
    if (typeof content === "string") return content.trim() ? [{ kind: "prompt", text: clip(content), at }] : [];
    if (!Array.isArray(content)) return [];
    const out: ActivityLine[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const partType = (part as Record<string, unknown>).type;
      if (partType === "text") {
        const text = asString((part as Record<string, unknown>).text);
        if (text) out.push({ kind: "prompt", text: clip(text), at });
      } else if (partType === "tool_result" && (part as Record<string, unknown>).is_error) {
        const raw = (part as Record<string, unknown>).content;
        const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
        out.push({ kind: "error", text: clip(text), at });
      }
    }
    return out;
  }
  if (type !== "assistant" || !Array.isArray(content)) return [];
  const out: ActivityLine[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text") {
      const text = asString(record.text);
      if (text) out.push({ kind: "say", text: clip(text), at });
    } else if (record.type === "tool_use") {
      const name = asString(record.name) ?? "tool";
      const spawn = asSubagent(record, at);
      if (spawn) {
        // Reported as its own kind, not as another tool line: spawning a worker is not the same
        // event as reading a file, and the office draws a desk for it.
        out.push({ kind: "subagent", text: clip(spawn.agentType ? `${spawn.description} (${spawn.agentType})` : spawn.description), at });
        continue;
      }
      const detail = toolDetail(record.input);
      out.push({ kind: "tool", text: clip(detail ? `${name}: ${detail}` : name), at });
    }
  }
  return out;
}

/** Every subagent spawn in one transcript entry. */
function subagentsIn(entry: Record<string, unknown>): CliSubagent[] {
  const content = (entry.message as Record<string, unknown> | undefined)?.content;
  if (entry.type !== "assistant" || !Array.isArray(content)) return [];
  const at = asString(entry.timestamp) ?? undefined;
  const out: CliSubagent[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type !== "tool_use") continue;
    const spawn = asSubagent(record, at);
    if (spawn) out.push(spawn);
  }
  return out;
}

/** Tool names a CLI uses to spawn a subagent. `Task` is the older spelling of the same thing. */
const SPAWN_TOOLS = new Set(["Agent", "Task"]);

/**
 * The spawn in a `tool_use` block, or null when the block is an ordinary tool call.
 *
 * A spawn with no description is still a spawn — the worker exists either way — so this falls
 * back to the agent type and then to a generic label rather than dropping the desk.
 */
function asSubagent(record: Record<string, unknown>, at?: string): CliSubagent | null {
  const name = asString(record.name);
  if (!name || !SPAWN_TOOLS.has(name)) return null;
  const input = (record.input ?? {}) as Record<string, unknown>;
  const agentType = asString(input.subagent_type) ?? null;
  const description = asString(input.description) ?? agentType ?? "subagent";
  return { id: asString(record.id) ?? `${name}-${at ?? ""}`, description: clip(description), agentType, at: at ?? null };
}

/**
 * Last `limit` activity lines of one transcript, plus every subagent it spawned. Reads the file's
 * tail, never the whole file, so the subagent list is the recent tail's too — a desk shows the
 * workers it has going now, not everything it ever launched.
 */
async function tailTranscript(path: string, limit: number): Promise<{ lines: ActivityLine[]; subagents: CliSubagent[] }> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], subagents: [] };
  }
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await open(path, "r");
  try {
    const length = size - start;
    if (length <= 0) return { lines: [], subagents: [] };
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString("utf8");
    // The first line is only a fragment unless the read began at the start of the file.
    const lines = text.split("\n").slice(start > 0 ? 1 : 0);
    const out: ActivityLine[] = [];
    const spawned = new Map<string, CliSubagent>();
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a half-written last line while the CLI is mid-append
      }
      out.push(...toActivity(entry));
      // Keyed by tool_use id so a retried read of the same tail cannot double the desks.
      for (const spawn of subagentsIn(entry)) spawned.set(spawn.id, spawn);
    }
    return { lines: out.slice(-limit), subagents: [...spawned.values()] };
  } finally {
    await handle.close();
  }
}

/**
 * What the terminal at `pid` is doing, from the CLI's own session registry and transcript.
 * Returns null when that pid owns no readable session.
 */
export async function cliActivity(pid: number, limit = DEFAULT_LINES): Promise<CliActivity | null> {
  const registry = readRegistry(pid);
  if (!registry) return null;
  const bounded = Math.max(1, Math.min(MAX_LINES, Math.trunc(limit) || DEFAULT_LINES));
  let lines: ActivityLine[] = [];
  let subagents: CliSubagent[] = [];
  if (registry.cwd) {
    // `cwd` and `sessionId` are read off disk, so the path they build is untrusted. safePath is
    // the project's own guard: it rejects traversal AND resolves symlinks, which a string
    // prefix check does not — a link planted in the projects tree would otherwise hand this
    // route any file the backend can read.
    try {
      const path = safePath(join(claudeHome(), "projects"), join(projectSlug(registry.cwd), `${registry.sessionId}.jsonl`));
      ({ lines, subagents } = await tailTranscript(path, bounded));
    } catch {
      lines = []; // outside the projects root, a symlink, or no projects directory at all
      subagents = [];
    }
  }
  return {
    pid,
    sessionId: registry.sessionId,
    name: registry.name,
    status: registry.status,
    cwd: registry.cwd,
    version: registry.version,
    startedAt: registry.startedAt,
    updatedAt: registry.updatedAt,
    lines,
    subagents,
  };
}

// Why: a desk in the office is a `claude` terminal somebody is typing in, and the office could
// only ever read it — the transcript on screen with no way to answer it. "Why can't I message
// Maya" is the first thing anybody asks of that panel, and the honest answer used to be that the
// backend has no stdin for somebody else's terminal.
//
// It does have something better. Claude Code can continue one of its own sessions
// non-interactively:
//
//   claude --resume <session-id> -p "<prompt>" --output-format json
//
// That runs as the same session — same id, same history, same working directory — and appends its
// turns to the same JSONL the desk's CRT already tails, so the answer lands in the transcript the
// operator is looking at. No injection into a tty, no second copy of the context.
//
// The CLI may decide it cannot share a session that is open elsewhere and continue a copy instead;
// it reports the id it used, so the caller is told which one happened rather than being left to
// assume.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertWorkspace } from "../security/index.js";
import { readRegistry } from "./cliActivity.js";

const runFile = promisify(execFile);

/** Long enough for a real answer with tool calls; a desk is not the place for a half-hour task. */
const TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 8 * 1024 * 1024;
export const MAX_PROMPT = 8_000;

export interface CliReply {
  /** The session the CLI actually continued. */
  sessionId: string;
  /** True when that is not the session asked for: the CLI continued a copy of it. */
  copied: boolean;
  /** What it said, as the transcript will show it. */
  reply: string;
  costUsd: number | null;
  durationMs: number | null;
}

/** Injected in tests, so the guards can be exercised without a CLI on the machine. */
export type Runner = (args: string[], cwd: string) => Promise<string>;

const defaultRunner: Runner = async (args, cwd) => {
  const { stdout } = await runFile(process.env.GHOSTGRID_CLAUDE_BIN ?? "claude", args, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT,
    // The CLI must not inherit a key this process holds for a provider record; it has its own.
    env: { ...process.env, GHOSTGRID_API_TOKEN: undefined },
  });
  return stdout;
};

const inFlight = new Set<number>();
// Annotated on the const, not just the arrow: that is what lets TypeScript treat a call to it as
// the end of the branch, so the reads after a guard narrow properly (same as orchestrator.ts).
const fail: (message: string, statusCode: number) => never = (message, statusCode) => {
  throw Object.assign(new Error(message), { statusCode });
};

/**
 * Send one message to the session a live pid owns, and wait for its answer.
 *
 * The working directory comes off disk (the CLI wrote it), so it goes through the same allowlist
 * every other path on this backend does: a process is about to be started in it.
 */
export async function messageCliSession(
  pid: number,
  prompt: string,
  options: { allowedWorkspaces: string[]; run?: Runner },
): Promise<CliReply> {
  const text = prompt.trim();
  if (!text) fail("Write something to send.", 400);
  if (text.length > MAX_PROMPT)
    fail(`A desk message is at most ${MAX_PROMPT} characters.`, 400);

  const registry = readRegistry(pid);
  if (!registry)
    fail(
      "That desk has no readable Claude session, so there is nothing to continue. Only a Claude Code terminal keeps one.",
      404,
    );
  if (!registry.cwd)
    fail("That session did not record a working directory, so it cannot be continued.", 409);

  let cwd: string;
  try {
    cwd = assertWorkspace(registry.cwd, options.allowedWorkspaces);
  } catch {
    fail(
      `That terminal is working in ${registry.cwd}, which is outside GHOSTGRID_ALLOWED_WORKSPACES. Add it to the allowlist to send work there.`,
      403,
    );
  }

  // Two messages at once would have the CLI continue the same session twice over.
  if (inFlight.has(pid)) fail("That desk is still answering the last message.", 409);
  inFlight.add(pid);
  try {
    const stdout = await (options.run ?? defaultRunner)(
      ["--resume", registry.sessionId, "-p", text, "--output-format", "json"],
      cwd,
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      fail("The CLI answered with something this backend could not read.", 502);
    }
    if (parsed.is_error)
      fail(
        typeof parsed.result === "string" && parsed.result
          ? parsed.result.slice(0, 500)
          : "The CLI refused that message.",
        502,
      );
    const sessionId =
      typeof parsed.session_id === "string" && parsed.session_id
        ? parsed.session_id
        : registry.sessionId;
    const count = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      sessionId,
      copied: sessionId !== registry.sessionId,
      reply: typeof parsed.result === "string" ? parsed.result : "",
      costUsd: count(parsed.total_cost_usd),
      durationMs: count(parsed.duration_ms),
    };
  } finally {
    inFlight.delete(pid);
  }
}

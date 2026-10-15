// Why: the office should mirror the real machine. Every coding CLI the user has open in a
// terminal becomes a desk, so nine `claude` shells read as nine employees without anyone
// clicking "add worker".
//
// Linux-only by design: it reads /proc directly rather than shelling out to `ps`, so no user
// data ever reaches a shell. The scan is also deliberately narrow — it reports the runtime, the
// pid, the controlling terminal and the working directory, and never the argv, because a command
// line can carry a prompt, a file path or a token that has no business crossing even a loopback
// API.
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename } from "node:path";

export type DetectedRuntime = "codex" | "claude" | "deepseek" | "cursor" | "gemini";

export interface DetectedCli {
  /** Stable across scans while the process lives; the office keys desks on this. */
  id: string;
  pid: number;
  runtime: DetectedRuntime;
  /** Controlling terminal, e.g. "pts/3". Always set: a tty is how we know it is interactive. */
  tty: string;
  /** Where the CLI is working, when it is readable. */
  cwd: string | null;
  startedAt: string;
  uptimeSeconds: number;
}

export interface ProcessScan {
  /** False off Linux, where /proc does not exist; the office then falls back to manual desks. */
  supported: boolean;
  scannedAt: string;
  items: DetectedCli[];
}

// Executable name -> the runtime the office knows it as.
const CLI_RUNTIMES: Record<string, DetectedRuntime> = {
  claude: "claude",
  codex: "codex",
  deepseek: "deepseek",
  "cursor-agent": "cursor",
  gemini: "gemini",
};

// A CLI started through a language runtime still argv[0]s as the interpreter.
const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno", "python", "python3", "sh", "bash", "zsh", "fish"]);

// Background helpers of the same binaries: real processes, but not someone sitting at a desk.
const HELPER_FLAGS = [
  "--chrome-native-host", "--managed-daemon", "app-server", "mcp", "serve",
  "--ide", "--print", "-p",
];

// Fixed by the kernel's userspace ABI, independent of the kernel's own tick rate.
const USER_HZ = 100;

/** "pts/3" or "tty1" from a /proc stat tty_nr, or null when the process has no controlling terminal. */
function ttyName(ttyNr: number): string | null {
  if (!ttyNr) return null;
  const major = (ttyNr >> 8) & 0xfff;
  const minor = (ttyNr & 0xff) | ((ttyNr >> 12) & 0xfff00);
  if (major >= 136 && major <= 143) return `pts/${(major - 136) * 256 + minor}`;
  if (major === 4) return `tty${minor}`;
  return `tty-${major}:${minor}`;
}

/** The tty_nr and starttime fields of /proc/<pid>/stat, past the parenthesised comm. */
function readStat(pid: number): { ttyNr: number; startTicks: number } | null {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  // comm can contain spaces and parens, so the fields start after the LAST ')'.
  const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
  // fields[0] is field 3 (state), so field N sits at fields[N - 3].
  const ttyNr = Number(fields[4]);
  const startTicks = Number(fields[19]);
  if (!Number.isFinite(ttyNr) || !Number.isFinite(startTicks)) return null;
  return { ttyNr, startTicks };
}

/** The runtime this command line belongs to, or null when it is not a coding CLI we know. */
export function classifyCommand(argv: string[]): DetectedRuntime | null {
  if (!argv.length) return null;
  let name = basename(argv[0]!);
  if (INTERPRETERS.has(name) && argv[1]) name = basename(argv[1]);
  const runtime = CLI_RUNTIMES[name];
  if (!runtime) return null;
  // A one-shot or headless invocation is a script, not a seat in the office.
  if (argv.slice(1).some((arg) => HELPER_FLAGS.includes(arg))) return null;
  return runtime;
}

/** Every coding CLI this user is running in a terminal right now. */
export function scanCliProcesses(now = Date.now()): ProcessScan {
  const scannedAt = new Date(now).toISOString();
  if (process.platform !== "linux") return { supported: false, scannedAt, items: [] };
  let entries: string[];
  let bootOffset: number;
  try {
    entries = readdirSync("/proc");
    bootOffset = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  } catch {
    return { supported: false, scannedAt, items: [] };
  }
  const uid = process.getuid?.() ?? -1;
  const items: DetectedCli[] = [];
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      // Other users' processes are none of this office's business.
      if (uid >= 0 && statSync(`/proc/${pid}`).uid !== uid) continue;
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      const runtime = classifyCommand(argv);
      if (!runtime) continue;
      const stat = readStat(pid);
      if (!stat) continue;
      // No controlling terminal means a daemon or a helper, not a terminal session.
      const tty = ttyName(stat.ttyNr);
      if (!tty) continue;
      const uptimeSeconds = Math.max(0, Math.round(bootOffset - stat.startTicks / USER_HZ));
      let cwd: string | null = null;
      try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* not readable; the desk still counts */ }
      items.push({
        id: `cli:${pid}`,
        pid,
        runtime,
        tty,
        cwd,
        startedAt: new Date(now - uptimeSeconds * 1000).toISOString(),
        uptimeSeconds,
      });
    } catch {
      // Processes come and go mid-scan; a vanished pid is not an error.
      continue;
    }
  }
  // Oldest first: the office promotes the longest-running session to team lead.
  items.sort((a, b) => b.uptimeSeconds - a.uptimeSeconds || a.pid - b.pid);
  return { supported: true, scannedAt, items };
}

// The scan reads every entry in /proc with sync fs — around 16ms of blocked event loop on a
// machine with 500 processes — and the office polls it while it is open, from however many tabs
// the user has. Terminals are opened and closed by hand, so a scan stays true for far longer than
// this window; it exists so that N pollers cost one walk rather than N.
const SCAN_TTL_MS = 1_500;

let cached: { scan: ProcessScan; at: number } | null = null;

/** `scanCliProcesses` behind a short TTL. The route uses this; tests use the scan directly. */
export function cachedCliScan(now = Date.now()): ProcessScan {
  if (cached && now - cached.at < SCAN_TTL_MS) return cached.scan;
  const scan = scanCliProcesses(now);
  cached = { scan, at: now };
  return scan;
}

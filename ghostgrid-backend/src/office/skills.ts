// Why: the office skills deck downloads real skill folders onto this machine, so every call goes
// through `skills.sh` with a fixed argv and no shell — a skill name or a folder can never become
// a command. Two scopes mirror the deck: model scope writes to the CLI's own home
// (~/.claude/skills), employee scope writes to one project's folder, and that folder must pass
// the same workspace allowlist the terminal launcher uses.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateWorkspace } from "../security/index.js";

export type SkillRuntime = "claude" | "codex" | "deepseek";

export interface SkillCard {
  name: string;
  path: string;
  experimental: boolean;
  installed: boolean;
  description?: string;
  title?: string;
  /** Present on disk but not in the upstream catalog. */
  local?: boolean;
}
export interface SkillCatalog {
  runtime: SkillRuntime;
  scope: "model" | "employee";
  workspace: string | null;
  target: string;
  repo: string;
  ref: string;
  items: SkillCard[];
}
export interface SkillsRunner {
  available(): { supported: boolean; script: string };
  list(runtime: SkillRuntime, workspace?: string): Promise<SkillCatalog>;
  install(runtime: SkillRuntime, skills: string[], workspace?: string): Promise<{ installed: string[]; log: string }>;
  remove(runtime: SkillRuntime, skill: string, workspace?: string): Promise<{ removed: string }>;
}

const fail = (message: string, statusCode: number): never => {
  throw Object.assign(new Error(message), { statusCode });
};

// The same shape skills.sh enforces; checked here too so a bad name never reaches a process.
const SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const MAX_SKILLS_PER_CALL = 10;

export function assertSkillName(name: string): string {
  if (typeof name !== "string" || !SKILL_NAME.test(name) || name.includes(".."))
    fail("A skill name may only contain letters, numbers, dots, dashes and underscores", 400);
  if (name.length > 80) fail("That skill name is too long", 400);
  return name;
}

/** Catalog reads are cached by skills.sh; installs reach the network and clone a repo. */
const TIMEOUTS = { list: 90_000, install: 240_000, remove: 15_000 };

/** Biggest catalog or install log this server will hold in memory from one skills.sh run. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

function run(script: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((settle, reject) => {
    const child = spawn(script, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    let err = "";
    // A runaway catalog fetch must not hold an API request open forever.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Object.assign(new Error("skills.sh took too long; check this machine's network"), { statusCode: 504 }));
    }, timeoutMs);
    // stderr keeps its tail, but the catalog has to be parsed whole, so stdout is capped by
    // size instead: a script that streams without end must not be able to exhaust memory.
    child.stdout.on("data", (chunk: Buffer) => {
      if (out.length > MAX_STDOUT_BYTES) return;
      out += chunk.toString();
      if (out.length > MAX_STDOUT_BYTES) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(Object.assign(new Error("skills.sh produced more output than this server will read"), { statusCode: 502 }));
      }
    });
    // Keep the tail only: a failing download should not be able to fill memory.
    child.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString()).slice(-4000); });
    child.once("error", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Could not run skills.sh on the Ghost Grid machine"), { statusCode: 500 }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) { settle(out); return; }
      const message = err.trim().split("\n").pop() ?? `skills.sh exited with ${code}`;
      // 2 is a usage error, 4 a missing skill; everything else is this machine's problem.
      reject(Object.assign(new Error(message.replace(/^skills\.sh:\s*/, "")), { statusCode: code === 2 ? 400 : code === 4 ? 404 : 409 }));
    });
  });
}

export function createSkillsRunner(scriptPath: string, allowedWorkspaces: string[]): SkillsRunner {
  const script = resolve(scriptPath);
  // Employee scope writes inside a project, so it answers to the workspace allowlist.
  const scopeArgs = (workspace: string | undefined): string[] =>
    workspace ? ["--workspace", validateWorkspace(workspace, allowedWorkspaces)] : [];
  const assertScript = () => {
    if (!existsSync(script))
      fail("skills.sh is missing. It lives beside dev.sh in the hackathon folder.", 409);
  };
  return {
    available() { return { supported: existsSync(script), script }; },
    async list(runtime, workspace) {
      assertScript();
      const raw = await run(script, ["list", runtime, "--json", ...scopeArgs(workspace)], TIMEOUTS.list);
      try { return JSON.parse(raw) as SkillCatalog; }
      catch { return fail("skills.sh returned a catalog this server could not read", 502); }
    },
    async install(runtime, skills, workspace) {
      assertScript();
      if (!skills.length) fail("Choose at least one skill to install", 400);
      if (skills.length > MAX_SKILLS_PER_CALL) fail(`Install at most ${MAX_SKILLS_PER_CALL} skills at a time`, 400);
      const names = skills.map(assertSkillName);
      const log = await run(script, ["install", runtime, ...names, ...scopeArgs(workspace)], TIMEOUTS.install);
      // skills.sh prints one "installed <name> -> <path>" line per skill it actually wrote.
      const installed = [...log.matchAll(/^installed (\S+) ->/gm)].map((match) => match[1]!);
      return { installed, log: log.trim().slice(-2000) };
    },
    async remove(runtime, skill, workspace) {
      assertScript();
      const name = assertSkillName(skill);
      await run(script, ["remove", runtime, name, ...scopeArgs(workspace)], TIMEOUTS.remove);
      return { removed: name };
    },
  };
}

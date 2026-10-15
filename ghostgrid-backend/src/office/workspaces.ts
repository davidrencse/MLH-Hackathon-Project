// Why: a write-capable employee needs a real Git repository to work in, and the only way to name
// one used to be the project's own `workspace`, set before any agent existed. The city never sets
// it, and it cannot be changed once agents exist, so every office engineer ran with no file access
// and dutifully said so in its report. This module answers the two questions that unblocks:
// which repositories may an employee be assigned to, and is this particular assignment usable.
//
// The allowlist (`GHOSTGRID_ALLOWED_WORKSPACES`) stays the boundary. It is commonly a directory of
// projects rather than a repository itself — ours is — so discovery looks one level down as well,
// which is why a bare allowlist root that holds no `.git` is not an error here.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { assertWorkspace } from "../security/index.js";

const runFile = promisify(execFile);
/** Enough for a directory of projects; a deeper tree is not scanned for a picker. */
const MAX_CANDIDATES = 60;
const GIT_TIMEOUT_MS = 5_000;

export interface RepoCandidate {
  /** Canonical path, which is what an agent stores and the engine re-checks at run time. */
  path: string;
  name: string;
  branch: string | null;
  /**
   * The engine cuts a detached worktree from HEAD for a writing agent and refuses a dirty
   * tree, so this is the difference between an assignment that runs and one that fails on
   * its first task. Reported rather than enforced: a tree is often dirty only for a minute.
   */
  clean: boolean;
}

const isRepo = (path: string) => existsSync(resolve(path, ".git"));

/**
 * Validate one workspace assignment. Synchronous, so the entity validators can call it, and
 * deliberately narrower than the engine's own check: being inside the allowlist is not enough,
 * because a writing agent also needs the directory to be a repository.
 */
export function assertRepoWorkspace(
  workspace: string,
  allowedWorkspaces: string[],
): string {
  const path = assertWorkspace(workspace, allowedWorkspaces);
  if (!isRepo(path))
    throw Object.assign(
      new Error(
        `${path} is not a Git repository, so an employee cannot be given a worktree in it. Pick a repository inside the allowlist.`,
      ),
      { statusCode: 400 },
    );
  return path;
}

async function describe(path: string): Promise<RepoCandidate> {
  const git = async (args: string[]) => {
    try {
      const { stdout } = await runFile("git", ["-C", path, ...args], {
        timeout: GIT_TIMEOUT_MS,
      });
      return stdout;
    } catch {
      // A repository mid-rebase, or one we cannot read, is listed as dirty rather than hidden:
      // the operator can see it exists and why it will not take work yet.
      return null;
    }
  };
  const [status, branch] = await Promise.all([
    git(["status", "--porcelain"]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return {
    path,
    name: basename(path),
    branch: branch?.trim() || null,
    clean: status !== null && !status.trim(),
  };
}

/**
 * Every repository an employee may be assigned to: each allowlist root that is one, plus the
 * repositories immediately inside it. Never throws — a picker that 500s because one allowlist
 * entry was deleted is worse than a picker that is one entry short.
 */
export async function listRepoCandidates(
  allowedWorkspaces: string[],
): Promise<RepoCandidate[]> {
  const found = new Set<string>();
  for (const root of allowedWorkspaces) {
    let canonical: string;
    try {
      canonical = assertWorkspace(root, allowedWorkspaces);
    } catch {
      continue;
    }
    if (isRepo(canonical)) found.add(canonical);
    let entries: string[] = [];
    try {
      entries = (await readdir(canonical, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .filter((entry) => entry.name !== "node_modules")
        .map((entry) => resolve(canonical, entry.name));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.size >= MAX_CANDIDATES) break;
      if (!isRepo(entry)) continue;
      try {
        found.add(assertWorkspace(entry, allowedWorkspaces));
      } catch {
        // A symlink out of the allowlist is not offered.
      }
    }
  }
  const described = await Promise.all([...found].map(describe));
  return described.sort((left, right) => left.name.localeCompare(right.name));
}

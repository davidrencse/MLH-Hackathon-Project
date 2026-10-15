// An office employee can only touch files if their building's agent is assigned a repository and
// granted write access. These are the rules that gate that assignment: inside the allowlist, a
// real Git repository, and never write with nowhere to write.
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Store } from "../src/db/store.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { listRepoCandidates, assertRepoWorkspace } from "../src/office/workspaces.js";

const run = promisify(execFile);

async function repo(path: string) {
  await mkdir(path, { recursive: true });
  await run("git", ["-C", path, "init", "-q", "-b", "main"]);
  await run("git", ["-C", path, "config", "user.email", "fleet@example.test"]);
  await run("git", ["-C", path, "config", "user.name", "Fleet"]);
  await writeFile(join(path, "README.md"), "# fixture\n");
  await run("git", ["-C", path, "add", "-A"]);
  await run("git", ["-C", path, "commit", "-qm", "init"]);
  return path;
}

describe("assignable workspaces", () => {
  async function office() {
    // The allowlist root is a directory of projects and not a repository itself, which is the
    // shape of the real one and the reason discovery looks a level down.
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    const data = join(root, ".data");
    await mkdir(data, { recursive: true });
    const code = await repo(join(root, "service"));
    const notRepo = join(root, "notes");
    await mkdir(notRepo, { recursive: true });
    const store = new Store(join(data, "db.sqlite"));
    const project = store.insert("projects", { name: "Demo" });
    const provider = store.insert("providers", { type: "mock", concurrency: 2 });
    const agent = store.insert("agents", {
      projectId: project.id, providerId: provider.id, buildingId: "claude", permissions: ["read"],
    });
    const built = await buildApp({
      store,
      config: {
        ...loadConfig(), databasePath: join(data, "db.sqlite"), dataDir: data,
        allowedWorkspaces: [root],
      },
      startWorker: false, logger: false,
    });
    const patch = (payload: Record<string, unknown>) =>
      built.app.inject({ method: "PATCH", url: `/api/v1/agents/${agent.id}`, payload });
    return {
      root, code, notRepo, project, agent, app: built.app, patch,
      cleanup: async () => {
        await built.app.close();
        await built.engine.stop();
        store.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  }

  it("offers the repositories inside the allowlist, not the allowlist itself", async () => {
    const context = await office();
    try {
      const options = await context.app.inject({ method: "GET", url: "/api/v1/office/options" });
      expect(options.statusCode).toBe(200);
      const body = options.json();
      // The raw allowlist is still reported for anything that needs the boundary itself.
      expect(body.workspaces).toEqual([context.root]);
      expect(body.repos.map((entry: any) => entry.name)).toEqual(["service"]);
      const [repoEntry] = body.repos;
      expect(repoEntry.branch).toBe("main");
      // A freshly committed fixture is clean, which is what the engine needs to cut a worktree.
      expect(repoEntry.clean).toBe(true);
      expect(repoEntry.path).toBe(context.code);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("reports a repository the engine would refuse as unclean rather than hiding it", async () => {
    const context = await office();
    try {
      await writeFile(join(context.code, "dirty.txt"), "uncommitted\n");
      const [entry] = await listRepoCandidates([context.root]);
      expect(entry.name).toBe("service");
      expect(entry.clean).toBe(false);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("assigns a repository to a building and grants write in one step", async () => {
    const context = await office();
    try {
      const assigned = await context.patch({ workspace: context.code, permissions: ["read", "write"] });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json().workspace).toBe(context.code);
      expect(assigned.json().permissions).toEqual(["read", "write"]);
      // Assignment does not need the project's own workspace, which the city never sets and
      // cannot change once its agents exist.
      expect(context.project.workspace).toBeUndefined();
    } finally { await context.cleanup(); }
  }, 30_000);

  it("refuses a directory that is not a repository, and a path outside the allowlist", async () => {
    const context = await office();
    try {
      const notRepo = await context.patch({ workspace: context.notRepo });
      expect(notRepo.statusCode).toBe(400);
      expect(notRepo.json().error.message).toMatch(/not a Git repository/i);

      const outside = await context.patch({ workspace: tmpdir() });
      expect(outside.statusCode).toBe(403);
      expect(outside.json().error.message).toMatch(/allowlist/i);

      const missing = await context.patch({ workspace: join(context.root, "nowhere") });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.message).toMatch(/must exist/i);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("refuses write access with nowhere to write", async () => {
    const context = await office();
    try {
      const noWorkspace = await context.patch({ permissions: ["read", "write"] });
      expect(noWorkspace.statusCode).toBe(400);
      expect(noWorkspace.json().error.message).toMatch(/needs a repository/i);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("resolves an assignment to its canonical path", async () => {
    const context = await office();
    try {
      expect(assertRepoWorkspace(join(context.code, ".", ""), [context.root])).toBe(context.code);
      expect(() => assertRepoWorkspace(context.notRepo, [context.root])).toThrow(/not a Git repository/i);
      expect(() => assertRepoWorkspace(join(context.code, "..", ".."), [context.root])).toThrow();
    } finally { await context.cleanup(); }
  }, 30_000);
});

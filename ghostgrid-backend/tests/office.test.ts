import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { planLaunch, type OfficeLauncher } from "../src/office/launcher.js";
import { cachedCliScan, classifyCommand, scanCliProcesses } from "../src/office/processScan.js";
import { assertSkillName, createSkillsRunner } from "../src/office/skills.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db/store.js";

describe("native office workers", () => {
  it("passes a workspace with shell syntax literally to a new terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-office-"));
    try {
      const workspace = join(root, "project; echo nope");
      await mkdir(workspace);
      const plan = planLaunch("codex", workspace, [root], (name) => ["kitty", "codex"].includes(name) ? `/usr/bin/${name}` : null);
      expect(plan).toEqual({ executable: "/usr/bin/kitty", args: ["--directory", workspace, "/usr/bin/codex"], cwd: workspace });
      expect(() => planLaunch("claude", tmpdir(), [workspace], () => "/usr/bin/claude")).toThrow("outside");
      expect(() => planLaunch("claude", workspace, [root], () => null)).toThrow("Install and sign in");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("uses a new browser window with a fixed site URL", () => {
    const find = (name: string) => name === "firefox" ? "/usr/bin/firefox" : null;
    expect(planLaunch("chatgpt-browser", undefined, [], find)).toEqual({ executable: "/usr/bin/firefox", args: ["--new-window", "https://chatgpt.com/"] });
    expect(planLaunch("claude-browser", undefined, [], find).args).toEqual(["--new-window", "https://claude.ai/new"]);
  });

  it("reports missing terminal and browser applications instead of simulating a launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-office-"));
    try {
      expect(() => planLaunch("codex", root, [root], (name) => name === "codex" ? "/bin/codex" : null)).toThrow("Install Kitty");
      expect(() => planLaunch("codex", undefined, [root], () => null)).toThrow("Choose a workspace");
      expect(() => planLaunch("chatgpt-browser", undefined, [], () => null)).toThrow("Install a browser");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("saves independent workers, scopes them to an office, and archives desks", async () => {
    const store = new Store(":memory:");
    const projectId = randomUUID();
    const providerId = randomUUID();
    const agentId = randomUUID();
    store.insert("projects", { id: projectId, name: "Office" });
    store.insert("providers", { id: providerId, type: "mock", name: "Mock", concurrency: 2 });
    store.insert("agents", { id: agentId, projectId, providerId, buildingId: "codex", permissions: ["read"] });
    const launch = vi.fn().mockResolvedValue({ pid: 123 });
    const officeLauncher: OfficeLauncher = { launch, available: () => ({ runtimes: ["codex", "chatgpt-browser"], terminal: "kitty" }) };
    const f = await buildApp({ store, config: loadConfig({ GHOSTGRID_DATABASE_PATH: ":memory:" }), logger: false, startWorker: false, officeLauncher });
    const request = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => f.app.inject({ method, url, payload: payload as Record<string, unknown> });
    try {
      const options = await request("GET", "/api/v1/office/options");
      expect(options.json().runtimes).toEqual(["codex", "chatgpt-browser"]);
      const ids: string[] = [];
      for (const name of ["Ada", "Linus"]) {
        const response = await request("POST", "/api/v1/office/workers", { projectId, buildingId: "codex", name, runtime: "chatgpt-browser" });
        expect(response.statusCode).toBe(201);
        ids.push(response.json().id);
      }
      expect(ids[0]).not.toBe(ids[1]);
      expect((await request("POST", `/api/v1/sessions/${ids[0]}/messages`, { prompt: "Should not run against the demo provider" })).statusCode).toBe(409);
      expect(launch).toHaveBeenCalledTimes(2);
      const list = () => request("GET", `/api/v1/office/workers?projectId=${projectId}&buildingId=codex`);
      expect((await list()).json().items).toHaveLength(2);
      expect((await request("POST", `/api/v1/office/workers/${ids[0]}/open`)).json()).toEqual({ opened: true });
      expect(launch).toHaveBeenCalledTimes(3);
      expect((await request("GET", `/api/v1/office/workers?projectId=${projectId}&buildingId=claude`)).json().items).toEqual([]);
      expect((await request("DELETE", `/api/v1/office/workers/${ids[0]}`)).statusCode).toBe(204);
      expect((await list()).json().items.map((worker: { name: string }) => worker.name)).toEqual(["Linus"]);
      expect(store.get("sessions", ids[0])?.status).toBe("archived");
      expect((await request("POST", `/api/v1/office/workers/${ids[0]}/open`)).statusCode).toBe(404);
      launch.mockRejectedValueOnce(Object.assign(new Error("Desktop unavailable"), { statusCode: 409 }));
      expect((await request("POST", "/api/v1/office/workers", { projectId, buildingId: "codex", name: "Failed", runtime: "codex" })).statusCode).toBe(409);
      expect(store.list("sessions")).toHaveLength(2);
      expect((await request("POST", "/api/v1/office/workers", { projectId, buildingId: "missing", name: "Nope", runtime: "codex" })).statusCode).toBe(404);
      expect((await request("POST", "/api/v1/office/workers", { projectId, buildingId: "codex", name: "Nope", runtime: "bash" })).statusCode).toBe(400);
      expect(launch).toHaveBeenCalledTimes(4);
    } finally { await f.app.close(); }
  });
});

describe("detecting coding CLIs already running on the machine", () => {
  it("counts interactive sessions and ignores background helpers of the same binaries", () => {
    expect(classifyCommand(["claude"])).toBe("claude");
    expect(classifyCommand(["/usr/bin/codex", "--no-alt-screen", "-C", "/home/czr"])).toBe("codex");
    expect(classifyCommand(["node", "/home/czr/.local/bin/claude"])).toBe("claude");
    expect(classifyCommand(["cursor-agent"])).toBe("cursor");
    // Daemons, native-host bridges and one-shot runs are not someone sitting at a desk.
    expect(classifyCommand(["/home/czr/.local/bin/claude", "--chrome-native-host"])).toBeNull();
    expect(classifyCommand([".../bin/codex", "app-server", "--managed-daemon"])).toBeNull();
    expect(classifyCommand(["claude", "-p", "summarise this"])).toBeNull();
    expect(classifyCommand(["vim", "notes.md"])).toBeNull();
    expect(classifyCommand([])).toBeNull();
  });

  it("reports this machine's own sessions with a terminal, a pid and no command line", () => {
    const scan = scanCliProcesses();
    expect(scan.supported).toBe(process.platform === "linux");
    for (const item of scan.items) {
      expect(item.id).toBe(`cli:${item.pid}`);
      expect(item.tty).toMatch(/^(pts\/\d+|tty\d+|tty-\d+:\d+)$/);
      expect(item.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(Date.parse(item.startedAt)).not.toBeNaN();
      // An argv can carry a prompt or a token; it must never leave the scanner.
      expect(Object.keys(item).sort()).toEqual(["cwd", "id", "pid", "runtime", "startedAt", "tty", "uptimeSeconds"]);
    }
    // Longest-running first, so the office can promote the oldest session to team lead.
    expect(scan.items.map((item) => item.uptimeSeconds)).toEqual([...scan.items.map((item) => item.uptimeSeconds)].sort((a, b) => b - a));
  });

  // The scan walks all of /proc with sync fs, blocking the event loop for ~16ms. The office and
  // the HUD both watch it while they are open, so the route serves a short-lived cache.
  it("serves one walk to callers arriving together, and walks again once it ages", () => {
    const first = cachedCliScan();
    expect(cachedCliScan()).toBe(first);
    // A later clock reading, as a caller a few seconds on would make.
    const later = cachedCliScan(Date.now() + 10_000);
    expect(later).not.toBe(first);
    expect(later.supported).toBe(first.supported);
  });
});

describe("office skills deck", () => {
  const script = fileURLToPath(new URL("../../skills.sh", import.meta.url));

  it("rejects skill names that could become paths", () => {
    expect(assertSkillName("frontend-design")).toBe("frontend-design");
    expect(assertSkillName("pdf")).toBe("pdf");
    for (const bad of ["../../etc/passwd", "foo/bar", ".hidden", "a b", "", "x".repeat(81), "nested..name"])
      expect(() => assertSkillName(bad)).toThrow();
  });

  it("reads the catalog for a runtime and marks what is installed", async () => {
    const runner = createSkillsRunner(script, []);
    expect(runner.available()).toEqual({ supported: true, script });
    const catalog = await runner.list("claude");
    expect(catalog.runtime).toBe("claude");
    expect(catalog.scope).toBe("model");
    expect(catalog.repo).toBe("anthropics/skills");
    expect(catalog.items.length).toBeGreaterThan(5);
    for (const card of catalog.items) {
      expect(card.name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
      expect(typeof card.installed).toBe("boolean");
    }
  }, 120_000);

  it("installs into a project folder in employee scope and removes it again", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ghostgrid-skills-"));
    try {
      const runner = createSkillsRunner(script, [workspace]);
      const result = await runner.install("claude", ["pdf"], workspace);
      expect(result.installed).toEqual(["pdf"]);
      // Employee scope writes inside the project, never into the user's home.
      expect(existsSync(join(workspace, ".claude", "skills", "pdf", "SKILL.md"))).toBe(true);
      const scoped = await runner.list("claude", workspace);
      expect(scoped.scope).toBe("employee");
      expect(scoped.items.find((card) => card.name === "pdf")?.installed).toBe(true);
      await runner.remove("claude", "pdf", workspace);
      expect(existsSync(join(workspace, ".claude", "skills", "pdf"))).toBe(false);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  }, 240_000);

  it("refuses a workspace outside the allowlist and a missing script", async () => {
    const runner = createSkillsRunner(script, [join(tmpdir(), "ghostgrid-nowhere")]);
    await expect(runner.list("claude", tmpdir())).rejects.toThrow(/allowlist/);
    await expect(runner.install("claude", [], tmpdir())).rejects.toThrow(/at least one/);
    const missing = createSkillsRunner(join(tmpdir(), "no-skills-here.sh"), []);
    expect(missing.available().supported).toBe(false);
    await expect(missing.list("claude")).rejects.toThrow(/skills\.sh is missing/);
  });

  it("serves the deck over the API and guards the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-skills-api-"));
    try {
      const built = await buildApp({
        config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
        startWorker: false, logger: false,
        skillsRunner: {
          available: () => ({ supported: true, script: "stub" }),
          list: async (runtime, workspace) => ({ runtime, scope: workspace ? "employee" : "model",
            workspace: workspace ?? null, target: `${workspace ?? "/home"}/skills`, repo: "anthropics/skills",
            ref: "main", items: [{ name: "pdf", path: "skills/pdf", experimental: false, installed: false }] }),
          install: async (_runtime, skills) => ({ installed: skills, log: "installed" }),
          remove: async (_runtime, skill) => ({ removed: skill }),
        },
      });
      const app = built.app;
      try {
        const listed = await app.inject({ method: "GET", url: "/api/v1/office/skills?runtime=claude" });
        expect(listed.statusCode).toBe(200);
        expect(listed.json().items[0].name).toBe("pdf");
        expect((await app.inject({ method: "GET", url: "/api/v1/office/skills?runtime=bogus" })).statusCode).toBe(400);
        const installed = await app.inject({ method: "POST", url: "/api/v1/office/skills/install",
          payload: { runtime: "claude", skills: ["pdf"] } });
        expect(installed.json()).toEqual({ installed: ["pdf"], log: "installed" });
        // A name that could escape the skills folder never reaches the runner.
        expect((await app.inject({ method: "POST", url: "/api/v1/office/skills/install",
          payload: { runtime: "claude", skills: ["../../etc"] } })).statusCode).toBe(400);
        expect((await app.inject({ method: "POST", url: "/api/v1/office/skills/install",
          payload: { runtime: "claude", skills: Array.from({ length: 11 }, (_, i) => `skill${i}`) } })).statusCode).toBe(400);
      } finally { await app.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { planLaunch, type OfficeLauncher } from "../src/office/launcher.js";
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

// Why: the contract test next door proves every route the app asks for exists. This proves the
// answers carry the fields the app reads out of them. Those are two different ways to break the
// same pipeline: a renamed route 404s loudly, a renamed field renders as `undefined` quietly, on
// a screen that otherwise looks fine.
//
// Each test walks the pipeline the way the city does — bootstrap, then the office, then work —
// over the real HTTP app, and asserts the shape the frontend's own types declare for that payload.
// Field lists are written out on purpose: a list that has to be edited when the contract changes
// is the point of the test.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { Store } from "../src/db/store.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Engine } from "../src/execution/engine.js";

const run = promisify(execFile);
const has = (value: unknown, keys: string[]) =>
  expect(Object.keys(value as object)).toEqual(expect.arrayContaining(keys));

describe("the backend↔frontend pipeline", () => {
  let root: string;
  let repo: string;
  let app: FastifyInstance;
  let engine: Engine;
  let store: Store;
  let projectId: string;
  let providerId: string;
  let agentId: string;

  /** POST/PATCH/GET helpers that fail loudly, so a broken step names itself. */
  const call = async (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: unknown) => {
    // `inject` is overloaded: the object form needs `payload` present rather than spread in, or
    // its return type collapses to the chainable variant and loses `statusCode`.
    const response = await app.inject({ method, url, payload: payload as never });
    return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
  };
  const ok = async (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: unknown) => {
    const answer = await call(method, url, payload);
    expect(answer.status, `${method} ${url} → ${answer.status} ${JSON.stringify(answer.body).slice(0, 200)}`)
      .toBeLessThan(300);
    return answer.body as any;
  };
  const settle = async (predicate: () => Promise<boolean>, what: string) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${what} never settled`);
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ghostgrid-pipeline-"));
    // A real repository inside the allowlist, so the workspace rules can be exercised for real.
    repo = join(root, "service");
    await mkdir(repo, { recursive: true });
    await run("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await run("git", ["-C", repo, "config", "user.email", "fleet@example.test"]);
    await run("git", ["-C", repo, "config", "user.name", "Fleet"]);
    await writeFile(join(repo, "README.md"), "# fixture\n");
    await run("git", ["-C", repo, "add", "-A"]);
    await run("git", ["-C", repo, "commit", "-qm", "init"]);

    store = new Store(join(root, "db.sqlite"));
    const built = await buildApp({
      store,
      config: {
        ...loadConfig(),
        databasePath: join(root, "db.sqlite"),
        dataDir: root,
        allowedWorkspaces: [root],
      },
      logger: false,
    });
    app = built.app;
    engine = built.engine;

    // The bootstrap itself, so one failing assertion below does not cascade into every later test
    // as "undefined is not a uuid". What each payload must contain is asserted in its own test.
    const project = await ok("POST", "/api/v1/projects", { name: "Ghost Grid City" });
    projectId = project.id;
    const provider = await ok("POST", "/api/v1/providers", { name: "Mock Runtime", type: "mock", concurrency: 4 });
    providerId = provider.id;
    const agent = await ok("POST", "/api/v1/agents", {
      name: "Claude Nexus", buildingId: "claude", projectId, providerId, permissions: ["read"],
    });
    agentId = agent.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await engine?.stop();
    store?.close();
    await rm(root, { recursive: true, force: true });
  });

  // ---- bootstrap: what api/live.ts does on the first page load -------------------------------

  it("bootstraps a project, a provider and a building's agent", async () => {
    has(await ok("GET", `/api/v1/projects/${projectId}`), ["id", "name", "description", "instructions"]);

    const provider = await ok("GET", `/api/v1/providers/${providerId}`);
    has(provider, ["id", "name", "type", "concurrency", "timeoutMs"]);
    // Capabilities are composed by the registry on read, not stored on the record, and the city
    // reads them to decide what a building can be asked to do.
    has(provider.capabilities, ["inference", "coding", "streaming"]);

    has(await ok("GET", `/api/v1/agents/${agentId}`), [
      "id", "name", "buildingId", "projectId", "providerId", "permissions",
    ]);

    // `bootstrap()` lists agents to map building → agent, and needs buildingId on every row.
    const agents = await ok("GET", `/api/v1/agents?projectId=${projectId}&limit=200`);
    has(agents, ["items", "total"]);
    expect(agents.items[0].buildingId).toBe("claude");
  });

  it("answers whether a provider can run, which is what drops a building to unconfigured", async () => {
    const test = await ok("POST", `/api/v1/providers/${providerId}/test`, {});
    has(test, ["available"]);
    expect(typeof test.available).toBe("boolean");
  });

  // ---- the office: file access, roles, streams, staff ----------------------------------------

  it("offers assignable repositories, and assigns one with write access", async () => {
    const options = await ok("GET", "/api/v1/office/options");
    has(options, ["runtimes", "terminal", "workspaces", "repos"]);
    expect(Array.isArray(options.runtimes)).toBe(true);
    const candidate = options.repos.find((entry: any) => entry.path === repo);
    expect(candidate, "the fixture repository is not offered").toBeTruthy();
    has(candidate, ["path", "name", "branch", "clean"]);
    expect(candidate.clean).toBe(true);

    const assigned = await ok("PATCH", `/api/v1/agents/${agentId}`, {
      workspace: repo, permissions: ["read", "write"],
    });
    expect(assigned.workspace).toBe(repo);
    expect(assigned.permissions).toEqual(["read", "write"]);

    // And the rules that stop a writing employee with nowhere to write.
    const noRepo = await call("PATCH", `/api/v1/agents/${agentId}`, { workspace: null, permissions: ["read", "write"] });
    expect(noRepo.status).toBe(400);
    expect(String((noRepo.body as any).error.message)).toMatch(/needs a repository/i);
    await ok("PATCH", `/api/v1/agents/${agentId}`, { workspace: repo, permissions: ["read"] });
  });

  it("serves the role catalog the office's pickers are built from", async () => {
    const catalog = await ok("GET", `/api/v1/office/roles?projectId=${projectId}`);
    has(catalog, ["items", "kinds", "presets"]);
    has(catalog.items[0], ["id", "name", "kind", "rank", "remit", "answer", "builtIn", "holders"]);
    expect(catalog.items.map((role: any) => role.kind)).toEqual(expect.arrayContaining(["manage", "lead", "build"]));
  });

  it("creates, renames and lists work streams", async () => {
    const created = await ok("POST", "/api/v1/office/projects", {
      projectId, name: "Ship it", goal: "Ship the office orchestrator",
    });
    has(created, ["id", "name", "goal"]);
    const renamed = await ok("PATCH", `/api/v1/office/projects/${created.id}`, { projectId, name: "Ship it now" });
    expect(renamed.name).toBe("Ship it now");
    const streams = await ok("GET", `/api/v1/office/projects?projectId=${projectId}`);
    expect(streams.items.map((entry: any) => entry.id)).toContain(created.id);
  });

  it("hires employees and reports them as staff the orchestrator can reach", async () => {
    const hire = async (name: string, title: string, managerId?: string) =>
      ok("POST", "/api/v1/sessions", {
        projectId, agentId, name, title, team: "Platform", managerId, officeProjectId: "ship-it",
      });
    const manager = await hire("Morgan", "Manager");
    has(manager, ["id", "name", "title", "team", "status", "brief"]);
    // The brief is the server's own composition; the office shows it read-only to prove a role landed.
    expect(manager.brief).toContain("Morgan");
    const lead = await hire("Priya", "Team Lead", manager.id);
    await hire("Maya", "Engineer", lead.id);

    const staff = await ok("GET", `/api/v1/office/staff?projectId=${projectId}&buildingId=claude`);
    has(staff.items[0], [
      "sessionId", "name", "title", "roleKind", "team", "managerId", "officeProjectId", "activeTasks", "totalTasks",
    ]);
    expect(staff.items).toHaveLength(3);

    // Promotion rebuilds the brief rather than relabelling the row.
    const promoted = await ok("POST", `/api/v1/office/employees/${staff.items.find((p: any) => p.name === "Maya").sessionId}/promote`);
    has(promoted, ["employee", "from", "to", "direction"]);
    expect(promoted.to).not.toBe(promoted.from);
    await ok("POST", `/api/v1/office/employees/${promoted.employee.id}/demote`);
  });

  // ---- talking to an employee: the chat panel's own calls --------------------------------------

  it("turns a message to an employee into a task, and serves the turn back", async () => {
    const staff = await ok("GET", `/api/v1/office/staff?projectId=${projectId}&buildingId=claude`);
    const sessionId = staff.items.find((person: any) => person.name === "Maya").sessionId;

    const task = await ok("POST", `/api/v1/sessions/${sessionId}/messages`, {
      prompt: "What are you working on?", title: "what are you working on?",
    });
    has(task, ["id", "projectId", "agentId", "sessionId", "title", "prompt", "status"]);

    await settle(async () => {
      const page = await ok("GET", `/api/v1/sessions/${sessionId}/tasks`);
      return page.items[0]?.status === "completed";
    }, "the employee's turn");

    const turns = await ok("GET", `/api/v1/sessions/${sessionId}/tasks`);
    has(turns, ["items"]);
    // Exactly the fields EmployeeChat renders a turn from.
    has(turns.items[0], ["id", "title", "prompt", "status", "result", "error", "usage", "createdAt", "startedAt", "completedAt"]);
    expect(turns.items[0].result).toBeTruthy();
  }, 30_000);

  // ---- orchestration: plan, gate, run, transcript ----------------------------------------------

  it("plans the org chart as a graph, with every field the preview draws", async () => {
    const plan = await ok("POST", "/api/v1/office/orchestrate/plan", {
      projectId, buildingId: "claude", officeProjectId: "ship-it",
    });
    has(plan, ["projectId", "buildingId", "agentId", "scope", "officeProject", "staff", "nodes", "warnings"]);
    has(plan.nodes[0], [
      "key", "stage", "sessionId", "employeeName", "employeeTitle", "team", "title", "prompt", "dependsOn", "requiresApproval",
    ]);
    expect(plan.nodes.map((node: any) => node.stage)).toEqual(
      expect.arrayContaining(["plan", "design", "build", "review", "signoff"]),
    );
  });

  it("runs a gated graph: holds for approval, then finishes, with a readable transcript", async () => {
    const started = await ok("POST", "/api/v1/office/orchestrate", {
      projectId, buildingId: "claude", officeProjectId: "ship-it", approvals: ["build"],
    });
    has(started, ["id", "name", "status", "projectId", "buildingId", "officeProjectId", "nodes"]);
    has(started.nodes[0], ["key", "stage", "title", "employeeName", "taskId", "status", "requiresApproval", "dependsOn"]);

    const buildKey = started.nodes.find((node: any) => node.stage === "build").key;
    await settle(async () => {
      const current = await ok("GET", `/api/v1/office/orchestrations/${started.id}`);
      return current.nodes.find((node: any) => node.key === buildKey)?.status === "awaiting_approval";
    }, "the gated build step");

    // Declining is a decision, not a breakage: it cancels with a reason the office can print.
    const declined = await ok("POST", `/api/v1/office/orchestrations/${started.id}/reject`, {
      key: buildKey, reason: "wrong slice",
    });
    expect(declined.nodes.find((node: any) => node.key === buildKey).status).toBe("cancelled");
    expect(declined.nodes.find((node: any) => node.key === buildKey).error).toContain("wrong slice");

    await settle(async () => {
      const current = await ok("GET", `/api/v1/office/orchestrations/${started.id}`);
      return ["completed", "failed", "cancelled"].includes(current.status);
    }, "the run");

    const transcript = await ok("GET", `/api/v1/office/orchestrations/${started.id}/transcript`);
    has(transcript, ["id", "status", "goal", "nodes", "delivered"]);
    const ran = transcript.nodes.find((node: any) => node.status === "completed");
    has(ran, ["prompt", "promptSource", "result", "usage", "durationMs"]);
    // The prompt a transcript shows is the one the provider was given, brief and all.
    expect(ran.promptSource).toBe("sent");
    expect(ran.prompt).toContain("Role brief");

    // And the office can list its own runs.
    const runs = await ok("GET", `/api/v1/office/orchestrations?projectId=${projectId}&buildingId=claude`);
    expect(runs.items.map((entry: any) => entry.id)).toContain(started.id);
  }, 60_000);

  it("approves a gated step instead of declining it", async () => {
    const started = await ok("POST", "/api/v1/office/orchestrate", {
      projectId, buildingId: "claude", officeProjectId: "ship-it", approvals: ["plan"],
    });
    await settle(async () => {
      const current = await ok("GET", `/api/v1/office/orchestrations/${started.id}`);
      return current.nodes.find((node: any) => node.key === "plan")?.status === "awaiting_approval";
    }, "the gated plan step");
    const approved = await ok("POST", `/api/v1/office/orchestrations/${started.id}/approve`, { key: "plan" });
    expect(["queued", "running", "completed"]).toContain(
      approved.nodes.find((node: any) => node.key === "plan").status,
    );
    await settle(async () => {
      const current = await ok("GET", `/api/v1/office/orchestrations/${started.id}`);
      return ["completed", "failed", "cancelled"].includes(current.status);
    }, "the approved run");
  }, 60_000);

  it("hands a subtask to the stream's lead and reports who took it", async () => {
    const created = await ok("POST", "/api/v1/office/subtasks", {
      projectId, buildingId: "claude", officeProjectId: "ship-it", prompt: "make the import accept semicolons",
    });
    has(created, ["id", "projectId", "buildingId", "officeProjectId", "prompt", "stage", "lead", "engineer", "createdAt"]);
    const listed = await ok("GET", `/api/v1/office/subtasks?projectId=${projectId}&buildingId=claude&officeProjectId=ship-it`);
    expect(listed.items.map((entry: any) => entry.id)).toContain(created.id);
    const cancelled = await ok("POST", `/api/v1/office/subtasks/${created.id}/cancel`);
    expect(["cancelled", "done", "failed"]).toContain(cancelled.stage);
  }, 30_000);

  it("answers the three reads the office opens with: status, processes, activity", async () => {
    // `/status` is what the connection badge probes, so it must stay cheap and always answerable.
    const status = await ok("GET", "/api/v1/status");
    has(status, ["status", "version", "workerConcurrency", "storage"]);

    // The live-crew scan, as `ProcessScan` in the app's own types: `{ supported, scannedAt, items }`.
    // On a machine with no coding CLI open the list is empty, which is a real answer — the roster
    // then says "no terminal open right now" rather than inventing desks.
    const processes = await ok("GET", "/api/v1/office/processes");
    has(processes, ["supported", "scannedAt", "items"]);
    expect(Array.isArray(processes.items)).toBe(true);

    // And a pid with no transcript is a 404 with a reason, not a 500.
    const activity = await call("GET", "/api/v1/office/activity?pid=999999");
    expect(activity.status).toBe(404);
  });

  it("exposes the desk message route the office composer posts to", async () => {
    // The box under a live desk's transcript. The CLI is not run here — an unknown process is
    // enough to prove the route is registered and answers in the shape the panel reads, which is
    // exactly what was missing when the composer shipped against an older backend.
    const answer = await call("POST", "/api/v1/office/activity/message", { pid: 999_999, prompt: "hello" });
    expect(answer.status).toBe(404);
    expect(String((answer.body as any).error.message)).toMatch(/no readable Claude session/i);
    // And it validates its body rather than passing an empty prompt to a CLI.
    expect((await call("POST", "/api/v1/office/activity/message", { pid: 1 })).status).toBe(400);
  });

  // ---- the panels that read measurements, not work ---------------------------------------------

  it("reports usage the ledger can add up, and credits per provider", async () => {
    const summary = await ok("GET", "/api/v1/usage/summary");
    has(summary, ["totals", "today", "providers", "agents", "tokensLastMinute", "fetchedAt", "dayStart"]);
    // `rows` and `usage`, not `items`: store/credits.ts reads `credits.rows` and `credits.usage`,
    // and a rename on either side is a silently empty credits dropdown.
    const credits = await ok("GET", "/api/v1/provider-credits");
    has(credits, ["fetchedAt", "rows", "usage"]);
    expect(Array.isArray(credits.rows)).toBe(true);
  });

  it("serves the event cursor, a page of events, and a live stream", async () => {
    const head = await ok("GET", "/api/v1/events/head");
    has(head, ["seq"]);
    const page = await ok("GET", "/api/v1/events?limit=5");
    has(page, ["items"]);
    has(page.items[0], ["seq", "type", "timestamp"]);
    // The city's whole live view hangs off this one: it must answer as a stream, not as JSON.
    const stream = await app.inject({ method: "GET", url: "/api/v1/events/stream", payloadAsStream: true });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    stream.raw.res.destroy();
  });

  it("serves the library and the Wall Street roster the city renders", async () => {
    const library = await ok("GET", `/api/v1/projects/${projectId}/library`);
    has(library, ["connection"]);
    // `buildings`, not `items`: api/wallstreet.ts falls back to the bundled roster when this key
    // is missing or empty, so a rename here would quietly show stale data instead of failing.
    const wallstreet = await ok("GET", "/api/v1/wallstreet");
    has(wallstreet, ["district", "buildings", "updatedAt"]);
    expect(Array.isArray(wallstreet.buildings)).toBe(true);
  });

  it("keeps its guards: a non-loopback host is refused and secrets are redacted", async () => {
    const remote = await app.inject({
      method: "GET", url: "/api/v1/projects", headers: { host: "ghostgrid.example.com" },
    });
    expect(remote.statusCode).toBe(403);

    // A provider record never echoes a key back, whatever it was created with.
    const echoed = await ok("GET", `/api/v1/providers/${providerId}`);
    expect(JSON.stringify(echoed)).not.toMatch(/sk-[a-z0-9]/i);
  });
});

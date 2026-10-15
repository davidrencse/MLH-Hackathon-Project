import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { Engine } from "../src/execution/engine.js";
import { SessionService } from "../src/sessions/service.js";
import { createOfficeOrchestrator } from "../src/office/orchestrator.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("office orchestration", () => {
  /**
   * One building staffed like a real office: a manager, two leads on their own teams, and
   * engineers reporting to those leads. Everyone is assigned to the "Ship it" work stream
   * except where a test says otherwise.
   */
  async function office(options: { executeTask?: any } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "ghostgrid-orch-"));
    const store = new Store(":memory:");
    store.insert("projects", {
      id: "project", name: "Demo",
      officeProjects: [
        { id: "ship", name: "Ship it", goal: "Ship the office orchestrator" },
        { id: "quiet", name: "Quiet stream", goal: "" },
      ],
    });
    store.insert("providers", { id: "provider", type: "mock", concurrency: 4 });
    store.insert("agents", {
      id: "agent", projectId: "project", providerId: "provider",
      buildingId: "claude", workspace: dir, permissions: ["read"],
    });
    const engine = new Engine(
      store,
      { get: () => ({ executeTask: options.executeTask ?? (async (input: any) => ({ output: `done: ${input.prompt.slice(0, 24)}` })) }) },
      { artifactsDir: dir, allowedWorkspaces: [dir], concurrency: 4 },
    );
    const sessions = new SessionService(store, engine);
    const orchestrator = createOfficeOrchestrator(store, engine);
    const hire = (name: string, title: string, team: string, managerId?: string, officeProjectId: string | null = "ship") =>
      sessions.create({ projectId: "project", agentId: "agent", name, title: title as any, team, managerId, officeProjectId } as any);

    const manager = hire("Morgan", "Manager", "HQ");
    const leadA = hire("Priya", "Team Lead", "Platform", manager.id);
    const leadB = hire("Kai", "Team Lead", "Infra", manager.id);
    const engA1 = hire("Maya", "Engineer", "Platform", leadA.id);
    const engA2 = hire("Leo", "Engineer", "Platform", leadA.id);
    const engB1 = hire("Zoe", "Engineer", "Infra", leadB.id);
    return {
      store, engine, sessions, orchestrator, hire,
      people: { manager, leadA, leadB, engA1, engA2, engB1 },
      input: { projectId: "project", buildingId: "claude", officeProjectId: "ship" },
      cleanup: async () => { await engine.stop(); store.close(); await rm(dir, { recursive: true, force: true }); },
    };
  }
  const waitFor = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Orchestration did not settle");
  };

  it("lays the org chart out as a dependency graph", async () => {
    const context = await office();
    try {
      const { people, orchestrator, input } = context;
      const plan = orchestrator.plan(input);
      const byKey = new Map(plan.nodes.map((node) => [node.key, node]));
      expect(plan.staff).toHaveLength(6);
      expect(plan.warnings).toEqual([]);
      expect(plan.officeProject).toEqual({ id: "ship", name: "Ship it", goal: "Ship the office orchestrator" });

      // The manager opens, and every lead waits on their plan.
      expect(byKey.get("plan")?.dependsOn).toEqual([]);
      expect(byKey.get("plan")?.sessionId).toBe(people.manager.id);
      const designA = `design-${people.leadA.id}`;
      const designB = `design-${people.leadB.id}`;
      expect(byKey.get(designA)?.dependsOn).toEqual(["plan"]);
      expect(byKey.get(designB)?.dependsOn).toEqual(["plan"]);

      // Engineers wait on their own lead, not on the other team's — and on the manager's plan,
      // which they are given as well as the approach so they can tell a deliberate scope cut
      // from an omission without asking anyone.
      expect(byKey.get(`build-${people.engA1.id}`)?.dependsOn).toEqual(["plan", designA]);
      expect(byKey.get(`build-${people.engA2.id}`)?.dependsOn).toEqual(["plan", designA]);
      expect(byKey.get(`build-${people.engB1.id}`)?.dependsOn).toEqual(["plan", designB]);

      // Each lead reviews exactly their own engineers.
      expect(byKey.get(`review-${people.leadA.id}`)?.dependsOn.sort()).toEqual(
        [`build-${people.engA1.id}`, `build-${people.engA2.id}`].sort());
      expect(byKey.get(`review-${people.leadB.id}`)?.dependsOn).toEqual([`build-${people.engB1.id}`]);

      // The manager signs off once both reviews are in.
      expect(byKey.get("signoff")?.sessionId).toBe(people.manager.id);
      expect(byKey.get("signoff")?.dependsOn.sort()).toEqual(
        [`review-${people.leadA.id}`, `review-${people.leadB.id}`].sort());
      expect(plan.nodes.map((node) => node.stage).sort()).toEqual(
        ["build", "build", "build", "design", "design", "plan", "review", "review", "signoff"]);
    } finally { await context.cleanup(); }
  });

  it("writes prompts that carry the goal and name the right people", async () => {
    const context = await office();
    try {
      const { people, orchestrator, input } = context;
      const plan = orchestrator.plan({ ...input, notes: "Do not touch the database." });
      const node = (key: string) => plan.nodes.find((entry) => entry.key === key)!;
      for (const entry of plan.nodes) {
        expect(entry.prompt).toContain("Goal: Ship the office orchestrator");
        expect(entry.prompt).toContain("Do not touch the database.");
      }
      // Every prompt lists the whole stream's roster as context, but the line naming a lead's
      // own engineers must hold only their team: that is what partitions the work.
      const designA = node(`design-${people.leadA.id}`).prompt;
      const ownEngineers = designA.split("\n").find((line) => line.startsWith("Your engineers are:"))!;
      expect(ownEngineers).toContain("Maya (Engineer)");
      expect(ownEngineers).toContain("Leo (Engineer)");
      expect(ownEngineers).not.toContain("Zoe (Engineer)");
      expect(node(`design-${people.leadB.id}`).prompt.split("\n")
        .find((line) => line.startsWith("Your engineers are:"))).toContain("Zoe (Engineer)");
      // An engineer is pointed at their own section of their own lead's document, and the lead
      // is named with the job title their role gives them.
      expect(node(`build-${people.engB1.id}`).prompt).toContain("the approach by Kai, Team Lead");
      expect(node(`build-${people.engB1.id}`).prompt).toContain("the plan by Morgan, Manager");
      expect(node(`build-${people.engB1.id}`).prompt).toContain("addressed to you, Zoe");
      // A lead is told, in its own words, that it does not write code on this stream.
      expect(node(`design-${people.leadB.id}`).prompt).toContain("You do not write code on this stream");
      // The run is driven by each employee's own session, which is what applies their brief.
      expect(context.store.get("sessions", people.engB1.id)?.brief).toContain("Engineer");
    } finally { await context.cleanup(); }
  });

  it("degrades sensibly when the chart is missing its upper layers", async () => {
    const context = await office();
    try {
      const { store, orchestrator, input } = context;
      // Only an unmanaged engineer is left on the stream.
      for (const session of store.list("sessions", { projectId: "project" }))
        if (session.name !== "Maya") store.update("sessions", session.id as string, { officeProjectId: "other" });
      const plan = orchestrator.plan(input);
      expect(plan.staff.map((person) => person.name)).toEqual(["Maya"]);
      expect(plan.nodes).toHaveLength(1);
      expect(plan.nodes[0]!.stage).toBe("build");
      // With no plan above them, an engineer is told to say what they assumed.
      expect(plan.nodes[0]!.dependsOn).toEqual([]);
      expect(plan.nodes[0]!.prompt).toContain("say what you assumed");
      // Matched on meaning, not wording: the operator has to be told the chart is missing a
      // planning layer and a lead layer, however that sentence is phrased.
      expect(plan.warnings).toHaveLength(2);
      expect(plan.warnings.some((warning) => /plan|manager/i.test(warning))).toBe(true);
      expect(plan.warnings.some((warning) => /lead/i.test(warning))).toBe(true);
      // Each one says nobody holds that layer, rather than quietly inventing someone to fill it.
      for (const warning of plan.warnings) expect(warning).toMatch(/nobody|no one|no manager|no team lead/i);
    } finally { await context.cleanup(); }
  });

  it("refuses to run what it cannot staff", async () => {
    const context = await office();
    try {
      const { store, orchestrator, input } = context;
      expect(() => orchestrator.plan({ ...input, officeProjectId: "nope" })).toThrow(/Unknown office project/);
      // A stream with no goal gives the team nothing to aim at.
      expect(() => orchestrator.plan({ ...input, officeProjectId: "quiet" })).toThrow(/goal/);
      expect(() => orchestrator.plan({ ...input, buildingId: "codex" })).toThrow(/no agent yet/);
      // Nobody assigned to the stream, though the building is staffed.
      for (const session of store.list("sessions", { projectId: "project" }))
        store.update("sessions", session.id as string, { officeProjectId: "other" });
      expect(() => orchestrator.plan(input)).toThrow(/Nobody is assigned/);
      // The same office can still be run as a whole building.
      expect(orchestrator.plan({ ...input, scope: "building" }).staff).toHaveLength(6);
    } finally { await context.cleanup(); }
  });

  it("leaves external terminal desks out of the staff", async () => {
    const context = await office();
    try {
      const { store, orchestrator, sessions } = context;
      const desk = sessions.create({ projectId: "project", agentId: "agent", name: "Terminal desk" } as any);
      store.update("sessions", desk.id, { officeWorker: { buildingId: "claude", runtime: "claude" } });
      // A human drives that window; the orchestrator has no way to send it work.
      expect(orchestrator.staff("project", "claude").map((person) => person.name)).not.toContain("Terminal desk");
      // Archived employees are off the roster too.
      store.update("sessions", context.people.engA2.id, { status: "archived" });
      expect(orchestrator.staff("project", "claude").map((person) => person.name)).not.toContain("Leo");
    } finally { await context.cleanup(); }
  });

  it("runs the graph through the engine in org order and reports each desk", async () => {
    const seen: string[] = [];
    const context = await office({
      executeTask: async (input: any) => {
        // Keep the whole prompt: the dependency handoff is appended after the role brief.
        seen.push(input.prompt);
        return { output: `output for ${input.title ?? "task"}` };
      },
    });
    try {
      const { engine, store, orchestrator, input, people } = context;
      engine.start();
      const run = orchestrator.run(input);
      expect(run.status).toBe("running");
      expect(run.nodes).toHaveLength(9);
      expect(store.get("workflows", run.id)?.buildingId).toBe("claude");
      expect(store.get("workflows", run.id)?.officeProjectId).toBe("ship");

      await waitFor(() => orchestrator.get(run.id).status === "completed");
      const done = orchestrator.get(run.id);
      expect(done.nodes.every((node) => node.status === "completed")).toBe(true);
      // Each node names the employee whose desk it ran at, for the office to render.
      expect(done.nodes.find((node) => node.key === "signoff")?.employeeName).toBe("Morgan");
      expect(done.nodes.find((node) => node.key === `build-${people.engB1.id}`)?.employeeName).toBe("Zoe");

      // Order follows the chart: the plan ran before any design, designs before their builds.
      const tasks = store.list("tasks", { projectId: "project" });
      expect(tasks).toHaveLength(9);
      const at = (key: string) => {
        const node = store.list("workflow_nodes", { workflowId: run.id }).find((entry) => entry.key === key)!;
        return store.get("tasks", node.taskId as string)!;
      };
      expect(Date.parse(at(`design-${people.leadA.id}`).startedAt as string))
        .toBeGreaterThanOrEqual(Date.parse(at("plan").completedAt as string));
      expect(Date.parse(at(`build-${people.engA1.id}`).startedAt as string))
        .toBeGreaterThanOrEqual(Date.parse(at(`design-${people.leadA.id}`).completedAt as string));
      expect(Date.parse(at("signoff").startedAt as string))
        .toBeGreaterThanOrEqual(Date.parse(at(`review-${people.leadB.id}`).completedAt as string));

      // The engine hands a node its dependencies' output, which is how the plan reaches the leads.
      expect(seen.some((prompt) => prompt.includes("Completed dependency outputs"))).toBe(true);
      // And every prompt carried the employee's standing role brief.
      expect(seen.some((prompt) => prompt.includes("Role brief"))).toBe(true);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("hands back a transcript: every prompt, every result, and what was delivered", async () => {
    // The run view is polled and stays small, so it carries no text. This is the one that
    // answers "what did the team actually say", which is the only reason to run them.
    const context = await office({
      executeTask: async (input: any) => ({ output: `output for ${input.title ?? "task"}` }),
    });
    try {
      const { engine, orchestrator, input } = context;
      engine.start();
      const run = orchestrator.run(input);
      await waitFor(() => orchestrator.get(run.id).status === "completed");

      const transcript = orchestrator.transcript(run.id);
      expect(transcript.id).toBe(run.id);
      expect(transcript.goal).toBe("Ship the office orchestrator");
      expect(transcript.nodes).toHaveLength(9);

      // Every node carries what it was given and what it produced.
      expect(transcript.nodes.every((node) => node.result?.startsWith("output for"))).toBe(true);
      // `prompt` is what the employee actually received: the orchestrator's instruction for
      // that desk *plus* everything the engine composed on top of it — their standing role
      // brief and the output of every task they depended on. That is the only version that
      // answers "why did they do that", so the engine records it as it runs.
      const plan = transcript.nodes.find((node) => node.key === "plan")!;
      expect(plan.promptSource).toBe("sent");
      expect(plan.prompt).toContain("Goal: Ship the office orchestrator");
      expect(plan.prompt).toContain("Team on this stream");
      expect(plan.prompt).toContain("Role brief — Morgan, Manager");
      expect(plan.durationMs).toBeGreaterThanOrEqual(0);

      const build = transcript.nodes.find((node) => node.stage === "build")!;
      expect(build.prompt).toContain("Work stream: Ship it");
      // The build desk was handed its lead's approach, which is the whole point of the graph.
      expect(build.prompt).toContain("Completed dependency outputs");

      // Delivered is the node nothing depends on: the manager's sign-off.
      expect(transcript.delivered?.key).toBe("signoff");
      expect(transcript.delivered?.employeeName).toBe("Morgan");
      expect(transcript.delivered?.result).toContain("output for");

      expect(() => orchestrator.transcript("missing")).toThrow(/not found/i);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("reports a node's error as readable text, not a stringified object", async () => {
    // The engine stores `{code, message}`. Handing that to the office as a string put
    // "[object Object]" on screen at the one moment the operator needed to read it.
    const context = await office({
      executeTask: async () => { throw Object.assign(new Error("provider said no"), { code: "EXECUTION_FAILED" }) },
    });
    try {
      const { engine, orchestrator, input } = context;
      engine.start();
      const run = orchestrator.run(input);
      await waitFor(() => ["completed", "failed"].includes(orchestrator.get(run.id).status));
      const failed = orchestrator.get(run.id).nodes.find((node) => node.error);
      expect(failed).toBeTruthy();
      expect(typeof failed!.error).toBe("string");
      expect(failed!.error).not.toContain("[object Object]");
      expect(failed!.error).toContain("provider said no");
    } finally { await context.cleanup(); }
  }, 30_000);

  it("lists and cancels runs for the office that started them", async () => {
    const context = await office({ executeTask: async () => new Promise(() => {}) });
    try {
      const { engine, orchestrator, input } = context;
      engine.start();
      const run = orchestrator.run(input);
      const listed = orchestrator.list("project", "claude");
      expect(listed.map((entry) => entry.id)).toContain(run.id);
      expect(orchestrator.list("project", "codex")).toEqual([]);
      const cancelled = orchestrator.cancel(run.id);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.nodes.every((node) => node.status === "cancelled")).toBe(true);
      expect(() => orchestrator.get("00000000-0000-4000-8000-000000000000")).toThrow(/not found/);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("holds a gated stage in front of the operator and runs it once approved", async () => {
    const seen: string[] = [];
    const context = await office({
      executeTask: async (input: any) => {
        seen.push(input.prompt);
        return { output: `output for ${input.title ?? "task"}` };
      },
    });
    try {
      const { engine, store, orchestrator, input, people } = context;
      engine.start();
      const run = orchestrator.run({ ...input, approvals: ["build"] });
      const buildKeys = [people.engA1, people.engA2, people.engB1].map((person) => `build-${person.id}`);

      // Every build waits, and the stages that are not gated have already run.
      await waitFor(() => buildKeys.every((key) =>
        orchestrator.get(run.id).nodes.find((node) => node.key === key)?.status === "awaiting_approval"));
      const held = orchestrator.get(run.id);
      expect(held.status).toBe("running");
      expect(held.nodes.find((node) => node.key === "plan")?.status).toBe("completed");
      expect(held.nodes.filter((node) => node.requiresApproval).map((node) => node.key).sort())
        .toEqual([...buildKeys].sort());
      // Nothing was sent to the provider for a held desk: approving is a decision taken
      // before the work happens, not a review of work that already did.
      expect(seen.some((prompt) => prompt.includes("Find the section addressed to you"))).toBe(false);
      expect(held.nodes.find((node) => node.key === buildKeys[0])?.startedAt).toBeFalsy();
      // And the gate survives a restart: a held desk has no side effects to review.
      engine.start();
      expect(orchestrator.get(run.id).nodes.find((node) => node.key === buildKeys[0])?.status)
        .toBe("awaiting_approval");

      for (const key of buildKeys) orchestrator.decide(run.id, key, "approve");
      await waitFor(() => orchestrator.get(run.id).status === "completed");
      expect(orchestrator.get(run.id).nodes.every((node) => node.status === "completed")).toBe(true);
      expect(seen.some((prompt) => prompt.includes("Find the section addressed to you"))).toBe(true);
      const approved = store.list("tasks", { projectId: "project" })
        .filter((task) => task.approvedAt);
      expect(approved).toHaveLength(3);
      expect(approved.every((task) => task.approvedBy === "operator")).toBe(true);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("declining a step cancels it and fails what depended on it", async () => {
    const context = await office();
    try {
      const { engine, orchestrator, input, people } = context;
      engine.start();
      const run = orchestrator.run({ ...input, approvals: ["design"] });
      const designA = `design-${people.leadA.id}`;
      const designB = `design-${people.leadB.id}`;
      // Approvals are per stage, so both leads hold; one is approved and one declined, which
      // is also what shows that a declined branch does not take the other one down with it.
      await waitFor(() => [designA, designB].every((key) => orchestrator.get(run.id).nodes
        .find((node) => node.key === key)?.status === "awaiting_approval"));

      orchestrator.decide(run.id, designB, "approve");
      orchestrator.decide(run.id, designA, "reject", "Wrong team for this slice");
      const after = orchestrator.get(run.id).nodes.find((node) => node.key === designA)!;
      expect(after.status).toBe("cancelled");
      // A decision reads as a decision, not as a breakage, and the reason is kept.
      expect(after.error).toContain("Wrong team for this slice");

      // Its engineers cannot run without it, and the run fails rather than quietly skipping them.
      await waitFor(() => orchestrator.get(run.id).status === "failed");
      const failed = orchestrator.get(run.id);
      expect(failed.nodes.find((node) => node.key === `build-${people.engA1.id}`)?.status).toBe("failed");
      // The other team never depended on it, so it finished.
      expect(failed.nodes.find((node) => node.key === designB)?.status).toBe("completed");
      expect(failed.nodes.find((node) => node.key === `review-${people.leadB.id}`)?.status).toBe("completed");
      expect(() => orchestrator.decide(run.id, designA, "approve")).toThrow(/not waiting for approval/i);
      expect(() => orchestrator.decide(run.id, "no-such-node", "approve")).toThrow(/no step with that key/i);
    } finally { await context.cleanup(); }
  }, 30_000);
});

describe("office orchestration API", () => {
  it("serves staff, a dry-run plan, a run and its cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-orch-api-"));
    try {
      const store = new Store(join(root, "db.sqlite"));
      const project = store.insert("projects", {
        name: "Demo",
        officeProjects: [{ id: "ship", name: "Ship it", goal: "Ship the orchestrator" }],
      });
      const provider = store.insert("providers", { type: "mock", concurrency: 2 });
      const agent = store.insert("agents", {
        projectId: project.id, providerId: provider.id, buildingId: "claude", permissions: ["read"],
      });
      const built = await buildApp({
        store,
        config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
        startWorker: false, logger: false,
      });
      const app = built.app;
      try {
        const hire = async (name: string, title: string, team: string, managerId?: string) =>
          (await app.inject({ method: "POST", url: "/api/v1/sessions", payload: {
            projectId: project.id, agentId: agent.id, name, title, team, managerId,
            officeProjectId: "ship",
          } })).json();
        const manager = await hire("Morgan", "Manager", "HQ");
        const lead = await hire("Priya", "Team Lead", "Platform", manager.id);
        await hire("Maya", "Engineer", "Platform", lead.id);

        const staff = await app.inject({ method: "GET",
          url: `/api/v1/office/staff?projectId=${project.id}&buildingId=claude` });
        expect(staff.statusCode).toBe(200);
        expect(staff.json().items.map((person: any) => person.title).sort())
          .toEqual(["Engineer", "Manager", "Team Lead"]);

        const body = { projectId: project.id, buildingId: "claude", officeProjectId: "ship" };
        // The dry run submits nothing: it is the graph the operator is about to pay for.
        const planned = await app.inject({ method: "POST", url: "/api/v1/office/orchestrate/plan", payload: body });
        expect(planned.statusCode).toBe(200);
        expect(planned.json().nodes.map((node: any) => node.stage))
          .toEqual(["plan", "design", "build", "review", "signoff"]);
        expect(store.list("tasks")).toHaveLength(0);

        const run = await app.inject({ method: "POST", url: "/api/v1/office/orchestrate", payload: body });
        expect(run.statusCode).toBe(201);
        expect(run.json().status).toBe("running");
        expect(store.list("tasks")).toHaveLength(5);

        const listed = await app.inject({ method: "GET",
          url: `/api/v1/office/orchestrations?projectId=${project.id}&buildingId=claude` });
        expect(listed.json().items.map((entry: any) => entry.id)).toEqual([run.json().id]);
        const one = await app.inject({ method: "GET", url: `/api/v1/office/orchestrations/${run.json().id}` });
        expect(one.json().nodes).toHaveLength(5);

        const cancelled = await app.inject({ method: "POST",
          url: `/api/v1/office/orchestrations/${run.json().id}/cancel` });
        expect(cancelled.json().status).toBe("cancelled");

        // Guards: unknown stream, unstaffed building, and a goal-less stream.
        expect((await app.inject({ method: "POST", url: "/api/v1/office/orchestrate",
          payload: { ...body, officeProjectId: "missing" } })).statusCode).toBe(404);
        expect((await app.inject({ method: "POST", url: "/api/v1/office/orchestrate",
          payload: { ...body, buildingId: "deepseek" } })).statusCode).toBe(404);
        expect((await app.inject({ method: "POST", url: "/api/v1/office/orchestrate",
          payload: { ...body, scope: "sideways" } })).statusCode).toBe(400);
      } finally { await built.app.close(); store.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});

describe("office work streams", () => {
  it("creates, renames, lists and deletes streams, benching whoever was on one", async () => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-streams-"));
    try {
      const store = new Store(join(root, "db.sqlite"));
      const project = store.insert("projects", { name: "Demo", officeProjects: [] });
      const provider = store.insert("providers", { type: "mock", concurrency: 2 });
      const agent = store.insert("agents", {
        projectId: project.id, providerId: provider.id, buildingId: "claude", permissions: ["read"],
      });
      const built = await buildApp({
        store,
        config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
        startWorker: false, logger: false,
      });
      const app = built.app;
      try {
        const created = await app.inject({ method: "POST", url: "/api/v1/office/projects",
          payload: { projectId: project.id, name: "Ship It!", goal: "Ship the thing" } });
        expect(created.statusCode).toBe(201);
        // The id is a slug, because it is what a session stores and what travels in a path.
        // `staff` is null because no building was named: with one, the stream is created with a
        // lead and an engineer already on it (see office-staffing.test.ts).
        expect(created.json()).toEqual({ id: "ship-it", name: "Ship It!", goal: "Ship the thing", staff: null });
        // The same name in different case is a collision; a genuinely different name that
        // happens to slugify the same way is allowed, with its slug uniquified.
        expect((await app.inject({ method: "POST", url: "/api/v1/office/projects",
          payload: { projectId: project.id, name: "ship it!" } })).statusCode).toBe(409);
        const second = await app.inject({ method: "POST", url: "/api/v1/office/projects",
          payload: { projectId: project.id, name: "Ship  it?" } });
        expect(second.json()).toEqual({ id: "ship-it-2", name: "Ship  it?", goal: "", staff: null });

        const employee = (await app.inject({ method: "POST", url: "/api/v1/sessions", payload: {
          projectId: project.id, agentId: agent.id, name: "Maya", title: "Engineer",
          team: "Platform", officeProjectId: "ship-it",
        } })).json();
        expect(store.get("sessions", employee.id)?.brief).toContain("Ship It!");

        // Renaming keeps the slug, so nobody is orphaned by it.
        const renamed = await app.inject({ method: "PATCH", url: "/api/v1/office/projects/ship-it",
          payload: { projectId: project.id, name: "Shipping", goal: "Ship it properly" } });
        expect(renamed.json()).toEqual({ id: "ship-it", name: "Shipping", goal: "Ship it properly" });
        expect((await app.inject({ method: "GET", url: `/api/v1/office/projects?projectId=${project.id}` }))
          .json().items.map((stream: any) => stream.id)).toEqual(["ship-it", "ship-it-2"]);

        // Deleting benches the staff and recomposes their brief, so it cannot point at a
        // goal that no longer exists.
        const deleted = await app.inject({ method: "DELETE",
          url: `/api/v1/office/projects/ship-it?projectId=${project.id}` });
        expect(deleted.json()).toEqual({ unassigned: 1 });
        expect(store.get("sessions", employee.id)?.officeProjectId).toBeNull();
        expect(store.get("sessions", employee.id)?.brief).not.toContain("Shipping");
        expect(store.get("sessions", employee.id)?.brief).toContain("bench");
        expect((await app.inject({ method: "PATCH", url: "/api/v1/office/projects/ship-it",
          payload: { projectId: project.id, name: "Back" } })).statusCode).toBe(404);
      } finally { await built.app.close(); store.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});

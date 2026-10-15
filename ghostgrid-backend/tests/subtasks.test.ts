import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { Engine } from "../src/execution/engine.js";
import { SessionService } from "../src/sessions/service.js";
import { createSubtaskRunner, leastLoaded, parseAssignment, parseAssignmentDetail } from "../src/office/subtasks.js";

describe("project subtasks", () => {
  /** A project with a lead and two engineers, the shape a subtask needs to be delegated at all. */
  async function project(answer: (prompt: string) => string = () => "ASSIGN: Maya\nChange the parser.") {
    const dir = await mkdtemp(join(tmpdir(), "ghostgrid-subtask-"));
    const store = new Store(":memory:");
    store.insert("projects", {
      id: "project", name: "Demo",
      officeProjects: [{ id: "ship", name: "Ship it", goal: "Ship the subtask routine" }],
    });
    store.insert("providers", { id: "provider", type: "mock", concurrency: 4 });
    store.insert("agents", { id: "agent", projectId: "project", providerId: "provider", buildingId: "claude", permissions: ["read"] });
    const seen: string[] = [];
    const engine = new Engine(
      store,
      { get: () => ({ executeTask: async (input: any) => { seen.push(input.prompt); return { output: answer(input.prompt) }; } }) },
      { artifactsDir: dir, allowedWorkspaces: [dir], concurrency: 4 },
    );
    const sessions = new SessionService(store, engine);
    const hire = (name: string, title: string, officeProjectId: string | null = "ship") =>
      sessions.create({ projectId: "project", agentId: "agent", name, title: title as any, team: "Platform", officeProjectId } as any);
    const lead = hire("Priya", "Team Lead");
    const maya = hire("Maya", "Engineer");
    const leo = hire("Leo", "Engineer");
    const runner = createSubtaskRunner(store, engine);
    const input = { projectId: "project", buildingId: "claude", officeProjectId: "ship", prompt: "Make the CSV import accept semicolons" };
    return {
      store, engine, sessions, runner, input, seen, hire,
      people: { lead, maya, leo },
      cleanup: async () => { await engine.stop(); store.close(); await rm(dir, { recursive: true, force: true }); },
    };
  }
  const waitFor = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The subtask did not settle");
  };

  it("sends the prompt to the lead, not to an engineer", async () => {
    const context = await project();
    try {
      const { runner, input, store, people } = context;
      const created = runner.create(input);
      expect(created.stage).toBe("delegating");
      expect(created.lead).toEqual({ sessionId: people.lead.id, name: "Priya" });
      // Nobody has been given the work yet: that is the lead's call.
      expect(created.engineer).toBeNull();
      expect(created.buildTaskId).toBeNull();
      const delegate = store.get("tasks", created.delegateTaskId!)!;
      expect(delegate.sessionId).toBe(people.lead.id);
      // The lead is told the goal and who is on their team, and asked for a machine-readable pick.
      expect(delegate.prompt).toContain("Goal: Ship the subtask routine");
      expect(delegate.prompt).toContain("Maya, Leo");
      expect(delegate.prompt).toContain("ASSIGN:");
      expect(delegate.prompt).toContain(input.prompt);
    } finally { await context.cleanup(); }
  });

  it("hands the work to the engineer the lead named, with the lead's brief attached", async () => {
    const context = await project();
    try {
      const { runner, input, store, engine, people, seen } = context;
      engine.start();
      const created = runner.create(input);
      await waitFor(() => runner.get(created.id).stage === "done");
      const done = runner.get(created.id);
      expect(done.engineer).toEqual({ sessionId: people.maya.id, name: "Maya" });
      expect(done.assignedByFallback).toBe(false);
      expect(done.delegation).toContain("Change the parser.");
      expect(done.result).toBeTruthy();
      // Two tasks, in order, the second on the first.
      const build = store.get("tasks", done.buildTaskId!)!;
      expect(build.sessionId).toBe(people.maya.id);
      expect(store.list("task_dependencies", { taskId: build.id })[0]?.dependsOnTaskId).toBe(done.delegateTaskId);
      // The engineer was handed the lead's words, which is the whole point of the two steps.
      const engineerPrompt = seen.find((prompt) => prompt.includes("Your lead Priya"))!;
      expect(engineerPrompt).toContain("Completed dependency outputs");
      expect(engineerPrompt).toContain("Change the parser.");
      // And each ran as its own employee, so each carried their own standing brief.
      expect(seen.some((prompt) => prompt.includes("Priya, Team Lead"))).toBe(true);
      expect(seen.some((prompt) => prompt.includes("Maya, Engineer"))).toBe(true);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("falls back to the least-loaded engineer when the lead names nobody, and says so", async () => {
    const context = await project(() => "I think Leo should maybe look at this, or Maya.");
    try {
      const { runner, input, engine } = context;
      engine.start();
      const created = runner.create(input);
      await waitFor(() => runner.get(created.id).stage === "done");
      const done = runner.get(created.id);
      expect(done.engineer).not.toBeNull();
      // The operator is told the pick was not the lead's, rather than it looking deliberate.
      expect(done.assignedByFallback).toBe(true);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("reads a lead's answer however they phrase the name", () => {
    const engineers = [
      { sessionId: "a", name: "Maya", title: "Engineer", team: "P", managerId: null, officeProjectId: "ship" },
      { sessionId: "b", name: "Leo", title: "Engineer", team: "P", managerId: null, officeProjectId: "ship" },
    ] as any;
    expect(parseAssignment("ASSIGN: Maya\nbrief", engineers)?.name).toBe("Maya");
    expect(parseAssignment("assign:   leo  \nbrief", engineers)?.name).toBe("Leo");
    expect(parseAssignment("ASSIGN: Maya (Engineer)", engineers)?.name).toBe("Maya");
    expect(parseAssignment("ASSIGN: Maya.", engineers)?.name).toBe("Maya");
    // A name nobody on the team has is not a pick.
    expect(parseAssignment("ASSIGN: Priya", engineers)).toBeNull();
    expect(parseAssignment("no assignment here", engineers)).toBeNull();
    expect(parseAssignment("", engineers)).toBeNull();
  });

  it("takes the lead's stated decision over scraping its prose, and carries its confidence", () => {
    const engineers = [
      { sessionId: "a", name: "Maya", title: "Engineer", team: "P", managerId: null, officeProjectId: "ship" },
      { sessionId: "b", name: "Leo", title: "Engineer", team: "P", managerId: null, officeProjectId: "ship" },
    ] as any;

    // The block is the lead deciding; the ASSIGN line above it is prose that happens to look
    // like a decision. A lead that states one has stated it, whatever the essay around it says.
    const both = [
      "ASSIGN: Maya",
      "On reflection this is Leo's, for the reasons above.",
      "```json",
      '{"tasks":[{"owner":"Leo","task":"Ship it","confidence":0.4}]}',
      "```",
    ].join("\n");
    const stated = parseAssignmentDetail(both, engineers);
    expect(stated.engineer?.name).toBe("Leo");
    expect(stated.stated).toBe(true);
    expect(stated.confidence).toBe(0.4);

    // A lead still answering in prose is read the old way and claims no particular confidence —
    // null-by-another-name, not a confident 1 that it never said.
    const scraped = parseAssignmentDetail("ASSIGN: Maya\nbrief", engineers);
    expect(scraped.engineer?.name).toBe("Maya");
    expect(scraped.stated).toBe(false);

    // A block naming somebody who does not work here falls through to the prose line rather
    // than failing the delegation outright.
    const stranger = parseAssignmentDetail(
      'ASSIGN: Maya\n```json\n{"tasks":[{"owner":"Priya","task":"x"}]}\n```',
      engineers,
    );
    expect(stranger.engineer?.name).toBe("Maya");
    expect(stranger.stated).toBe(false);

    // And the old entry point still answers the old question.
    expect(parseAssignment(both, engineers)?.name).toBe("Leo");
  });

  it("refuses a project it cannot delegate through", async () => {
    const context = await project();
    try {
      const { runner, input, store, people } = context;
      expect(() => runner.create({ ...input, prompt: "   " })).toThrow(/Say what the subtask is/);
      expect(() => runner.create({ ...input, officeProjectId: "nope" })).toThrow(/Unknown work stream/);
      expect(() => runner.create({ ...input, buildingId: "codex" })).toThrow(/no agent/);
      // Every engineer off the stream: nobody to hand it to.
      for (const id of [people.maya.id, people.leo.id]) store.update("sessions", id, { officeProjectId: "other" });
      expect(() => runner.create(input)).toThrow(/no engineer to delegate to/);
      // And with no lead either, there is nobody to decide.
      store.update("sessions", people.lead.id, { officeProjectId: "other" });
      expect(() => runner.create(input)).toThrow(/no lead to delegate through/);
    } finally { await context.cleanup(); }
  });

  it("lists a project's subtasks newest first and cancels one mid-flight", async () => {
    const context = await project(() => new Promise(() => {}) as unknown as string);
    try {
      const { runner, input, engine } = context;
      engine.start();
      const first = runner.create(input);
      const second = runner.create({ ...input, prompt: "Second piece of work" });
      const listed = runner.list("project", "claude", "ship");
      expect(listed.map((entry) => entry.id)).toEqual([second.id, first.id]);
      expect(runner.list("project", "claude", "other")).toEqual([]);
      const cancelled = runner.cancel(first.id);
      expect(cancelled.stage).toBe("cancelled");
      // Cancelling twice is not an error, and does not resurrect it.
      expect(runner.cancel(first.id).stage).toBe("cancelled");
      expect(() => runner.get("00000000-0000-4000-8000-000000000000")).toThrow(/not found/);
    } finally { await context.cleanup(); }
  }, 30_000);

  it("picks the engineer with the least on when it has to choose", async () => {
    const context = await project();
    try {
      const { store, people } = context;
      const engineers = [
        { sessionId: people.maya.id, name: "Maya" },
        { sessionId: people.leo.id, name: "Leo" },
      ] as any;
      store.insert("tasks", { projectId: "project", agentId: "agent", sessionId: people.maya.id, status: "running" });
      expect(leastLoaded(store, engineers).name).toBe("Leo");
      store.insert("tasks", { projectId: "project", agentId: "agent", sessionId: people.leo.id, status: "queued" });
      store.insert("tasks", { projectId: "project", agentId: "agent", sessionId: people.leo.id, status: "queued" });
      expect(leastLoaded(store, engineers).name).toBe("Maya");
      // Finished work does not count against anyone.
      store.insert("tasks", { projectId: "project", agentId: "agent", sessionId: people.maya.id, status: "completed" });
      expect(leastLoaded(store, engineers).name).toBe("Maya");
    } finally { await context.cleanup(); }
  });
});

// The chain the office is built around: the operator talks to a lead, the lead delegates to its
// engineers, an engineer may hire an intern, and nobody talks to the intern but that engineer.
// These tests hold the four rules that make it a chain rather than a pile of sessions.
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { streamLog } from "../src/office/activityLog.js";

/** One project with one office building and the mock provider behind it. */
async function office() {
  const root = await mkdtemp(join(tmpdir(), "ghostgrid-staffing-"));
  const store = new Store(join(root, "db.sqlite"));
  const project = store.insert("projects", { name: "Demo", officeProjects: [] });
  const provider = store.insert("providers", { type: "mock", concurrency: 2 });
  const agent = store.insert("agents", {
    projectId: project.id, providerId: provider.id, buildingId: "claude",
    workspace: root, permissions: ["read"],
  });
  const built = await buildApp({
    store,
    config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
    startWorker: false, logger: false,
  });
  const base = { projectId: project.id, buildingId: "claude" };
  // `inject`'s own return type is an intersection of a promise and a chainable builder, which
  // does not survive being passed through a helper, so the shape these tests actually read is
  // stated once here rather than casting at every call.
  type Reply = { statusCode: number; json: () => any };
  const inject = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
    built.app.inject({ method, url, payload } as never) as unknown as Promise<Reply>;
  const post = (url: string, payload?: unknown) => inject("POST", url, payload);
  const get = (url: string) => inject("GET", url);
  const patch = (url: string, payload: unknown) => inject("PATCH", url, payload);
  /** Create a staffed stream and return the two people on it. */
  const stream = async (name: string, goal = "Ship it") => {
    const made = await post("/api/v1/office/projects", { ...base, name, goal });
    expect(made.statusCode).toBe(201);
    return made.json();
  };
  return {
    store, project, agent, app: built.app, base, post, get, patch, stream,
    cleanup: async () => {
      await built.app.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("a work stream arrives staffed", () => {
  it("hires one lead and one engineer, with the engineer reporting to the lead", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      expect(made.id).toBe("ship-it");
      const { lead, engineers, hired } = made.staff;
      expect(lead.title).toBe("Team Lead");
      expect(lead.roleKind).toBe("lead");
      expect(engineers).toHaveLength(1);
      expect(engineers[0].title).toBe("Engineer");
      // The whole point of the pair: the engineer takes work from the lead.
      expect(engineers[0].managerId).toBe(lead.sessionId);
      // Both were created by this call, and both sit on the stream and on its team.
      expect(hired.map((person: any) => person.sessionId).sort())
        .toEqual([lead.sessionId, engineers[0].sessionId].sort());
      for (const person of [lead, engineers[0]]) {
        const session = office_.store.get("sessions", person.sessionId);
        expect(session?.officeProjectId).toBe("ship-it");
        expect(session?.team).toBe("Ship It");
        // The brief is what makes them behave as the job; it must name the stream they are on.
        expect(session?.brief).toContain("Ship It");
      }
      // Nobody is given two names.
      expect(lead.name).not.toBe(engineers[0].name);
    } finally { await office_.cleanup(); }
  });

  it("gives each stream its own pair, and leaves an unstaffed stream empty when asked", async () => {
    const office_ = await office();
    try {
      const first = await office_.stream("Alpha");
      const second = await office_.stream("Beta");
      const names = [first, second].flatMap((made) => [made.staff.lead.name, ...made.staff.engineers.map((e: any) => e.name)]);
      // Four distinct people: a lead is not shared between streams.
      expect(new Set(names).size).toBe(4);
      expect(first.staff.lead.sessionId).not.toBe(second.staff.lead.sessionId);

      const bare = await office_.post("/api/v1/office/projects", { ...office_.base, name: "Gamma", staff: false });
      expect(bare.json().staff).toBeNull();
      const log = await office_.get(`/api/v1/office/log?projectId=${office_.project.id}&buildingId=claude&officeProjectId=gamma`);
      expect(log.json().staff).toEqual([]);
    } finally { await office_.cleanup(); }
  });

  it("is idempotent on the lead: staffing a stream twice does not give it two", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      // The route uniquifies stream names, so re-staffing is exercised through the module the
      // route calls. Two leads on one stream is the failure that matters: subtasks.ts resolves
      // "the lead" to the first one and the second would silently never be given anything.
      const { staffStream } = await import("../src/office/staffing.js");
      const { SessionService } = await import("../src/sessions/service.js");
      const { Engine } = await import("../src/execution/engine.js");
      const engine = new Engine(office_.store, { get: () => ({ executeTask: async () => ({ output: "ok" }) }) } as any, { concurrency: 1 } as any);
      const sessions = new SessionService(office_.store, engine);
      const again = staffStream(office_.store, sessions, {
        projectId: office_.project.id, buildingId: "claude", officeProjectId: "ship-it", streamName: "Ship It",
      });
      expect(again.hired).toEqual([]);
      expect(again.lead.sessionId).toBe(made.staff.lead.sessionId);
      expect(again.engineers.map((e) => e.sessionId)).toEqual([made.staff.engineers[0].sessionId]);
      await engine.stop();
    } finally { await office_.cleanup(); }
  });
});

describe("engineers are the unbounded role", () => {
  it("hires as many as asked, all reporting to the one lead", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      const hires = [];
      for (let index = 0; index < 5; index++) {
        const reply = await office_.post("/api/v1/office/engineers", {
          ...office_.base, officeProjectId: "ship-it",
        });
        expect(reply.statusCode).toBe(201);
        hires.push(reply.json());
      }
      expect(hires.every((hire) => hire.roleKind === "build")).toBe(true);
      expect(hires.every((hire) => hire.managerId === made.staff.lead.sessionId)).toBe(true);
      expect(new Set(hires.map((hire) => hire.name)).size).toBe(5);
      const log = await office_.get(`/api/v1/office/log?projectId=${office_.project.id}&buildingId=claude&officeProjectId=ship-it`);
      // One lead, six engineers: the five hired here plus the one the stream came with.
      const kinds = log.json().staff.map((person: any) => person.roleKind);
      expect(kinds.filter((kind: string) => kind === "lead")).toHaveLength(1);
      expect(kinds.filter((kind: string) => kind === "build")).toHaveLength(6);
    } finally { await office_.cleanup(); }
  });

  it("takes a chosen name, and refuses one already in the office", async () => {
    const office_ = await office();
    try {
      await office_.stream("Ship It");
      const named = await office_.post("/api/v1/office/engineers", { ...office_.base, officeProjectId: "ship-it", name: "Sasha" });
      expect(named.json().name).toBe("Sasha");
      const twice = await office_.post("/api/v1/office/engineers", { ...office_.base, officeProjectId: "ship-it", name: "Sasha" });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().error.message).toMatch(/already works in this office/);
    } finally { await office_.cleanup(); }
  });

  it("refuses to hire onto a stream with no lead, because the hire would have nobody to work for", async () => {
    const office_ = await office();
    try {
      await office_.post("/api/v1/office/projects", { ...office_.base, name: "Gamma", staff: false });
      const orphan = await office_.post("/api/v1/office/engineers", { ...office_.base, officeProjectId: "gamma" });
      expect(orphan.statusCode).toBe(409);
      expect(orphan.json().error.message).toMatch(/nobody to delegate/);
    } finally { await office_.cleanup(); }
  });

  it("accepts a manager as the delegate, because that is who subtasks fall back to", async () => {
    const office_ = await office();
    try {
      await office_.post("/api/v1/office/projects", { ...office_.base, name: "Gamma", staff: false });
      // A stream run by a manager with no lead is a shape `subtasks.ts` already handles: it
      // delegates through whoever plans when nobody leads. Refusing the hire here while the
      // delegation path accepts it would have left that stream unable to grow.
      const manager = (await office_.post("/api/v1/sessions", {
        projectId: office_.project.id, agentId: office_.agent.id, name: "Morgan",
        title: "Manager", team: "Gamma", officeProjectId: "gamma",
      })).json();
      const hired = await office_.post("/api/v1/office/engineers", { ...office_.base, officeProjectId: "gamma" });
      expect(hired.statusCode).toBe(201);
      expect(hired.json().managerId).toBe(manager.id);
    } finally { await office_.cleanup(); }
  });
});

describe("a lead cannot leave the stream it leads", () => {
  it("refuses the move, and still allows an engineer to be moved", async () => {
    const office_ = await office();
    try {
      const first = await office_.stream("Alpha");
      await office_.stream("Beta");
      const patch = (id: string, payload: unknown) => office_.patch(`/api/v1/sessions/${id}`, payload);

      const moved = await patch(first.staff.lead.sessionId, { officeProjectId: "beta" });
      expect(moved.statusCode).toBe(409);
      expect(moved.json().error.message).toMatch(/cannot be moved to another work stream/);
      expect(office_.store.get("sessions", first.staff.lead.sessionId)?.officeProjectId).toBe("alpha");

      // Benching a lead is the same move with no destination, and is refused for the same reason.
      expect((await patch(first.staff.lead.sessionId, { officeProjectId: null })).statusCode).toBe(409);
      // Demoting and moving in one call is still moving a lead.
      expect((await patch(first.staff.lead.sessionId, { title: "Engineer", officeProjectId: "beta" })).statusCode).toBe(409);

      // An engineer is free to move: only the lead is pinned.
      const engineer = first.staff.engineers[0].sessionId;
      expect((await patch(engineer, { officeProjectId: "beta" })).statusCode).toBe(200);
      expect(office_.store.get("sessions", engineer)?.officeProjectId).toBe("beta");
      // And a patch that does not touch the stream passes for a lead.
      expect((await patch(first.staff.lead.sessionId, { briefNotes: "Keep the diffs small." })).statusCode).toBe(200);
    } finally { await office_.cleanup(); }
  });
});

describe("the operator talks to leads and engineers, never to an intern", () => {
  it("refuses a message to an intern and names the engineer to send it to instead", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      const engineer = made.staff.engineers[0];
      const intern = await office_.post("/api/v1/office/interns", {
        ...office_.base, engineerSessionId: engineer.sessionId, name: "Robin", task: "Rename the helper",
      });
      expect(intern.statusCode).toBe(201);

      const blocked = await office_.post(`/api/v1/sessions/${intern.json().intern.sessionId}/messages`, { prompt: "status?" });
      expect(blocked.statusCode).toBe(409);
      const said = blocked.json().error.message;
      expect(said).toMatch(/Robin is an intern/);
      expect(said).toContain(engineer.name);

      // The two the operator may address both accept one.
      for (const person of [made.staff.lead, engineer])
        expect((await office_.post(`/api/v1/sessions/${person.sessionId}/messages`, { prompt: "status?" })).statusCode).toBe(202);
    } finally { await office_.cleanup(); }
  });

  it("refuses an intern hiring anyone, so the office has a bottom", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      const intern = (await office_.post("/api/v1/office/interns", {
        ...office_.base, engineerSessionId: made.staff.engineers[0].sessionId,
      })).json().intern;
      const recursive = await office_.post("/api/v1/office/interns", {
        ...office_.base, engineerSessionId: intern.sessionId,
      });
      expect(recursive.statusCode).toBe(409);
      // A lead cannot hire one either: that would be implementing through the back door.
      const byLead = await office_.post("/api/v1/office/interns", {
        ...office_.base, engineerSessionId: made.staff.lead.sessionId,
      });
      expect(byLead.statusCode).toBe(409);
      expect(byLead.json().error.message).toMatch(/Only an engineer can hire an intern/);
    } finally { await office_.cleanup(); }
  });
});

describe("the stream log", () => {
  it("reports who is on the stream, what each is doing, and the history newest first", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      const engineer = made.staff.engineers[0];
      await office_.post("/api/v1/office/interns", {
        ...office_.base, engineerSessionId: engineer.sessionId, name: "Robin", task: "Rename the helper",
      });
      await office_.post(`/api/v1/sessions/${made.staff.lead.sessionId}/messages`, { prompt: "Plan the release", title: "Release plan" });

      const log = (await office_.get(
        `/api/v1/office/log?projectId=${office_.project.id}&buildingId=claude&officeProjectId=ship-it`,
      )).json();
      // Seniority order, so the roster reads top-down.
      expect(log.staff.map((person: any) => person.roleKind)).toEqual(["lead", "build", "intern"]);
      const [lead, eng, robin] = log.staff as { name: string; roleKind: string; managerName: string | null; talkable: boolean; doing: string }[];
      expect(lead.managerName).toBeNull();
      expect(eng.managerName).toBe(lead.name);
      // An intern reports to their engineer, not to the lead.
      expect(robin.managerName).toBe(eng.name);
      // The contract the chat obeys: only the intern is off limits.
      expect([lead.talkable, eng.talkable, robin.talkable]).toEqual([true, true, false]);
      // Each line says what that person is on, drawn from their newest unsettled task.
      expect(lead.doing).toMatch(/Release plan/);
      expect(robin.doing).toMatch(/Intern task/);
      expect(eng.doing).toBe("no work yet");

      expect(log.entries).toHaveLength(2);
      expect(log.total).toBe(2);
      // Newest first.
      expect(log.entries[0].at >= log.entries[1].at).toBe(true);
      const byWho = new Map<string, { summary: string; roleKind: string }>(
        log.entries.map((entry: any) => [entry.who as string, entry]));
      expect(byWho.get(lead.name)?.summary).toBe("Plan the release");
      expect(byWho.get("Robin")?.roleKind).toBe("intern");
      expect(byWho.get("Robin")?.summary).toContain("You are Robin");
    } finally { await office_.cleanup(); }
  });

  it("scopes to one stream, clips to the limit while still reporting the total, and reads the whole building when no stream is named", async () => {
    const office_ = await office();
    try {
      const alpha = await office_.stream("Alpha");
      const beta = await office_.stream("Beta");
      for (let index = 0; index < 4; index++)
        await office_.post(`/api/v1/sessions/${alpha.staff.lead.sessionId}/messages`, { prompt: `alpha ${index}`, title: `A${index}` });
      await office_.post(`/api/v1/sessions/${beta.staff.lead.sessionId}/messages`, { prompt: "beta work", title: "B0" });

      const url = (query: string) => `/api/v1/office/log?projectId=${office_.project.id}&buildingId=claude&${query}`;
      const onlyAlpha = (await office_.get(url("officeProjectId=alpha"))).json();
      expect(onlyAlpha.officeProjectId).toBe("alpha");
      expect(onlyAlpha.total).toBe(4);
      expect(onlyAlpha.entries.every((entry: any) => entry.who === alpha.staff.lead.name)).toBe(true);

      const clipped = (await office_.get(url("officeProjectId=alpha&limit=2"))).json();
      expect(clipped.entries).toHaveLength(2);
      // The total is what the feed was clipped from, so the UI can say so.
      expect(clipped.total).toBe(4);

      const building = (await office_.get(url("limit=500"))).json();
      expect(building.officeProjectId).toBeNull();
      expect(building.total).toBe(5);
      expect(building.staff).toHaveLength(4);
    } finally { await office_.cleanup(); }
  });

  it("says plainly when work failed rather than reporting it as finished", async () => {
    const office_ = await office();
    try {
      const made = await office_.stream("Ship It");
      const lead = made.staff.lead.sessionId;
      const task = office_.store.insert("tasks", {
        projectId: office_.project.id, agentId: office_.agent.id, sessionId: lead,
        title: "Broken thing", prompt: "do it", status: "failed",
        createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), error: "provider refused",
      });
      const log = streamLog(office_.store, {
        projectId: office_.project.id, buildingId: "claude", officeProjectId: "ship-it", limit: 50,
      });
      const person = log.staff.find((entry) => entry.sessionId === lead)!;
      expect(person.doing).toBe("failed: Broken thing");
      const row = log.entries.find((entry) => entry.id === task.id)!;
      expect(row.status).toBe("failed");
      expect(row.error).toBe("provider refused");
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    } finally { await office_.cleanup(); }
  });
});

describe("the roles editor can save every kind it offers", () => {
  it("accepts intern as a role kind on create and on update", async () => {
    const office_ = await office();
    try {
      const made = await office_.post("/api/v1/office/roles", {
        projectId: office_.project.id, name: "Research Intern", kind: "intern", rank: -1,
        remit: ["You help one engineer."], answer: ["Say what you did."],
      });
      expect(made.statusCode).toBe(201);
      expect(made.json().kind).toBe("intern");
      const patched = await office_.patch(`/api/v1/office/roles/${made.json().id}`,
        { projectId: office_.project.id, kind: "build" });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().kind).toBe("build");
    } finally { await office_.cleanup(); }
  });
});

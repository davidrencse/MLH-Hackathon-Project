// Roles are the office's job descriptions, editable and extensible (src/office/roles.ts). These
// tests hold the two properties the feature stands on: an edited role reaches the stored brief of
// everyone holding it, and the orchestration graph follows a role's *kind*, not its name — which
// is what lets a job the operator invented take part in a run.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { buildPlan } from "../src/office/orchestrator.js";
import { composeBrief } from "../src/office/brief.js";
import { defaultRoles, juniorRole, ladderStep, listRoles, resolveRole } from "../src/office/roles.js";

async function office() {
  const store = new Store(":memory:");
  const projectId = randomUUID();
  const providerId = randomUUID();
  const agentId = randomUUID();
  store.insert("projects", {
    id: projectId,
    name: "Office",
    officeProjects: [{ id: "atlas", name: "Atlas", goal: "Ship the roles editor" }],
  });
  store.insert("providers", { id: providerId, type: "mock", name: "Mock", concurrency: 2 });
  store.insert("agents", {
    id: agentId,
    projectId,
    providerId,
    buildingId: "claude",
    permissions: ["read"],
  });
  const f = await buildApp({
    store,
    config: loadConfig({ GHOSTGRID_DATABASE_PATH: ":memory:" }),
    logger: false,
    startWorker: false,
  });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    f.app.inject({ method, url, payload: payload as Record<string, unknown> });
  const hire = async (name: string, title: string, extra: Record<string, unknown> = {}) => {
    const response = await call("POST", "/api/v1/sessions", {
      projectId,
      agentId,
      name,
      title,
      team: "Core",
      officeProjectId: "atlas",
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  return { store, projectId, agentId, f, call, hire };
}

describe("office roles", () => {
  it("serves the default roles with holder counts, kinds and presets", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      await hire("Ada", "Engineer");
      const response = await call("GET", `/api/v1/office/roles?projectId=${projectId}`);
      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Lead Engineer ships as a default because it is who the operator's prompt reaches first;
      // Team Lead stays beside it for offices that already staffed one.
      expect(body.items.map((role: { id: string }) => role.id)).toEqual([
        "manager",
        "team-lead",
        "lead-engineer",
        "engineer",
        // Last, and off the promotion ladder: an intern is hired by one engineer for one piece
        // of work, never handed to an employee who simply arrived without a title.
        "intern",
      ]);
      expect(body.items.find((role: { id: string }) => role.id === "engineer").holders).toBe(1);
      expect(body.items.find((role: { id: string }) => role.id === "manager").holders).toBe(0);
      expect(body.kinds.map((entry: { kind: string }) => entry.kind)).toEqual([
        "manage",
        "lead",
        "build",
        "intern",
      ]);
      expect(body.presets.length).toBeGreaterThan(0);
      // The defaults are not written until something is edited, so the project record stays clean.
      expect(body.items[0].builtIn).toBe(true);
    } finally {
      await f.app.close();
    }
  });

  it("puts a custom role's own remit into the brief of whoever holds it", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      const created = await call("POST", "/api/v1/office/roles", {
        projectId,
        name: "Staff Engineer",
        kind: "lead",
        rank: 1,
        remit: ["You own the approach for two teams at once."],
        answer: ["Lead with the decision, then the steps."],
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().id).toBe("staff-engineer");

      const employee = await hire("Grace", "Staff Engineer");
      expect(employee.title).toBe("Staff Engineer");
      expect(employee.brief).toContain("a Staff Engineer on the Core team");
      expect(employee.brief).toContain("You own the approach for two teams at once.");
      expect(employee.brief).toContain("## Your remit as Staff Engineer");
      expect(employee.brief).toContain("Lead with the decision, then the steps.");
      // The job it replaced is not silently mixed in.
      expect(employee.brief).not.toContain("You implement one task at a time");
    } finally {
      await f.app.close();
    }
  });

  it("refuses a job title no role defines", async () => {
    const { projectId, agentId, call, f } = await office();
    try {
      const response = await call("POST", "/api/v1/sessions", {
        projectId,
        agentId,
        name: "Nobody",
        title: "Chief Vibes Officer",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain("Chief Vibes Officer");
    } finally {
      await f.app.close();
    }
  });

  it("rebuilds the briefs of everyone holding a role when its prompt is edited", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      const ada = await hire("Ada", "Engineer");
      const linus = await hire("Linus", "Engineer");
      const patch = await call("PATCH", "/api/v1/office/roles/engineer", {
        projectId,
        remit: ["You write tests before the change, every time."],
      });
      expect(patch.statusCode, patch.body).toBe(200);
      expect(patch.json().rebriefed).toBe(2);
      expect(patch.json().renamedFrom).toBeNull();
      for (const id of [ada.id, linus.id]) {
        const session = await call("GET", `/api/v1/sessions/${id}`);
        expect(session.json().brief).toContain("You write tests before the change, every time.");
        expect(session.json().brief).not.toContain("You implement one task at a time");
      }
    } finally {
      await f.app.close();
    }
  });

  it("re-briefs an employee who never had a title, since they resolve to the junior role", async () => {
    const { projectId, agentId, call, f } = await office();
    try {
      // A session created without org fields: the office describes them as the most junior role
      // everywhere, so an edit to that role has to reach them too.
      const plain = await call("POST", "/api/v1/sessions", { projectId, agentId, name: "Untitled" });
      expect(plain.statusCode, plain.body).toBe(201);
      expect(plain.json().title).toBe("Engineer");
      const catalog = await call("GET", `/api/v1/office/roles?projectId=${projectId}`);
      expect(catalog.json().items.find((role: { id: string }) => role.id === "engineer").holders).toBe(1);
      const patch = await call("PATCH", "/api/v1/office/roles/engineer", {
        projectId,
        remit: ["You never claim a test passed without printing its output."],
      });
      expect(patch.json().rebriefed).toBe(1);
      const session = await call("GET", `/api/v1/sessions/${plain.json().id}`);
      expect(session.json().brief).toContain("You never claim a test passed");
    } finally {
      await f.app.close();
    }
  });

  it("carries a renamed role across to its holders' titles and briefs", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      const ada = await hire("Ada", "Engineer");
      const patch = await call("PATCH", "/api/v1/office/roles/engineer", {
        projectId,
        name: "Software Engineer",
      });
      expect(patch.statusCode, patch.body).toBe(200);
      expect(patch.json().renamedFrom).toBe("Engineer");
      expect(patch.json().rebriefed).toBe(1);
      const session = await call("GET", `/api/v1/sessions/${ada.id}`);
      expect(session.json().title).toBe("Software Engineer");
      expect(session.json().brief).toContain("a Software Engineer on the Core team");
      // The id is stable across the rename, so the role keeps its URL.
      expect(patch.json().id).toBe("engineer");
    } finally {
      await f.app.close();
    }
  });

  it("moves staff to a surviving role when theirs is deleted", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      await call("POST", "/api/v1/office/roles", {
        projectId,
        name: "Intern",
        kind: "build",
        rank: -1,
        remit: ["You take the smallest task on the board and finish it."],
        answer: ["Say what you ran and what it printed."],
      });
      const kim = await hire("Kim", "Intern");
      const deleted = await call("DELETE", `/api/v1/office/roles/intern?projectId=${projectId}`);
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toEqual({ movedTo: "Engineer", moved: 1 });
      const session = await call("GET", `/api/v1/sessions/${kim.id}`);
      expect(session.json().title).toBe("Engineer");
      expect(session.json().brief).toContain("You implement one task at a time");
    } finally {
      await f.app.close();
    }
  });

  it("promotes and demotes one rung of the ladder and rebuilds the brief", async () => {
    const { call, hire, f } = await office();
    try {
      const ada = await hire("Ada", "Engineer");
      const up = await call("POST", `/api/v1/office/employees/${ada.id}/promote`);
      expect(up.statusCode, up.body).toBe(200);
      expect(up.json()).toMatchObject({ from: "Engineer", to: "Team Lead", direction: "promote" });
      expect(up.json().employee.brief).toContain("a Team Lead on the Core team");
      expect(up.json().employee.brief).toContain("You own the technical approach");

      const again = await call("POST", `/api/v1/office/employees/${ada.id}/promote`);
      expect(again.json().to).toBe("Manager");
      const top = await call("POST", `/api/v1/office/employees/${ada.id}/promote`);
      expect(top.statusCode).toBe(409);
      expect(top.json().error.message).toContain("most senior");

      const down = await call("POST", `/api/v1/office/employees/${ada.id}/demote`);
      expect(down.json()).toMatchObject({ from: "Manager", to: "Team Lead" });
    } finally {
      await f.app.close();
    }
  });

  it("builds the orchestration graph from role kind, not from job title", async () => {
    const { store, projectId, call, hire, f } = await office();
    try {
      for (const role of [
        { name: "Principal", kind: "manage", rank: 5 },
        { name: "Tech Lead", kind: "lead", rank: 3 },
        { name: "Builder", kind: "build", rank: 1 },
      ] as const) {
        const response = await call("POST", "/api/v1/office/roles", {
          projectId,
          ...role,
          remit: [`${role.name} remit line.`],
          answer: [`${role.name} answer line.`],
        });
        expect(response.statusCode, response.body).toBe(201);
      }
      const boss = await hire("Mina", "Principal");
      const lead = await hire("Omar", "Tech Lead", { managerId: boss.id });
      await hire("Yuki", "Builder", { managerId: lead.id });

      const plan = buildPlan(store, { projectId, buildingId: "claude", officeProjectId: "atlas" });
      expect(plan.nodes.map((node) => node.stage)).toEqual([
        "plan",
        "design",
        "build",
        "review",
        "signoff",
      ]);
      expect(plan.nodes.find((node) => node.stage === "plan")?.employeeName).toBe("Mina");
      expect(plan.nodes.find((node) => node.stage === "build")?.employeeName).toBe("Yuki");
      // The plan as well as the approach: an engineer is given the why and the order, not only
      // the section addressed to them.
      expect(plan.nodes.find((node) => node.stage === "build")?.dependsOn).toEqual([
        "plan",
        `design-${lead.sessionId ?? lead.id}`,
      ]);
      expect(plan.staff.map((person) => person.roleKind).sort()).toEqual([
        "build",
        "lead",
        "manage",
      ]);
      expect(plan.warnings).toEqual([]);
    } finally {
      await f.app.close();
    }
  });

  it("warns, rather than throwing, when the org has no implementer on a stream", async () => {
    const { store, projectId, call, hire, f } = await office();
    try {
      await hire("Mina", "Manager");
      void projectId;
      void call;
      const plan = buildPlan(store, { projectId, buildingId: "claude", officeProjectId: "atlas" });
      expect(plan.nodes.map((node) => node.stage)).toEqual(["plan"]);
      expect(plan.warnings.join(" ")).toContain("holds an implementing role");
    } finally {
      await f.app.close();
    }
  });
});

describe("role helpers", () => {
  it("steps the nearest rung in each direction and stops at the ends", () => {
    const roles = defaultRoles();
    expect(ladderStep(roles, "Engineer", "promote")?.name).toBe("Team Lead");
    expect(ladderStep(roles, "Manager", "promote")).toBeNull();
    expect(ladderStep(roles, "Engineer", "demote")).toBeNull();
    // A gap in the ladder is still one rung at a time.
    const sparse = [...roles, { ...roles[2]!, id: "intern", name: "Intern", rank: -5 }];
    expect(ladderStep(sparse, "Team Lead", "demote")?.name).toBe("Engineer");
    expect(ladderStep(sparse, "Engineer", "demote")?.name).toBe("Intern");
  });

  it("resolves a title by name or id and falls back to the most junior role", () => {
    const roles = defaultRoles();
    expect(resolveRole(roles, "team lead").id).toBe("team-lead");
    expect(resolveRole(roles, "team-lead").id).toBe("team-lead");
    expect(resolveRole(roles, "Nonexistent").id).toBe("engineer");
    expect(resolveRole(roles, undefined).id).toBe("engineer");
  });

  it("lets an engineer hire an intern, refuses anyone else, and keeps them out of the run", async () => {
    const { projectId, call, hire, f } = await office();
    try {
      await hire("Mina", "Manager");
      const lead = await hire("Kai", "Team Lead");
      const engineer = await hire("Yuki", "Engineer", { managerId: lead.id });

      const hired = await call("POST", "/api/v1/office/interns", {
        projectId, buildingId: "claude", engineerSessionId: engineer.id, task: "Write the fixture.",
      });
      expect(hired.statusCode, hired.body).toBe(201);
      // Named after, staffed with and reporting to the engineer who hired them — none of which
      // the caller had to supply.
      expect(hired.json().intern).toMatchObject({ name: "Yuki's intern", engineerName: "Yuki", team: "Core" });
      expect(hired.json().task).toBeTruthy();

      // A lead that could hire its own helper would be implementing through the back door.
      const refused = await call("POST", "/api/v1/office/interns", {
        projectId, buildingId: "claude", engineerSessionId: lead.id,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.message).toMatch(/Only an engineer can hire an intern/);

      const staff = (await call("GET", `/api/v1/office/staff?projectId=${projectId}&buildingId=claude`)).json().items;
      const intern = staff.find((person: { roleKind: string }) => person.roleKind === "intern");
      expect(intern.managerId).toBe(engineer.id);

      // The orchestrator plans for the team, not for an engineer's own helper: an intern takes
      // work from the engineer who hired them, and never gets a node of their own.
      const plan = (await call("POST", "/api/v1/office/orchestrate/plan", {
        projectId, buildingId: "claude", officeProjectId: "atlas", goal: "Ship it.",
      })).json();
      expect(plan.nodes.map((node: { employeeName: string }) => node.employeeName)).not.toContain(intern.name);
    } finally {
      await f.app.close();
    }
  });

  it("keeps interns off the ladder: they are hired, never fallen into", () => {
    const store = new Store(":memory:");
    const projectId = randomUUID();
    store.insert("projects", { id: projectId, name: "Fresh" });
    const roles = listRoles(store, projectId);
    // An employee with no title is a new hire, which is the most junior role *on the ladder*.
    // Intern has a lower rank than Engineer, so a plain rank sort would have made every
    // untitled employee somebody's intern, reporting to an engineer nobody chose.
    expect(resolveRole(roles, undefined).name).toBe("Engineer");
    expect(juniorRole(roles).name).toBe("Engineer");
    // And nobody is promoted or demoted into one.
    expect(ladderStep(roles, "Engineer", "demote")).toBeNull();
    expect(ladderStep(roles, "Intern", "promote")?.name).not.toBe("Intern");
  });

  it("reads back defaults for a project that has never edited its roles", () => {
    const store = new Store(":memory:");
    const projectId = randomUUID();
    store.insert("projects", { id: projectId, name: "Fresh" });
    expect(listRoles(store, projectId).map((role) => role.name)).toEqual([
      "Manager",
      "Team Lead",
      "Lead Engineer",
      "Engineer",
      "Intern",
    ]);
  });

  it("composes a brief from whatever role it is handed", () => {
    const brief = composeBrief({
      employeeName: "Ada",
      role: { name: "Reviewer", remit: ["You review work you did not write."], answer: ["One finding per line."] },
      team: "Core",
      buildingName: "claude",
      providerType: "claude",
    });
    expect(brief).toContain("# Role brief — Ada, Reviewer, Core team");
    expect(brief).toContain("## Your remit as Reviewer\n- You review work you did not write.");
    expect(brief).toContain("## How to answer\n- One finding per line.");
    expect(brief).toContain("running on the claude provider");
    // The sentence has to scan for a title the operator typed, whatever letter it starts with.
    expect(brief).toContain("Ada, a Reviewer on the Core team");
    expect(composeBrief({
      employeeName: "Ada",
      role: { name: "Engineer", remit: ["x"], answer: ["y"] },
      team: "Core",
      buildingName: "claude",
    })).toContain("Ada, an Engineer on the Core team");
  });
});

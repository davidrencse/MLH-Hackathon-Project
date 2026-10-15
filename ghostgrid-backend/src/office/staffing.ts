// Why: a work stream used to be created empty. The operator then had to hire a lead, hire an
// engineer, set two reporting lines and assign both to the stream before a single subtask could
// run — and a stream that was one step short of that failed at run time with a warning instead
// of at creation time with a fix. A stream now arrives with the two people it cannot work
// without: one lead to delegate, one engineer to implement.
//
// Three rules shape everything here, and they are the whole reason this is not just two inserts.
//
// 1. **One lead per stream.** The lead is the stream's single point of delegation (subtasks.ts
//    looks for exactly one), so staffing is idempotent on that: if a lead is already on the
//    stream, it is reused and never duplicated. Two agents creating the same stream concurrently
//    therefore converge rather than producing two leads who each think they own it.
// 2. **A lead is pinned to its stream.** `assertLeadStaysPut` refuses to move a lead to another
//    stream or off staffing entirely. An engineer can be moved freely; a lead cannot, because
//    every engineer under them, and every subtask addressed to the stream, resolves through them.
// 3. **Engineers are unbounded.** `hireEngineer` can be called any number of times and each hire
//    reports to the stream's lead.
import type { Entity, Store } from "../db/store.js";
import type { SessionService } from "../sessions/service.js";
import { listRoles, resolveRole, type OfficeRole, type RoleKind } from "./roles.js";
import { officeEmployees, type OfficeEmployee } from "./orchestrator.js";

const fail: (message: string, statusCode?: number) => never = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

/**
 * First names for auto-hired staff, so a new stream reads as people rather than as "Lead 1".
 * Short and gender-neutral: the lead's name is written into every brief and quoted back by the
 * engineer, and a name the model has to spell is a name it gets wrong.
 */
const NAME_POOL = [
  "Ada", "Bo", "Cass", "Dev", "Eli", "Fay", "Gil", "Hana", "Ira", "Jo",
  "Kit", "Lena", "Milo", "Nori", "Omar", "Pia", "Quinn", "Rhea", "Sol", "Tove",
  "Uri", "Vik", "Wren", "Xan", "Yara", "Zeno",
];

/** The most senior role of one kind, which is the one an auto-hire should get. */
export function roleOfKind(roles: OfficeRole[], kind: RoleKind): OfficeRole {
  const found = [...roles].filter((role) => role.kind === kind).sort((left, right) => right.rank - left.rank)[0];
  if (!found)
    fail(`This office has no role that ${kind === "lead" ? "leads" : "implements"}. Add one in Roles before staffing a stream.`, 409);
  return found;
}

/** A name nobody in this office holds yet. Falls back to a numbered one when the pool runs out. */
function freeName(taken: Set<string>, fallback: string): string {
  for (const name of NAME_POOL) if (!taken.has(name.toLowerCase())) return name;
  for (let suffix = 2; suffix < 500; suffix++) {
    const candidate = `${fallback} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return fail("This office has too many employees to name another", 409);
}

export interface StaffStreamInput {
  projectId: string;
  buildingId: string;
  officeProjectId: string;
  /** The stream's name, which becomes the team both hires sit on. */
  streamName: string;
}

/** Somebody this call created, reported back so the operator can see who turned up. */
export interface Hire {
  sessionId: string;
  name: string;
  title: string;
  roleKind: RoleKind;
  managerId: string | null;
}

export interface StaffedStream {
  lead: Hire | OfficeEmployee;
  engineers: (Hire | OfficeEmployee)[];
  /** Only the people this call hired. Empty when the stream was already staffed. */
  hired: Hire[];
}

const asHire = (person: OfficeEmployee): Hire => ({
  sessionId: person.sessionId,
  name: person.name,
  title: person.title,
  roleKind: person.roleKind,
  managerId: person.managerId,
});

function building(store: Store, projectId: string, buildingId: string) {
  const agent = store.list("agents", { projectId, buildingId })[0];
  if (!agent)
    fail("That building has no agent yet. Build it in the city before staffing an office.", 404);
  return agent;
}

/**
 * Give a stream the lead and engineer it needs to run, and return who is on it.
 *
 * Idempotent by role kind rather than by name: called twice it hires nobody the second time.
 * That matters because the stream-creation route calls it, and a retried POST must not leave a
 * stream with two leads — the second would be invisible to `subtasks.ts`, which takes the first.
 */
export function staffStream(
  store: Store,
  sessions: SessionService,
  input: StaffStreamInput,
): StaffedStream {
  const agent = building(store, input.projectId, input.buildingId);
  const roles = listRoles(store, input.projectId);
  const everyone = officeEmployees(store, input.projectId, input.buildingId);
  const onStream = everyone.filter((person) => person.officeProjectId === input.officeProjectId);
  const team = input.streamName.trim().slice(0, 80) || "General";
  const taken = new Set(everyone.map((person) => person.name.toLowerCase()));
  const hired: Hire[] = [];

  const hire = (role: OfficeRole, managerId: string | null): Hire => {
    const name = freeName(taken, role.name);
    taken.add(name.toLowerCase());
    const session = sessions.create({
      projectId: input.projectId,
      agentId: agent.id as string,
      name,
      title: role.name,
      team,
      managerId,
      officeProjectId: input.officeProjectId,
    });
    const made: Hire = { sessionId: session.id as string, name, title: role.name, roleKind: role.kind, managerId };
    hired.push(made);
    return made;
  };

  // A stream's lead reports to whoever plans the office, when the office has such a person. The
  // orchestrator finds the manager across the whole building, so this reads the same way.
  const manager = everyone.find((person) => person.roleKind === "manage" && !person.managerId)
    ?? everyone.find((person) => person.roleKind === "manage")
    ?? null;

  const existingLead = onStream.find((person) => person.roleKind === "lead");
  const lead = existingLead
    ? asHire(existingLead)
    : hire(roleOfKind(roles, "lead"), manager?.sessionId ?? null);

  const existingEngineers = onStream.filter((person) => person.roleKind === "build");
  const engineers: (Hire | OfficeEmployee)[] = existingEngineers.length
    ? existingEngineers.map(asHire)
    : [hire(roleOfKind(roles, "build"), lead.sessionId)];

  return { lead, engineers, hired };
}

export interface HireEngineerInput {
  projectId: string;
  buildingId: string;
  officeProjectId: string;
  name?: string;
}

/**
 * Add one more engineer to a stream. Unbounded on purpose: the operator scales a stream by
 * hiring, and every hire reports to the one lead so the delegation graph stays a tree.
 */
export function hireEngineer(
  store: Store,
  sessions: SessionService,
  input: HireEngineerInput,
): Hire {
  const agent = building(store, input.projectId, input.buildingId);
  const roles = listRoles(store, input.projectId);
  const everyone = officeEmployees(store, input.projectId, input.buildingId);
  const onStream = everyone.filter((person) => person.officeProjectId === input.officeProjectId);
  // Who this hire will take work from. Resolved exactly the way `subtasks.ts` resolves the
  // stream's delegate — a lead, or failing that whoever plans — because a hire that reports to
  // somebody the delegation path does not recognise would sit idle while work went elsewhere.
  // Without either, the stream would silently fall back to engineers working straight from the
  // plan, so the hire is refused instead.
  const lead = onStream.find((person) => person.roleKind === "lead")
    ?? onStream.find((person) => person.roleKind === "manage");
  if (!lead)
    fail("This stream has nobody to delegate on it. Create or staff the stream so it has a lead before hiring engineers onto it.", 409);
  const role = roleOfKind(roles, "build");
  const taken = new Set(everyone.map((person) => person.name.toLowerCase()));
  const wanted = input.name?.trim();
  if (wanted && taken.has(wanted.toLowerCase()))
    fail(`${wanted} already works in this office`, 409);
  const name = wanted || freeName(taken, role.name);
  const session = sessions.create({
    projectId: input.projectId,
    agentId: agent.id as string,
    name,
    title: role.name,
    team: lead.team,
    managerId: lead.sessionId,
    officeProjectId: input.officeProjectId,
  });
  return { sessionId: session.id as string, name, title: role.name, roleKind: role.kind, managerId: lead.sessionId };
}

/**
 * Refuse to move a lead off the stream it leads.
 *
 * A lead is the stream's only delegate: `subtasks.ts` resolves "the lead of this stream" to
 * exactly one person, every engineer on the stream reports to them, and their standing brief
 * names the stream's goal. Moving them to another stream leaves the first with engineers whose
 * manager is elsewhere and subtasks that fall back to picking an engineer by load — a silent
 * demotion of the whole chain. Reassigning the *engineers* is fine and stays allowed.
 *
 * Called from the session patch route, which is the one way an operator can change this field.
 */
export function assertLeadStaysPut(
  store: Store,
  session: Entity,
  patch: { officeProjectId?: string | null; title?: string },
): void {
  const current = (session.officeProjectId as string | null) ?? null;
  if (!("officeProjectId" in patch)) return;
  const next = patch.officeProjectId ?? null;
  if (next === current || current === null) return;
  const roles = listRoles(store, session.projectId);
  // The role they hold *now*: a patch that demotes a lead and moves them in one call is still a
  // move of a lead, so the title in the patch is deliberately not consulted here.
  if (resolveRole(roles, session.title as string | undefined).kind !== "lead") return;
  const who = (session.name as string) || "This lead";
  fail(
    `${who} leads ${current} and cannot be moved to another work stream. ` +
      "Their engineers report to them and the stream's subtasks are addressed to them. " +
      "Hire a lead on the other stream instead.",
    409,
  );
}

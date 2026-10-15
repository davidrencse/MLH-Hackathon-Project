// Why: a work stream is what the office orchestrator aims a team at — a name and a goal. They
// live on the project record as `officeProjects`, which could be written only when the project
// was created, so the office had no way to add one. These are the office-scoped reads and writes
// for that array.
//
// Ids are slugs rather than uuids on purpose: they are what a session stores in
// `officeProjectId`, what the staffing board shows, and what travels in a URL path.
import type { Store } from "../db/store.js";

export interface OfficeStream {
  id: string;
  name: string;
  goal: string;
}

const fail: (message: string, statusCode?: number) => never = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

// Matches the path-parameter shape the router allows for non-uuid ids.
export const STREAM_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_STREAMS = 50;

export function slugify(name: string, taken: Set<string>): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
    || "stream";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return fail("Too many work streams with that name", 409);
}

function read(store: Store, projectId: string): OfficeStream[] {
  const project = store.get("projects", projectId);
  if (!project) fail("Project not found", 404);
  return ((project.officeProjects as OfficeStream[] | undefined) ?? []).map((stream) => ({
    id: stream.id, name: stream.name, goal: stream.goal ?? "",
  }));
}

export function listStreams(store: Store, projectId: string): OfficeStream[] {
  return read(store, projectId);
}

export function createStream(
  store: Store,
  projectId: string,
  input: { name: string; goal?: string },
): OfficeStream {
  const streams = read(store, projectId);
  if (streams.length >= MAX_STREAMS) fail(`An office keeps at most ${MAX_STREAMS} work streams`, 409);
  const name = input.name.trim();
  if (!name) fail("A work stream needs a name");
  if (streams.some((stream) => stream.name.toLowerCase() === name.toLowerCase()))
    fail("This office already has a work stream with that name", 409);
  const stream: OfficeStream = {
    id: slugify(name, new Set(streams.map((entry) => entry.id))),
    name,
    goal: (input.goal ?? "").trim(),
  };
  store.update("projects", projectId, { officeProjects: [...streams, stream] });
  return stream;
}

export function updateStream(
  store: Store,
  projectId: string,
  id: string,
  patch: { name?: string; goal?: string },
): OfficeStream {
  const streams = read(store, projectId);
  const current = streams.find((stream) => stream.id === id);
  if (!current) fail("Work stream not found", 404);
  const name = patch.name?.trim() ?? current.name;
  if (!name) fail("A work stream needs a name");
  if (streams.some((stream) => stream.id !== id && stream.name.toLowerCase() === name.toLowerCase()))
    fail("This office already has a work stream with that name", 409);
  // The id is left alone even when the name changes: sessions point at it.
  const updated: OfficeStream = { id: current.id, name, goal: patch.goal?.trim() ?? current.goal };
  store.update("projects", projectId, {
    officeProjects: streams.map((stream) => (stream.id === id ? updated : stream)),
  });
  return updated;
}

/**
 * `unassign` moves one employee to the bench. It is passed in rather than written here so the
 * caller can go through SessionService, which recomposes the role brief — a brief left pointing
 * at a deleted stream would tell the agent it is still working towards a goal that is gone.
 */
export function deleteStream(
  store: Store,
  projectId: string,
  id: string,
  unassign: (sessionId: string) => void,
): { unassigned: number } {
  const streams = read(store, projectId);
  if (!streams.some((stream) => stream.id === id)) fail("Work stream not found", 404);
  // Anyone still pointing at it must be moved to the bench first, while the stream still
  // validates: SessionService checks the stream exists on the way through.
  const assigned = store.list("sessions", { projectId }).filter((session) => session.officeProjectId === id);
  for (const session of assigned) unassign(session.id as string);
  store.update("projects", projectId, {
    officeProjects: streams.filter((stream) => stream.id !== id),
  });
  return { unassigned: assigned.length };
}

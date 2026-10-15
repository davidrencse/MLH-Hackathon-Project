// Why: a project in this office is a folder a coding CLI is really open in, not a name somebody
// typed. The staffing board and the org chart both have to agree on that list, and on which lane
// each person stands in, so they both read it from here.
//
// A lane is keyed by the full path because two repos can share a folder name (`/a/src`, `/b/src`)
// and a lane must never merge them. It is *labelled* by the folder name, because "hackathon" is
// what a person calls the project and `~/projects/hackathon` is the supporting detail.
import type { CrewMember } from './crew'
import { shortPath } from './crew'

export const BENCH = ''

export interface Lane {
  /** Full working directory, a backend work stream's slug, or the typed name. The drop key. */
  id: string
  /** Folder name, the stream's name, or the typed name. What the lane header says. */
  name: string
  /** `~/projects/hackathon`, only for a real folder. */
  path?: string
  /** True when the player named this lane instead of a terminal revealing it. */
  manual: boolean
  /** True when the backend holds this project as a work stream, so it can be given real work. */
  backend?: boolean
}

const folderName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/**
 * All lane resolution needs to know about a person. Narrower than a CrewMember on purpose: the
 * 3D room carries its people as Employees and can still ask where they stand.
 */
export type Staffed = Pick<CrewMember, 'id' | 'cwd' | 'stream'>

export const folderOf = (member: Staffed): string | null =>
  (member.stream?.trim() || null) ?? (member.cwd?.trim() || null)

/**
 * Every lane to show, in the order they appear: the folders real terminals are open in, busiest
 * first so the project most of the office is on leads, then the lanes the player named.
 */
export function lanesFrom(crew: Staffed[], manual: string[], streams: { id: string; name: string }[] = []): Lane[] {
  const counts = new Map<string, number>()
  for (const member of crew) {
    const folder = folderOf(member)
    if (folder) counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  const folders = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]): Lane => ({ id, name: folderName(id), path: shortPath(id), manual: false }))
  // The backend's own work streams are projects whether or not a terminal is open in one: they
  // are what the orchestrator staffs and what a subtask is given to, so they get a lane even
  // when nobody is standing in them yet.
  const backend = streams
    .filter((stream) => !counts.has(stream.id))
    .map((stream): Lane => ({ id: stream.id, name: stream.name, manual: false, backend: true }))
  // A typed lane that happens to match a folder or a stream is already covered by it.
  const known = new Set([...counts.keys(), ...streams.map((stream) => stream.id)])
  const extra = manual
    .filter((name) => !known.has(name))
    .map((name): Lane => ({ id: name, name, manual: true }))
  // A stream the backend knows is marked as such even when a terminal revealed it first.
  const byStream = new Map(streams.map((stream) => [stream.id, stream]))
  const named = folders.map((lane) => byStream.has(lane.id)
    ? { ...lane, name: byStream.get(lane.id)!.name, backend: true }
    : lane)
  return [...named, ...backend, ...extra]
}

/**
 * Which lane a person stands in: an explicit assignment first, because the player dragged them
 * there on purpose, then the folder their terminal is really in, and the bench otherwise.
 * An assignment pointing at a lane that no longer exists (its terminal closed) falls through to
 * the folder or the bench rather than hiding the person in a lane nobody can see.
 */
export function laneOf(member: Staffed, assign: Record<string, string>, lanes: Lane[]): string {
  const explicit = assign[member.id]
  if (explicit === BENCH) return BENCH
  if (explicit && lanes.some((lane) => lane.id === explicit)) return explicit
  return folderOf(member) ?? BENCH
}

/**
 * The lane for someone the caller knows only by id. Views that hold people as Employees — the
 * tag over a head in the room, the panel that opens when you click them — must resolve the lane
 * the same way the staffing board does, or a person standing in a real project reads as
 * unassigned there. Someone the roster has never heard of has no folder, so they bench.
 */
export function laneForId(
  id: string,
  crew: Map<string, Staffed> | undefined,
  assign: Record<string, string>,
  lanes: Lane[],
): string {
  return laneOf(crew?.get(id) ?? { id, cwd: null }, assign, lanes)
}

/** What a lane is called, or null for the bench. */
export const laneLabel = (laneId: string, lanes: Lane[]): string | null =>
  (laneId === BENCH ? null : lanes.find((lane) => lane.id === laneId)?.name ?? null)

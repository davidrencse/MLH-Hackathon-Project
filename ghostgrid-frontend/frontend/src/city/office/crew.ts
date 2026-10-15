// Why: the room, the staffing board and the org chart used to each build their own idea of who
// works here, so a desk could exist in one and not the others. They all read this list instead.
//
// Two kinds of people share it, and both are real processes: `live` crew, which are coding CLIs
// the backend found already running on the machine (nine `claude` terminals are nine employees,
// no clicking required), and `desk` crew, which are windows Ghost Grid opened itself. An employee
// is a CLI you hired — there is no invented headcount, because a person who is not a process
// cannot be pointed at work, and the old org-chart staff never could be.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { backend, type CliSubagent, type DetectedCli, type DetectedRuntime, type OfficeEmployee, type OfficeRuntime, type OfficeWorker, type RoleKind } from '@/api/backend'
import type { BuildingType } from '@/types'
import { useLocalAgentsPoll, useLocalAgentsStore } from '@/store/localAgents'
import { useVisibleInterval } from '@/lib/useVisibleInterval'
import type { Role } from './org'

export type CrewSource = 'live' | 'desk' | 'agent' | 'subagent'
export interface CrewMember {
  id: string
  name: string
  role: Role
  /**
   * What their role does in a run, for backend employees. A job the operator invented is not one
   * of the three ranks the room draws, so this is how a custom senior role still gets the corner
   * office instead of a cubicle.
   */
  roleKind?: RoleKind
  source: CrewSource
  runtime?: OfficeRuntime | DetectedRuntime
  /** One short line of real identity: terminal, uptime, folder. */
  detail: string
  pid?: number
  cwd?: string | null
  uptimeSeconds?: number
  /** Backend employees only: the work stream they belong to, and what they have in flight. */
  stream?: string | null
  activeTasks?: number
  /** Subagents only: the name of the crew member whose CLI spawned them. */
  spawnedBy?: string
  /**
   * Backend employees only: who they report to.
   *
   * For an intern this is the engineer who hired them, which is what seats them at that
   * engineer's desk instead of giving them one of the room's own.
   */
  managerId?: string | null
}

// Which CLI an office is the home of. Visiting Claude's office shows the `claude` terminals.
export const OFFICE_RUNTIME: Partial<Record<BuildingType, DetectedRuntime>> = {
  claude: 'claude', codex: 'codex', deepseek: 'deepseek', cursor: 'cursor',
}

const CREW_NAMES = ['Maya', 'Leo', 'Priya', 'Kai', 'Zoe', 'Arjun', 'Nova', 'Sam', 'Iris', 'Theo', 'Luna', 'Rex', 'Jun', 'Ava', 'Omar', 'Mei']

/** Stable per pid, so a desk keeps its name for as long as its terminal lives. */
function nameForPid(pid: number): string {
  let hash = 2166136261
  for (const digit of String(pid)) hash = (hash ^ digit.charCodeAt(0)) * 16777619 >>> 0
  return CREW_NAMES[hash % CREW_NAMES.length]
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

/** `/home/czr/projects/hackathon` reads as `~/projects/hackathon`; only the tail is interesting. */
export function shortPath(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.split('/').filter(Boolean)
  return parts.length > 2 ? `~/${parts.slice(-2).join('/')}` : `/${parts.join('/')}`
}

/** Detected CLIs as crew: oldest session leads, everyone else engineers. */
export function crewFromProcesses(items: DetectedCli[]): CrewMember[] {
  const used = new Set<string>()
  return items.map((item, index) => {
    // Two pids can hash to one name; the terminal number breaks the tie and stays stable.
    let name = nameForPid(item.pid)
    if (used.has(name)) name = `${name} ${item.tty.replace(/\D+/g, '')}`
    used.add(name)
    return {
      id: item.id,
      name,
      role: index === 0 ? 'Team Lead' : 'Engineer',
      source: 'live' as const,
      runtime: item.runtime,
      detail: [item.tty, formatUptime(item.uptimeSeconds), shortPath(item.cwd)].filter(Boolean).join(' · '),
      pid: item.pid,
      cwd: item.cwd,
      uptimeSeconds: item.uptimeSeconds,
    }
  })
}

/**
 * Subagents one CLI spawned, as crew of its own.
 *
 * They are workers, not tool calls: the CLI handed each one a brief and is waiting on it. Seating
 * them under the desk that spawned them is the only way the room shows what is actually running —
 * otherwise a terminal driving five agents is drawn as one person typing.
 *
 * They inherit the parent's runtime and folder because that is literally where they run.
 */
export function crewFromSubagents(subagents: CliSubagent[], parent: CrewMember): CrewMember[] {
  return subagents.map((agent) => ({
    id: `${parent.id}:${agent.id}`,
    name: agent.description,
    role: 'Engineer' as const,
    source: 'subagent' as const,
    runtime: parent.runtime,
    detail: [agent.agentType ?? 'subagent', `spawned by ${parent.name}`].filter(Boolean).join(' · '),
    cwd: parent.cwd ?? null,
    spawnedBy: parent.name,
  }))
}

/** Desks Ghost Grid opened itself. */
export function crewFromDesks(desks: OfficeWorker[]): CrewMember[] {
  return desks.map((desk) => ({
    id: desk.id,
    name: desk.name,
    role: 'Engineer' as const,
    source: 'desk' as const,
    runtime: desk.runtime,
    detail: [desk.runtime.includes('browser') ? 'browser window' : 'ghost grid desk', shortPath(desk.workspace)].filter(Boolean).join(' · '),
    cwd: desk.workspace ?? null,
  }))
}

/**
 * A crew member shaped like an office worker, so the 3D room can seat live terminals at the same
 * desks as Ghost Grid's own windows without knowing the difference.
 */
const ROOM_RUNTIME: Record<DetectedRuntime, OfficeRuntime> = {
  claude: 'claude', codex: 'codex', deepseek: 'deepseek',
  // No terminal art of their own yet; they borrow the Codex screen.
  cursor: 'codex', gemini: 'codex',
}
/**
 * Backend employees: sessions with a role in the org chart, the only staff the orchestrator can
 * actually give work to. They have no working directory — the project they belong to is the work
 * stream they are assigned to, so that, not a folder, is what puts them in a room.
 */
export function crewFromStaff(staff: OfficeEmployee[]): CrewMember[] {
  return staff.map((person) => ({
    id: person.sessionId,
    name: person.name,
    role: person.title,
    roleKind: person.roleKind,
    source: 'agent' as const,
    detail: [person.team, person.activeTasks > 0 ? `${person.activeTasks} in flight` : 'idle'].join(' · '),
    cwd: null,
    stream: person.officeProjectId,
    activeTasks: person.activeTasks,
    managerId: person.managerId,
  }))
}

/**
 * Polls the building's backend employees, so the rooms reflect the org chart the server holds.
 *
 * Both shapes come back: `crew` for the room and the board, which only need a person, and `staff`
 * as the server sent it, which the org editor needs because it writes reporting lines and job
 * titles and those live on the employee record rather than on a desk.
 */
export function useBackendStaff(projectId: string, buildingId: string, enabled: boolean) {
  const [staff, setStaff] = useState<OfficeEmployee[]>([])
  const load = useCallback(() => {
    if (!projectId || !buildingId) return
    void backend.officeStaff(projectId, buildingId)
      .then((answer) => setStaff(answer.items))
      // The office still works on terminals alone; a failed read is not worth an alarm here.
      .catch(() => setStaff((current) => current))
  }, [projectId, buildingId])
  useEffect(() => { if (enabled) load() }, [enabled, load])
  // Activity changes while a run is going, so this refreshes at the same cadence as the scan.
  useVisibleInterval(load, enabled ? 4000 : 0)
  const crew = useMemo(() => crewFromStaff(staff), [staff])
  return { crew, staff, reload: load }
}

export function asRoomWorker(member: CrewMember, buildingId: string): OfficeWorker {
  const runtime = member.runtime && member.runtime in ROOM_RUNTIME
    ? ROOM_RUNTIME[member.runtime as DetectedRuntime]
    : (member.runtime as OfficeRuntime | undefined) ?? 'codex'
  return {
    id: member.id,
    name: member.name,
    buildingId,
    runtime,
    workspace: member.cwd ?? undefined,
    openedAt: new Date(Date.now() - (member.uptimeSeconds ?? 0) * 1000).toISOString(),
  }
}

export const isLiveCrewId = (id: string | null | undefined): boolean => Boolean(id?.startsWith('cli:'))

/**
 * This office's own CLIs, off the shared machine scan (see store/localAgents). The scan is one
 * request for the whole app — the HUD chip reads the same cache — so mounting the office does not
 * add a second poller against a route that blocks the backend for ~16ms a call.
 * `supported: false` means the backend cannot scan (it is not on Linux), not that nothing runs.
 */
export function useDetectedCrew(buildingType: BuildingType | undefined, enabled: boolean) {
  const runtime = buildingType ? OFFICE_RUNTIME[buildingType] : undefined
  const items = useLocalAgentsStore((s) => s.items)
  const supported = useLocalAgentsStore((s) => s.supported)
  const scannedAt = useLocalAgentsStore((s) => s.scannedAt)
  const errorKind = useLocalAgentsStore((s) => s.errorKind)
  useLocalAgentsPoll(enabled)

  const mine = useMemo(() => items.filter((item) => item.runtime === runtime), [items, runtime])
  const crew = useMemo(() => crewFromProcesses(mine), [mine])
  // A failed scan is not worth an alarm: the office still works on manual desks.
  const error = errorKind === 'stale'
    ? 'Restart the backend with ./dev.sh backend to let the office see your terminals.'
    : errorKind === 'unreadable' ? 'Could not read this machine\u2019s terminals.' : ''
  return { crew, runtime, supported, scannedAt: scannedAt ?? '', error, total: items.length }
}

/**
 * The whole roster for one office: the coding CLIs already running on this machine first, because
 * they are the real work, then the windows Ghost Grid opened itself. Both are real processes —
 * there is no invented headcount any more, because an employee here is a CLI you hired.
 */
export function useCrewRoster(
  live: CrewMember[],
  desks: OfficeWorker[],
  agents: CrewMember[] = [],
  /** Subagents keyed by the pid of the CLI that spawned them (see crewFromSubagents). */
  spawned: Map<number, CliSubagent[]> = new Map(),
) {
  const deskCrew = useMemo(() => crewFromDesks(desks), [desks])
  // A subagent only exists while its parent terminal does, so it is derived from the live crew
  // rather than held separately: when the CLI goes, its workers go with it and no desk is left
  // standing for a process that has exited.
  const subagents = useMemo(
    () => live.flatMap((member) => {
      const mine = member.pid === undefined ? undefined : spawned.get(member.pid)
      return mine?.length ? crewFromSubagents(mine, member) : []
    }),
    [live, spawned],
  )
  const all = useMemo(() => [...live, ...subagents, ...deskCrew, ...agents], [live, subagents, deskCrew, agents])
  const byId = useMemo(() => new Map(all.map((member) => [member.id, member])), [all])
  return { live, desks: deskCrew, agents, subagents, all, byId }
}

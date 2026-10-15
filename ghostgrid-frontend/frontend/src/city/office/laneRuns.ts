// Why: the staffing board IS the orchestration tool. A lane on the board is a piece of work with
// people standing in it, so running it has to be possible from the lane itself rather than from a
// separate panel further down the page that holds its own, differently-named list of work.
//
// This module is the join. A lane (lanes.ts, local: a folder a terminal is open in, or a name the
// player typed) is matched to a backend work stream (`OfficeStream`, which the orchestrator plans
// and runs against). The match is by name, because that is the only thing the two sides share —
// a lane has no server id until it has been run once, and a stream has no folder.
//
// Nothing here invents a stream on its own: a stream is created the first time someone runs a
// lane, so a board full of folders does not spam the backend with empty projects.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend, type OfficeEmployee, type OfficeStream, type OrchestrationRun } from '@/api/backend'
import type { Lane } from './lanes'

/** Terminal states; anything else means the engine still has work in flight. */
const SETTLED = new Set(['completed', 'failed', 'cancelled'])
export const isSettled = (run: OrchestrationRun | undefined) => !run || SETTLED.has(run.status)

/** A lane's name is its stream's name. Folder lanes use the folder name, which is what a person
 *  calls the project, so "hackathon" on the board is "hackathon" on the server. */
export const streamNameFor = (lane: Lane) => lane.name

export interface LaneRunState {
  /** The backend stream behind this lane, once it has one. */
  stream?: OfficeStream
  /** The newest run for that stream, finished or in flight. */
  run?: OrchestrationRun
  busy: boolean
  error?: string
}

export interface LaneRuns {
  /** Everything known about one lane, keyed by `lane.id`. */
  state: (lane: Lane) => LaneRunState
  /** Plan nothing, submit nothing — just save the goal against the lane's stream. */
  setGoal: (lane: Lane, goal: string) => Promise<void>
  /** Create the stream if needed, then hand the lane to the orchestrator. */
  run: (lane: Lane, goal: string) => Promise<void>
  cancel: (lane: Lane) => Promise<void>
  /** True once the backend has answered at all, so the UI can tell "none" from "not yet". */
  ready: boolean
  /** Set when the orchestrator itself is unreachable, rather than one lane failing. */
  outage?: string
  /**
   * Backend employees this office can actually orchestrate.
   *
   * NOT the same people as the board's cards. A card is a live terminal, a desk Ghost Grid
   * opened, or invented headcount; the engine can only run a *session* with a role in the org
   * chart. A lane full of terminals has nobody the server can hand work to, so the run control
   * has to say that rather than fail with an empty plan.
   */
  staff: OfficeEmployee[]
}

const EMPTY: LaneRunState = { busy: false }

const message = (reason: unknown, fallback: string) =>
  reason instanceof Error && /route not found/i.test(reason.message)
    ? 'Restart the backend with ./dev.sh backend to load the orchestrator.'
    : reason instanceof Error ? reason.message : fallback

/**
 * Lane → stream → run, for one office.
 *
 * Polls only while something is actually running, and only then: a board sitting idle makes no
 * requests. `projectId` empty means the backend has not booted yet, and every call no-ops.
 */
export function useLaneRuns(projectId: string, buildingId: string): LaneRuns {
  const [streams, setStreams] = useState<OfficeStream[]>([])
  const [staff, setStaff] = useState<OfficeEmployee[]>([])
  const [runs, setRuns] = useState<OrchestrationRun[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)
  const [outage, setOutage] = useState<string>()
  // Read in the poll without making it a dependency, so the interval is not torn down and
  // rebuilt every time a run's status changes.
  const live = useRef(false)

  const refresh = useCallback(async () => {
    if (!projectId) return
    try {
      const [{ items: streamItems }, { items: runItems }, { items: staffItems }] = await Promise.all([
        backend.officeStreams(projectId),
        backend.orchestrations(projectId, buildingId),
        backend.officeStaff(projectId, buildingId),
      ])
      setStreams(streamItems)
      setRuns(runItems)
      setStaff(staffItems)
      setOutage(undefined)
      live.current = runItems.some((entry) => !SETTLED.has(entry.status))
    } catch (reason) {
      setOutage(message(reason, 'Could not reach the orchestrator.'))
    } finally {
      setReady(true)
    }
  }, [projectId, buildingId])

  useEffect(() => { void refresh() }, [refresh])

  // While a run is in flight, keep asking. The interval stays mounted and cheap; it returns
  // immediately when nothing is running.
  useEffect(() => {
    if (!projectId) return
    const id = setInterval(() => { if (live.current && !document.hidden) void refresh() }, 2500)
    return () => clearInterval(id)
  }, [projectId, refresh])

  const byName = useMemo(() => new Map(streams.map((entry) => [entry.name, entry])), [streams])
  // Newest run per stream. The list arrives newest first, so the first hit wins.
  const runByStream = useMemo(() => {
    const out = new Map<string, OrchestrationRun>()
    for (const entry of runs) {
      if (entry.officeProjectId && !out.has(entry.officeProjectId)) out.set(entry.officeProjectId, entry)
    }
    return out
  }, [runs])

  const state = useCallback((lane: Lane): LaneRunState => {
    const stream = byName.get(streamNameFor(lane))
    return {
      stream,
      run: stream ? runByStream.get(stream.id) : undefined,
      busy: !!busy[lane.id],
      error: errors[lane.id],
    }
  }, [byName, runByStream, busy, errors])

  const mark = (laneId: string, on: boolean, error?: string) => {
    setBusy((current) => ({ ...current, [laneId]: on }))
    setErrors((current) => ({ ...current, [laneId]: error ?? '' }))
  }

  /** The lane's stream, created on demand. A lane only reaches the backend once it is run. */
  const streamFor = useCallback(async (lane: Lane, goal: string): Promise<OfficeStream> => {
    const name = streamNameFor(lane)
    const existing = byName.get(name)
    if (existing) {
      if (goal.trim() && goal.trim() !== existing.goal) {
        return backend.updateOfficeStream(existing.id, { projectId, goal: goal.trim() })
      }
      return existing
    }
    // The building is named so the stream arrives with a lead and an engineer on it; a lane that
    // reached the backend unstaffed would plan work nobody could be given.
    return backend.createOfficeStream({ projectId, buildingId, name, goal: goal.trim() || undefined })
  }, [byName, projectId, buildingId])

  const setGoal = useCallback(async (lane: Lane, goal: string) => {
    if (!projectId) return
    mark(lane.id, true)
    try {
      await streamFor(lane, goal)
      await refresh()
      mark(lane.id, false)
    } catch (reason) {
      mark(lane.id, false, message(reason, 'Could not save that goal.'))
    }
  }, [projectId, streamFor, refresh])

  const run = useCallback(async (lane: Lane, goal: string) => {
    if (!projectId) return
    mark(lane.id, true)
    try {
      const stream = await streamFor(lane, goal)
      await backend.orchestrate({
        projectId, buildingId, officeProjectId: stream.id,
        goal: goal.trim() || undefined, scope: 'building',
      })
      live.current = true
      await refresh()
      mark(lane.id, false)
    } catch (reason) {
      mark(lane.id, false, message(reason, 'Could not start that run.'))
    }
  }, [projectId, buildingId, streamFor, refresh])

  const cancel = useCallback(async (lane: Lane) => {
    const current = state(lane).run
    if (!current) return
    mark(lane.id, true)
    try {
      await backend.cancelOrchestration(current.id)
      await refresh()
      mark(lane.id, false)
    } catch (reason) {
      mark(lane.id, false, message(reason, 'Could not cancel that run.'))
    }
  }, [state, refresh])

  return { state, setGoal, run, cancel, ready, outage, staff }
}

export { EMPTY as EMPTY_LANE_RUN }

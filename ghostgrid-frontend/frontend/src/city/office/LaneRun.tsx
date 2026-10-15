// The run control on a staffing-board lane: a goal, a Run button, and the live state of whatever
// the orchestrator is doing with the people standing in that lane.
//
// This is what makes the board the orchestration tool rather than a seating chart — the lane you
// just dragged someone into is the lane you hand to the engine, without moving to another panel
// that keeps its own list of work under different names.
import { useState } from 'react'
import { Ban, Play } from 'lucide-react'
import type { Lane } from './lanes'
import type { LaneRuns } from './laneRuns'
import { isSettled } from './laneRuns'

const STAGE: Record<string, string> = {
  plan: 'Plan', design: 'Approach', build: 'Build', review: 'Review', signoff: 'Sign-off',
}

/** How a run reads on the lane header: one word plus how far through the graph it is. */
function runSummary(nodes: { status: string }[]) {
  const done = nodes.filter((node) => node.status === 'completed').length
  return `${done}/${nodes.length}`
}

export function LaneRun({ lane, runs, staffed }: { lane: Lane; runs: LaneRuns; staffed: number }) {
  const { stream, run, busy, error } = runs.state(lane)
  // The goal the player is typing, or null when they are not. Derived rather than synced in an
  // effect: while `draft` is null the server's value shows through, so a goal saved by a previous
  // run or another tab appears on its own without a render pass to copy it across.
  const [draft, setDraft] = useState<string | null>(null)
  const goal = draft ?? stream?.goal ?? ''

  const running = !isSettled(run)
  // The engine runs backend employees, not the terminals on the card. A lane can look fully
  // staffed and still have nobody the server can hand a task to.
  const hireable = runs.staff.length
  const blocked = !staffed ? 'Drag someone into this lane first'
    : !hireable ? 'Nobody to orchestrate yet — hire a manager, a lead and an engineer below'
    : ''
  const canRun = !blocked && !busy && !running

  return (
    <div className="gg-sb-run" data-running={running || undefined}>
      <input
        className="gg-sb-goal"
        value={goal}
        placeholder={staffed ? `What should ${lane.name} deliver?` : 'Staff this lane first'}
        aria-label={`Goal for ${lane.name}`}
        disabled={!staffed}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null || goal.trim() === (stream?.goal ?? '')) return
          void runs.setGoal(lane, goal).then(() => setDraft(null))
        }}
      />
      {running ? (
        <button type="button" className="gg-pixel-button" data-tone="danger" disabled={busy}
          onClick={() => void runs.cancel(lane)} title="Stop this run">
          <Ban size={14} strokeWidth={2.5} /> Stop
        </button>
      ) : (
        <button type="button" className="gg-pixel-button" data-tone="accent" disabled={!canRun}
          onClick={() => void runs.run(lane, goal).then(() => setDraft(null))}
          title={blocked || `Run ${lane.name} with this office's ${hireable} orchestratable staff`}>
          <Play size={14} strokeWidth={2.5} /> Run
        </button>
      )}
      {run && (
        <span className="gg-sb-run-state" data-status={run.status}>
          {run.status}{run.nodes.length ? ` · ${runSummary(run.nodes)}` : ''}
          {running && run.nodes.find((node) => node.status === 'running')
            && ` · ${STAGE[run.nodes.find((node) => node.status === 'running')!.stage ?? ''] ?? 'working'}`}
        </span>
      )}
      {blocked && !run && <span className="gg-sb-run-note">{blocked}</span>}
      {error && <span className="gg-sb-run-error">{error}</span>}
    </div>
  )
}

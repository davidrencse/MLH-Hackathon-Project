// Why: this is the office's control room. Everything above it in the page describes who works
// here; this is where they are actually given work.
//
// It drives the backend orchestrator: pick a work stream and a goal, and the server reads this
// building's org chart out of its employees' sessions, lays the team out as a dependency graph
// (manager plans → leads design → engineers build → leads review → manager signs off) and runs it
// through the execution engine. Each node runs as that employee's own session, so their standing
// role brief applies and each stage is handed the output of the stage before it.
//
// Orchestratable staff are backend employees, not the terminal desks upstairs: a desk is a window
// a human is typing in, and the server has no way to send it work.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Check, FileText, FolderGit2, GitBranch, Play, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import {
  backend, type BackendAgent, type OfficeEmployee, type OfficeStream, type OfficeTitle,
  type OrchestrationPlan, type OrchestrationRun, type OrchestrationStage,
  type OrchestrationTranscript, type Subtask, type WorkspaceRepo,
} from '@/api/backend'
import { useVisibleInterval } from '@/lib/useVisibleInterval'
import { shortRole } from './org'
import { StreamLog } from './StreamLog'

// Job titles come from the office's own roles (edited in the Roles tab), so this panel offers
// whatever jobs the operator defined rather than the three the backend used to compile in.
const STAGE_LABEL: Record<string, string> = {
  plan: 'Plan', design: 'Approach', build: 'Build', review: 'Review', signoff: 'Sign-off',
}
const STAGES: OrchestrationStage[] = ['plan', 'design', 'build', 'review', 'signoff']
// Terminal states stop the poll; anything else means the engine still has work in flight.
const SETTLED = new Set(['completed', 'failed', 'cancelled'])
const SUBTASK_SETTLED = new Set(['done', 'failed', 'cancelled'])
const STAGE_NOTE: Record<string, string> = {
  delegating: 'with the lead',
  building: 'being built',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}

export function Orchestrator({ projectId, agentId, buildingId, buildingName }: {
  projectId: string
  agentId: string
  buildingId: string
  buildingName: string
}) {
  const [streams, setStreams] = useState<OfficeStream[]>([])
  const [streamId, setStreamId] = useState('')
  const [goal, setGoal] = useState('')
  const [goalSaved, setGoalSaved] = useState(true)
  const [staff, setStaff] = useState<OfficeEmployee[]>([])
  const [scope, setScope] = useState<'project' | 'building'>('project')
  const [notes, setNotes] = useState('')
  // Stages that stop and wait for the operator. A gated step holds the moment its dependencies
  // finish, which is the last point before it acts — so gating `build` is how you read the
  // lead's approach before an engineer touches a file.
  const [approvals, setApprovals] = useState<OrchestrationStage[]>([])
  // The building's agent carries the office's file access: without a repository every desk can
  // only describe a change, which is what the engineers' own briefs told them to say.
  const [agentRecord, setAgentRecord] = useState<BackendAgent | null>(null)
  const [repos, setRepos] = useState<WorkspaceRepo[]>([])
  const [repoChoice, setRepoChoice] = useState('')
  const [mayWrite, setMayWrite] = useState(false)
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null)
  const [run, setRun] = useState<OrchestrationRun | null>(null)
  // The run view is polled and carries no text, so what the team actually wrote is fetched once,
  // on request, when the operator asks to read it.
  const [transcript, setTranscript] = useState<OrchestrationTranscript | null>(null)
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [history, setHistory] = useState<OrchestrationRun[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [subtaskPrompt, setSubtaskPrompt] = useState('')
  const [hire, setHire] = useState<{ name: string; title: OfficeTitle; team: string }>(
    { name: '', title: 'Engineer', team: 'Platform' },
  )
  const [titles, setTitles] = useState<OfficeTitle[]>(['Manager', 'Team Lead', 'Engineer'])
  // An office's first hire is the person the operator's prompt reaches, so the title defaults to
  // the lead until there is one; everyone after them builds. Derived rather than stored, so it
  // follows the roster as people are hired, and it stops moving the moment the operator picks.
  const [titlePicked, setTitlePicked] = useState(false)
  const hasLead = staff.some((person) => /lead/i.test(person.title))
  const defaultTitle: OfficeTitle =
    (!hasLead && (titles.find((title) => title === 'Lead Engineer') ?? titles.find((title) => /lead/i.test(title)))) || 'Engineer'
  const hireTitle: OfficeTitle = titlePicked ? hire.title : defaultTitle

  const stream = streams.find((entry) => entry.id === streamId) ?? null
  const report = (reason: unknown, fallback: string) =>
    setError(reason instanceof Error && /route not found/i.test(reason.message)
      ? 'Restart the backend with ./dev.sh backend to load the orchestrator.'
      : reason instanceof Error ? reason.message : fallback)

  const loadStreams = useCallback(async () => {
    try {
      const { items } = await backend.officeStreams(projectId)
      setStreams(items)
      setStreamId((current) => current && items.some((entry) => entry.id === current) ? current : items[0]?.id ?? '')
    } catch (reason) { report(reason, 'Could not read this office’s work streams.') }
  }, [projectId])

  // The role list, so hiring and reassigning offer the office's own jobs. A failed read leaves
  // the three defaults in place rather than an empty picker.
  const loadRoles = useCallback(async () => {
    try {
      const catalog = await backend.officeRoles(projectId)
      if (catalog.items.length) {
        setTitles(catalog.items.map((role) => role.name))
        setHire((current) => catalog.items.some((role) => role.name === current.title)
          ? current
          : { ...current, title: catalog.items[catalog.items.length - 1]!.name })
      }
    } catch { /* keep the defaults */ }
  }, [projectId])

  const loadStaff = useCallback(async () => {
    try { setStaff((await backend.officeStaff(projectId, buildingId)).items) }
    catch (reason) { report(reason, 'Could not read this office’s staff.') }
  }, [projectId, buildingId])

  const loadRuns = useCallback(async () => {
    try {
      const { items } = await backend.orchestrations(projectId, buildingId)
      setHistory(items)
      // Follow the newest run unless the operator is looking at an older one.
      setRun((current) => current ? items.find((entry) => entry.id === current.id) ?? current : items[0] ?? null)
    } catch (reason) { report(reason, 'Could not read past runs.') }
  }, [projectId, buildingId])

  // What this office can reach on disk, and what it is allowed to do there.
  const loadAccess = useCallback(async () => {
    try {
      const [record, options] = await Promise.all([backend.agent(agentId), backend.officeOptions()])
      setAgentRecord(record)
      setRepos(options.repos)
      setRepoChoice(record.workspace ?? '')
      setMayWrite(record.permissions.includes('write'))
    } catch (reason) { report(reason, 'Could not read this office\u2019s file access.') }
  }, [agentId])

  const loadSubtasks = useCallback(async () => {
    if (!streamId) { setSubtasks([]); return }
    try { setSubtasks((await backend.officeSubtasks(projectId, buildingId, streamId)).items) }
    catch (reason) { report(reason, 'Could not read this project\u2019s subtasks.') }
  }, [projectId, buildingId, streamId])

  useEffect(() => { void loadStreams(); void loadStaff(); void loadRuns(); void loadRoles(); void loadAccess() },
    [loadStreams, loadStaff, loadRuns, loadRoles, loadAccess])
  useEffect(() => { void loadSubtasks() }, [loadSubtasks])
  // The goal field follows the selected stream until the operator edits it.
  useEffect(() => { setGoal(stream?.goal ?? ''); setGoalSaved(true) }, [stream?.id, stream?.goal])

  // While the engine is working, the node board is the point of the panel, so poll it.
  // A subtask in flight is waiting on a lead or an engineer, so it needs the same watch.
  const subtaskWorking = subtasks.some((entry) => !SUBTASK_SETTLED.has(entry.stage))
  const polling = Boolean(run && !SETTLED.has(run.status))
  useVisibleInterval(useCallback(() => { void loadSubtasks() }, [loadSubtasks]), subtaskWorking ? 2500 : 0)
  // Keyed on the run id, not the run object: every poll sets a fresh object, and depending on it
  // re-created this callback, which made `useVisibleInterval` tear its timer down and fire again
  // immediately — so the 2s spacing never applied and the panel polled as fast as the backend
  // could answer, re-rendering on each one.
  const runId = run?.id ?? null
  useVisibleInterval(useCallback(() => {
    if (!runId) return
    void backend.orchestration(runId).then(setRun).catch(() => { /* a dropped poll is not an error */ })
  }, [runId]), polling ? 2000 : 0)

  const saveGoal = async () => {
    if (!stream || goal.trim() === stream.goal) { setGoalSaved(true); return }
    setBusy('goal')
    setError('')
    try {
      const updated = await backend.updateOfficeStream(stream.id, { projectId, goal })
      setStreams((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
      setGoalSaved(true)
    } catch (reason) { report(reason, 'Could not save the goal.') }
    finally { setBusy('') }
  }

  const addStream = async () => {
    const name = window.prompt('Name this work stream')?.trim()
    if (!name) return
    setBusy('stream')
    setError('')
    try {
      // Staffed on creation: a new stream comes with the lead and engineer it cannot work
      // without, rather than leaving the operator to hire both before anything can run.
      const created = await backend.createOfficeStream({ projectId, buildingId, name })
      setStreams((current) => [...current, created])
      setStreamId(created.id)
    } catch (reason) { report(reason, 'Could not create the work stream.') }
    finally { setBusy('') }
  }

  const removeStream = async () => {
    if (!stream) return
    setBusy('stream')
    setError('')
    try {
      await backend.deleteOfficeStream(stream.id, projectId)
      await Promise.all([loadStreams(), loadStaff()])
      setPlan(null)
    } catch (reason) { report(reason, 'Could not delete the work stream.') }
    finally { setBusy('') }
  }

  const addEmployee = async () => {
    const name = hire.name.trim()
    if (!name) return
    setBusy('hire')
    setError('')
    try {
      await backend.hireOfficeEmployee({
        projectId, agentId, name, title: hireTitle, team: hire.team.trim() || 'Platform',
        officeProjectId: streamId || null,
      })
      setHire((current) => ({ ...current, name: '' }))
      await loadStaff()
    } catch (reason) { report(reason, 'Could not hire that employee.') }
    finally { setBusy('') }
  }

  const reassign = async (employee: OfficeEmployee, patch: Parameters<typeof backend.assignOfficeEmployee>[1]) => {
    setBusy(employee.sessionId)
    setError('')
    try {
      await backend.assignOfficeEmployee(employee.sessionId, patch)
      await loadStaff()
    } catch (reason) { report(reason, 'Could not update that employee.') }
    finally { setBusy('') }
  }

  const assignRepo = async () => {
    setBusy('workspace')
    setError('')
    try {
      setAgentRecord(await backend.assignWorkspace(agentId, {
        workspace: repoChoice || null,
        // Write without a repository is refused by the backend, and would mean nothing anyway.
        permissions: repoChoice && mayWrite ? ['read', 'write'] : ['read'],
      }))
    } catch (reason) { report(reason, 'Could not assign that repository.') }
    finally { setBusy('') }
  }

  const decide = async (key: string, decision: 'approve' | 'reject') => {
    if (!run) return
    const reason = decision === 'reject'
      ? window.prompt('Why is this step declined? The employee\u2019s manager sees it.')?.trim()
      : undefined
    if (decision === 'reject' && reason === undefined) return // the operator backed out
    setBusy(key)
    setError('')
    try { setRun(await backend.decideOrchestrationNode(run.id, key, decision, reason || undefined)) }
    catch (failure) { report(failure, 'Could not record that decision.') }
    finally { setBusy('') }
  }

  const body = () => ({ projectId, buildingId, officeProjectId: streamId, goal: goal.trim() || undefined,
    scope, notes: notes.trim() || undefined, approvals: approvals.length ? approvals : undefined })

  const preview = async () => {
    setBusy('plan')
    setError('')
    setPlan(null)
    try { setPlan(await backend.planOrchestration(body())) }
    catch (reason) { report(reason, 'Could not plan this run.') }
    finally { setBusy('') }
  }

  const start = async () => {
    setBusy('run')
    setError('')
    try {
      if (!goalSaved) await saveGoal()
      const started = await backend.orchestrate(body())
      setRun(started)
      setPlan(null)
      await loadRuns()
    } catch (reason) { report(reason, 'Could not start this run.') }
    finally { setBusy('') }
  }

  const cancel = async () => {
    if (!run) return
    setBusy('cancel')
    setError('')
    try { setRun(await backend.cancelOrchestration(run.id)) }
    catch (reason) { report(reason, 'Could not cancel this run.') }
    finally { setBusy('') }
  }

  const handToLead = async () => {
    const prompt = subtaskPrompt.trim()
    if (!prompt || !streamId) return
    setBusy('subtask')
    setError('')
    try {
      const created = await backend.createSubtask({ projectId, buildingId, officeProjectId: streamId, prompt })
      setSubtasks((current) => [created, ...current])
      setSubtaskPrompt('')
    } catch (reason) { report(reason, 'Could not hand that subtask to the lead.') }
    finally { setBusy('') }
  }

  const stopSubtask = async (id: string) => {
    setBusy(id)
    setError('')
    try {
      const cancelled = await backend.cancelSubtask(id)
      setSubtasks((current) => current.map((entry) => entry.id === id ? cancelled : entry))
    } catch (reason) { report(reason, 'Could not cancel that subtask.') }
    finally { setBusy('') }
  }

  // A transcript belongs to one run; switching runs must not leave the last one's text on screen.
  useEffect(() => { setTranscript(null); setOpenNode(null) }, [run?.id])
  const readWork = async () => {
    if (!run) return
    setBusy('transcript')
    try { setTranscript(await backend.orchestrationTranscript(run.id)) }
    catch (reason) { report(reason, 'Could not read this run.') }
    finally { setBusy('') }
  }

  const onStream = useMemo(() => staff.filter((person) => person.officeProjectId === streamId), [staff, streamId])
  const nameOf = (id: string | null) => staff.find((person) => person.sessionId === id)?.name ?? '—'
  const counts = run
    ? run.nodes.reduce<Record<string, number>>((all, node) => ({ ...all, [node.status]: (all[node.status] ?? 0) + 1 }), {})
    : {}

  return (
    <section className="gg-orc" aria-label={`Orchestrator for ${buildingName}`}>
      {/* The panel never said what it does, and the first question it got was whether it was a
          scheduler. It runs once, now, and the shape of the run is the shape of the org chart. */}
      <p className="gg-orc-lede">
        Give this team a goal and run it once — plan, approach, build, review, sign-off — where each
        step is a real task on that employee’s session, handed whatever the step before it produced.
        Nothing here runs on a schedule.
      </p>
      {/* What the team is aimed at. */}
      <div className="gg-orc-stream">
        <label htmlFor="orc-stream" className="native-label">Work stream</label>
        <select id="orc-stream" value={streamId} onChange={(event) => { setStreamId(event.target.value); setPlan(null) }}>
          {!streams.length && <option value="">No work stream yet</option>}
          {streams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button type="button" className="gg-pixel-button" onClick={() => void addStream()} disabled={busy !== ''}>
          <Plus size={14} strokeWidth={2.5} /> New
        </button>
        {stream && <button type="button" className="gg-pixel-button" data-tone="danger" title="Delete this work stream"
          onClick={() => void removeStream()} disabled={busy !== ''}><Trash2 size={14} strokeWidth={2.5} /></button>}
        <button type="button" className="gg-pixel-button" title="Reload staff and runs"
          onClick={() => { void loadStaff(); void loadRuns() }} disabled={busy !== ''}>
          <RefreshCw size={14} strokeWidth={2.5} />
        </button>
      </div>

      <label htmlFor="orc-goal" className="native-label">Goal · the whole team is judged against this</label>
      <textarea id="orc-goal" value={goal} rows={2} disabled={!stream}
        placeholder={stream ? 'What does done look like for this stream?' : 'Create a work stream first'}
        onChange={(event) => { setGoal(event.target.value); setGoalSaved(false) }}
        onBlur={() => void saveGoal()} />
      {!goalSaved && <p className="gg-orc-hint">Unsaved — it saves when you click away, and before a run.</p>}

      <div className="gg-orc-controls">
        <label className="native-label" htmlFor="orc-scope">Staff from</label>
        <select id="orc-scope" value={scope} onChange={(event) => setScope(event.target.value as 'project' | 'building')}>
          <option value="project">This stream only ({onStream.length})</option>
          <option value="building">The whole office ({staff.length})</option>
        </select>
        <input aria-label="Standing instruction for this run" value={notes} placeholder="Standing instruction (optional)…"
          onChange={(event) => setNotes(event.target.value)} />
        <button type="button" className="gg-pixel-button" onClick={() => void preview()} disabled={!streamId || busy !== ''}>
          <GitBranch size={14} strokeWidth={2.5} /> {busy === 'plan' ? 'Planning…' : 'Preview'}
        </button>
        <button type="button" className="gg-pixel-button" data-tone="accent" onClick={() => void start()}
          disabled={!streamId || busy !== '' || polling}>
          <Play size={14} strokeWidth={2.5} /> {busy === 'run' ? 'Starting…' : polling ? 'Running…' : 'Run team'}
        </button>
      </div>

      {/* Gating is chosen before the run, because a gate is only meaningful ahead of the work. */}
      <div className="gg-orc-gates" role="group" aria-label="Stages that wait for approval">
        <span className="native-label">Hold for approval</span>
        {STAGES.map((stage) => (
          <label key={stage} data-on={approvals.includes(stage)}>
            <input type="checkbox" checked={approvals.includes(stage)}
              onChange={(event) => setApprovals((current) => event.target.checked
                ? [...current, stage]
                : current.filter((entry) => entry !== stage))} />
            {STAGE_LABEL[stage]}
          </label>
        ))}
      </div>

      {/* File access for every desk in this office. The engine gives a writing employee its own
          detached Git worktree per task, so this is not a licence to edit the live tree. */}
      <div className="gg-orc-access">
        <h3><FolderGit2 size={13} strokeWidth={2.5} /> Repository</h3>
        <div className="gg-orc-controls">
          <select aria-label="Repository for this office" value={repoChoice}
            onChange={(event) => setRepoChoice(event.target.value)}>
            <option value="">No repository — every desk can only describe a change</option>
            {repos.map((repo) => (
              <option key={repo.path} value={repo.path}>
                {repo.name}{repo.branch ? ` · ${repo.branch}` : ''}{repo.clean ? '' : ' · uncommitted changes'}
              </option>
            ))}
            {/* An assignment made before a repo went missing is still what the office holds. */}
            {repoChoice && !repos.some((repo) => repo.path === repoChoice) &&
              <option value={repoChoice}>{repoChoice} (not found now)</option>}
          </select>
          <label className="gg-orc-check" data-on={mayWrite}>
            <input type="checkbox" checked={mayWrite} disabled={!repoChoice}
              onChange={(event) => setMayWrite(event.target.checked)} />
            May edit files
          </label>
          <button type="button" className="gg-pixel-button" onClick={() => void assignRepo()}
            disabled={busy !== '' || polling}>
            <Check size={14} strokeWidth={2.5} /> {busy === 'workspace' ? 'Assigning…' : 'Assign'}
          </button>
        </div>
        {!repos.length && <p className="gg-orc-hint">
          No Git repository inside the backend’s allowlist. Point GHOSTGRID_ALLOWED_WORKSPACES at a
          directory that holds one and restart the backend.
        </p>}
        {repoChoice && mayWrite && repos.find((repo) => repo.path === repoChoice)?.clean === false && (
          <p className="gg-orc-hint">
            That repository has uncommitted changes. A writing task needs a clean tree to branch
            from, so commit or stash before running the team.
          </p>
        )}
        {agentRecord && !agentRecord.workspace && <p className="gg-orc-hint">
          Nobody here can read or write files yet, so a build stage returns a proposal rather than
          a change. Assign a repository to change that.
        </p>}
        {agentRecord?.workspace && (
          <p className="gg-orc-hint">
            Assigned: {agentRecord.workspace} · {agentRecord.permissions.includes('write')
              ? 'employees edit files in their own worktree'
              : 'read only — employees propose changes as diffs'}
          </p>
        )}
      </div>

      {error && <p role="alert" className="native-office-error">{error}</p>}

      {/* What everyone on this stream is doing, and what has happened on it. Above the staffing
          controls on purpose: who is idle and who is stuck is the question an operator opens
          this panel with, and it should not need scrolling past three dropdowns per person. */}
      {streamId && (
        <StreamLog
          projectId={projectId}
          buildingId={buildingId}
          officeProjectId={streamId}
          streamName={stream?.name}
          onStaffChanged={() => { void loadStaff() }}
        />
      )}

      {/* Who the orchestrator can actually give work to. */}
      <div className="gg-orc-staff">
        <h3>Backend staff</h3>
        {!staff.length && <p className="gg-orc-hint">Nobody yet. Hire a manager, a lead and an engineer and the orchestrator has a chain of command to run.</p>}
        {staff.map((person) => (
          <div key={person.sessionId} className="gg-orc-person" data-busy={busy === person.sessionId}>
            <span className="gg-role" data-role={person.title}>{shortRole(person.title)}</span>
            <b>{person.name}</b>
            <select aria-label={`Title for ${person.name}`} value={person.title}
              onChange={(event) => void reassign(person, { title: event.target.value as OfficeTitle })}>
              {titles.map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
            {/* A lead is pinned to the stream they lead: their engineers report to them and the
                stream's subtasks are addressed to them, so the backend refuses the move with a
                409. Disabled here so the rule is visible before it is hit. */}
            <select aria-label={`Work stream for ${person.name}`} value={person.officeProjectId ?? ''}
              disabled={person.roleKind === 'lead'}
              title={person.roleKind === 'lead'
                ? `${person.name} leads this stream and cannot be moved off it. Hire a lead on the other stream instead.`
                : undefined}
              onChange={(event) => void reassign(person, { officeProjectId: event.target.value || null })}>
              <option value="">Bench</option>
              {streams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <select aria-label={`Manager for ${person.name}`} value={person.managerId ?? ''}
              onChange={(event) => void reassign(person, { managerId: event.target.value || null })}>
              <option value="">Reports to you</option>
              {staff.filter((other) => other.sessionId !== person.sessionId)
                .map((other) => <option key={other.sessionId} value={other.sessionId}>{other.name} ({shortRole(other.title)})</option>)}
            </select>
            <em>{person.team}</em>
          </div>
        ))}
        <form className="gg-orc-hire" onSubmit={(event) => { event.preventDefault(); void addEmployee() }}>
          <input aria-label="New employee name" value={hire.name} placeholder="Name…"
            onChange={(event) => setHire((current) => ({ ...current, name: event.target.value }))} />
          <select aria-label="New employee title" value={hireTitle}
            onChange={(event) => { setTitlePicked(true); setHire((current) => ({ ...current, title: event.target.value as OfficeTitle })) }}>
            {titles.map((title) => <option key={title} value={title}>{title}</option>)}
          </select>
          <input aria-label="New employee team" value={hire.team} placeholder="Team…"
            onChange={(event) => setHire((current) => ({ ...current, team: event.target.value }))} />
          <button type="submit" className="gg-pixel-button" disabled={busy !== '' || !hire.name.trim()}>
            <Plus size={14} strokeWidth={2.5} /> Hire
          </button>
        </form>
      </div>

      {/* One piece of work, handed to the project's lead to give out. */}
      <div className="gg-orc-subtasks">
        <h3>Subtasks · {subtasks.length}</h3>
        <p className="gg-orc-hint">
          Write what needs doing. It goes to this project's lead, who knows the whole project and
          picks the engineer for it.
        </p>
        <form onSubmit={(event) => { event.preventDefault(); void handToLead() }}>
          <textarea value={subtaskPrompt} rows={2} disabled={!streamId}
            placeholder={streamId ? 'e.g. make the CSV import accept semicolons' : 'Pick a project first'}
            onChange={(event) => setSubtaskPrompt(event.target.value)} />
          <button type="submit" className="gg-pixel-button" data-tone="accent"
            disabled={!streamId || busy !== '' || !subtaskPrompt.trim()}>
            <Send size={14} strokeWidth={2.5} /> {busy === 'subtask' ? 'Handing over…' : 'Hand to lead'}
          </button>
        </form>
        <ol>
          {subtasks.map((entry) => (
            <li key={entry.id} data-stage={entry.stage}>
              <div className="gg-orc-subtask-head">
                <span className="gg-orc-stage" data-stage={entry.stage === 'done' ? 'review' : entry.stage === 'building' ? 'build' : 'plan'}>
                  {STAGE_NOTE[entry.stage] ?? entry.stage}
                </span>
                <b>{entry.prompt}</b>
                {!SUBTASK_SETTLED.has(entry.stage) && (
                  <button type="button" className="gg-pixel-button" data-tone="danger"
                    disabled={busy !== ''} onClick={() => void stopSubtask(entry.id)}>
                    <Ban size={13} strokeWidth={2.5} />
                  </button>
                )}
              </div>
              <span className="gg-orc-subtask-chain">
                {entry.lead?.name ?? 'lead'} →{' '}
                {entry.engineer
                  ? <>
                      {entry.engineer.name}
                      {entry.assignedByFallback && <em title="The lead did not name anyone we could match"> (not the lead's pick)</em>}
                      {/* Only the low ones. A lead that said it was sure needs no badge, and a
                          lead that stated nothing has claimed nothing to show. */}
                      {entry.leadConfidence !== null && entry.leadConfidence < 0.5 && (
                        <em
                          className="gg-orc-unsure"
                          title={`The lead put ${Math.round(entry.leadConfidence * 100)}% confidence on this call — it is telling you it guessed at the owner or the scope.`}
                        > (lead unsure · {Math.round(entry.leadConfidence * 100)}%)</em>
                      )}
                    </>
                  : <em>deciding who takes it…</em>}
              </span>
              {entry.delegation && <p className="gg-orc-subtask-brief">{entry.delegation}</p>}
              {entry.error && <p className="gg-orc-error">{entry.error}</p>}
            </li>
          ))}
          {!subtasks.length && <p className="gg-orc-hint">No subtasks on this project yet.</p>}
        </ol>
      </div>

      {/* The graph, before anything is submitted. */}
      {plan && <div className="gg-orc-plan">
        <h3>Plan · {plan.nodes.length} tasks across {plan.staff.length} people</h3>
        {plan.warnings.map((warning) => <p key={warning} className="native-setup-message">{warning}</p>)}
        <ol>
          {plan.nodes.map((node) => (
            <li key={node.key}>
              <span className="gg-orc-stage" data-stage={node.stage}>{STAGE_LABEL[node.stage] ?? node.stage}</span>
              <b>{node.employeeName}</b>
              <span>{node.title}</span>
              {node.dependsOn.length > 0 && <em>after {node.dependsOn.length === 1 ? '1 task' : `${node.dependsOn.length} tasks`}</em>}
              {node.requiresApproval && <em title="This step waits for you before it runs">waits for you</em>}
            </li>
          ))}
        </ol>
      </div>}

      {/* What the engine is doing with it. */}
      {run && <div className="gg-orc-run">
        <h3>
          Run · {run.status}
          {Object.entries(counts).map(([status, count]) => <em key={status}>{count} {status}</em>)}
          {polling && <button type="button" className="gg-pixel-button" data-tone="danger" onClick={() => void cancel()} disabled={busy !== ''}>
            <Ban size={14} strokeWidth={2.5} /> Cancel
          </button>}
        </h3>
        <ol>
          {run.nodes.map((node) => (
            <li key={node.key} data-status={node.status}>
              <span className="gg-orc-stage" data-stage={node.stage ?? ''}>{STAGE_LABEL[node.stage ?? ''] ?? node.stage}</span>
              <b>{node.employeeName ?? nameOf(null)}</b>
              <span>{node.title}</span>
              <em data-status={node.status}>{node.status === 'awaiting_approval' ? 'waiting for you' : node.status}</em>
              {node.status === 'awaiting_approval' && (
                <span className="gg-orc-decide">
                  <button type="button" className="gg-pixel-button" data-tone="accent"
                    disabled={busy !== ''} onClick={() => void decide(node.key, 'approve')}>
                    <Check size={13} strokeWidth={2.5} /> Approve
                  </button>
                  <button type="button" className="gg-pixel-button" data-tone="danger"
                    disabled={busy !== ''} onClick={() => void decide(node.key, 'reject')}>
                    <Ban size={13} strokeWidth={2.5} /> Decline
                  </button>
                </span>
              )}
              {/* Gated and not yet held: a submitted node is `queued`, not `pending`, so keying
                  this on pending alone never showed the one thing the operator needs to expect. */}
              {node.requiresApproval && ['pending', 'queued', 'running'].includes(node.status) &&
                <em>will wait for you</em>}
              {node.error && <span className="gg-orc-error">{node.error}</span>}
            </li>
          ))}
        </ol>
        {/* What the team actually wrote. The run above says only whether each desk finished. */}
        {SETTLED.has(run.status) && (
          transcript?.id === run.id ? (
            <div className="gg-orc-transcript">
              {transcript.delivered && (
                <div className="gg-orc-delivered">
                  <span className="native-label">
                    Delivered by {transcript.delivered.employeeName ?? 'the team'}
                  </span>
                  <pre>{transcript.delivered.result}</pre>
                </div>
              )}
              <span className="native-label">Every desk</span>
              {transcript.nodes.map((node) => {
                const open = openNode === node.key
                return (
                  <div key={node.key} className="gg-orc-transcript-node" data-open={open}>
                    <button type="button" onClick={() => setOpenNode(open ? null : node.key)}
                      aria-expanded={open}>
                      <span className="gg-orc-stage" data-stage={node.stage ?? ''}>
                        {STAGE_LABEL[node.stage ?? ''] ?? node.stage}
                      </span>
                      <b>{node.employeeName ?? '—'}</b>
                      <em data-status={node.status}>{node.status}</em>
                      {node.durationMs !== null && <em>{Math.round(node.durationMs / 1000)}s</em>}
                      {/* Null tokens mean the provider reported none — a mock runtime does not,
                          so an empty figure here is the honest answer and not a zero. */}
                      {node.usage?.inputTokens !== null && node.usage?.outputTokens !== null && node.usage && (
                        <em>{node.usage.inputTokens}→{node.usage.outputTokens} tok</em>
                      )}
                      {/* A cost is shown only when somebody knows it: reported by the vendor, or
                          estimated from configured prices, and labelled as which. */}
                      {node.usage && (node.usage.costUsd ?? node.usage.estimatedCostUsd) !== null && (
                        <em>${(node.usage.costUsd ?? node.usage.estimatedCostUsd)!.toFixed(4)}
                          {node.usage.costSource === 'estimated' ? ' est.' : ''}</em>
                      )}
                    </button>
                    {open && (
                      <div className="gg-orc-transcript-body">
                        {node.error && <p className="gg-orc-error">{node.error}</p>}
                        {node.result
                          ? <pre>{node.result}</pre>
                          : <p className="gg-orc-hint">This desk produced no text.</p>}
                        {node.prompt && (
                          <details>
                            <summary>{node.promptSource === 'sent'
                              ? 'Everything this desk was given'
                              : 'What this desk was asked (it never ran)'}</summary>
                            <pre>{node.prompt}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <button type="button" className="gg-pixel-button" onClick={() => void readWork()} disabled={busy !== ''}>
              <FileText size={14} strokeWidth={2.5} /> {busy === 'transcript' ? 'Reading…' : 'Read the work'}
            </button>
          )
        )}
        {history.length > 1 && <div className="gg-orc-history">
          <span className="native-label">Earlier runs</span>
          {history.filter((entry) => entry.id !== run.id).slice(0, 5).map((entry) => (
            <button key={entry.id} type="button" className="gg-pixel-button" onClick={() => setRun(entry)}>
              {entry.name} · {entry.status}
            </button>
          ))}
        </div>}
      </div>}
    </section>
  )
}

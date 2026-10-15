// Typed wrapper over the Ghost Grid backend REST + SSE surface (`/api/v1`).
// Shapes mirror ghostgrid-backend/docs/FRONTEND.md and `GET /api/v1/openapi.json`.
// Nothing in here knows about city buildings — see live.ts for that mapping.
//
// Every call goes through http.ts, so retries, timeouts, error classification and
// strict body checking are uniform; this module only names the routes and shapes.
// List responses are passed through the envelope guards there, so a route that
// answers without `items` yields an empty page instead of crashing a render.
import {
  asEventPage,
  asPage,
  isBackendError,
  openStream,
  readEventStream,
  request,
  type Query,
  type RequestOptions,
} from './http.ts'

export { isBackendError, request, shouldDegrade, type BackendError, type FailureKind, type Query } from './http.ts'


export interface Project {
  id: string
  name: string
  description?: string
  workspace?: string
  instructions?: string
  library?: LibraryConnection | null
  createdAt: string
  updatedAt: string
}

export interface ProviderCapabilities {
  inference: boolean
  coding: boolean
  streaming: boolean
  resume: boolean
  cancellation: boolean
  tools: boolean
  approvals: boolean
}

export type BackendProviderType = 'mock' | 'codex' | 'claude' | 'deepseek' | 'openai-compatible' | 'chatgpt-browser' | 'claude-browser' | 'deepseek-browser'

export type OfficeRuntime =
  | 'codex' | 'claude' | 'deepseek'
  | 'chatgpt-browser' | 'claude-browser' | 'deepseek-browser'
export interface OfficeWorker {
  id: string
  name: string
  buildingId: string
  runtime: OfficeRuntime
  workspace?: string
  openedAt: string
  /**
   * OS process id of the CLI this desk launched, when Ghost Grid launched it.
   *
   * The backend sends it (app.ts builds `{…, pid: launched.pid}` on both the POST and the
   * GET), and OfficePage gates CrewTerminal on it — but this hand-copied interface omitted it,
   * so it was dropped on the way in and the transcript could never open for a desk Ghost Grid
   * started itself. The cost of declaring the wire shape twice, in one field.
   */
  pid?: number
}

// Coding CLIs the backend can see running on its own machine. The office turns each one into a
// desk, so a terminal opened outside Ghost Grid still shows up as an employee.
export type DetectedRuntime = 'codex' | 'claude' | 'deepseek' | 'cursor' | 'gemini'
export interface DetectedCli {
  id: string
  pid: number
  runtime: DetectedRuntime
  tty: string
  cwd: string | null
  startedAt: string
  uptimeSeconds: number
}
export interface ProcessScan {
  supported: boolean
  scannedAt: string
  items: DetectedCli[]
}

// What one detected terminal is doing, read from that CLI's own transcript on the backend
// machine. `lines` is the tail of the session, oldest first, ready to print in a terminal.
export type ActivityKind = 'prompt' | 'say' | 'tool' | 'result' | 'error' | 'hook' | 'subagent'
export interface ActivityLine {
  kind: ActivityKind
  text: string
  at?: string
}
/**
 * A subagent a CLI spawned for itself, read out of its own transcript by the backend.
 *
 * A coding CLI delegates, and until now those delegates were invisible here: their work arrived
 * folded into the spawning terminal's transcript, so a desk running five agents drew as one busy
 * desk. The office seats one worker per entry.
 */
export interface CliSubagent {
  id: string
  /** The one-line description the CLI gave it; the desk's label. */
  description: string
  /** The agent type it was launched as ("fork", "general-purpose", a named agent). */
  agentType: string | null
  at: string | null
}

export interface CliActivity {
  pid: number
  sessionId: string
  /** The CLI's own session name, e.g. "hackathon-28". */
  name: string | null
  /** What the CLI last reported itself doing: "busy", "idle", "shell". */
  status: string | null
  cwd: string | null
  version: string | null
  startedAt: string | null
  updatedAt: string | null
  lines: ActivityLine[]
  /** Subagents this CLI spawned itself, newest last. Empty for a CLI that works alone. */
  subagents: CliSubagent[]
}

// The skills deck: catalogs and installs real skill folders through skills.sh on the backend
// machine. `model` scope installs for every terminal of a CLI, `employee` scope into one project.
export type SkillRuntime = 'claude' | 'codex' | 'deepseek'
export interface SkillCard {
  name: string
  path: string
  experimental: boolean
  installed: boolean
  description?: string
  title?: string
  local?: boolean
}
export interface SkillCatalog {
  runtime: SkillRuntime
  scope: 'model' | 'employee'
  workspace: string | null
  target: string
  repo: string
  ref: string
  items: SkillCard[]
}

// ---- office orchestration ---------------------------------------------------------------------
// A work stream is what a team is aimed at; the orchestrator staffs the building's org chart onto
// one and runs it as a dependency graph in the engine.
// A job title is whatever the office's roles call it, so this is a string and not a union: the
// operator can define "Staff Engineer" or "QA" and staff them like any other role.
export type OfficeTitle = string
/** Where a role sits in an orchestration run. The graph is built from this, not from the name. */
export type RoleKind = 'manage' | 'lead' | 'build' | 'intern'
export interface OfficeRole {
  id: string
  name: string
  kind: RoleKind
  /** Seniority. Promote and demote step to the nearest rank above or below. */
  rank: number
  remit: string[]
  answer: string[]
  builtIn: boolean
}
export interface OfficeRoleCatalog {
  items: (OfficeRole & { holders: number })[]
  kinds: { kind: RoleKind; summary: string }[]
  /** Ready-made job descriptions, so a new role does not start as an empty form. */
  presets: Omit<OfficeRole, 'id' | 'builtIn'>[]
}
/** Somebody a hiring call created. */
export interface OfficeHire {
  sessionId: string
  name: string
  title: string
  roleKind: RoleKind
  managerId: string | null
}
/** Who a stream was created with. Null when no building was named, so nobody could be hired. */
export interface StreamStaffing {
  lead: OfficeHire
  engineers: OfficeHire[]
  /** Only the people that call hired. Empty when the stream was already staffed. */
  hired: OfficeHire[]
}
export interface OfficeStream {
  id: string
  name: string
  goal: string
  staff?: StreamStaffing | null
}

/** One person on a stream, as the log reports them. */
export interface OfficeLogPerson {
  sessionId: string
  name: string
  title: string
  roleKind: RoleKind
  managerId: string | null
  managerName: string | null
  team: string
  activeTasks: number
  totalTasks: number
  /** One line: what they are doing right now, or when they last finished something. */
  doing: string
  /**
   * Whether the operator may message them. False for an intern, who answers to the engineer who
   * hired them — the backend refuses one with a 409, and this is how the UI knows before trying.
   */
  talkable: boolean
}
export interface OfficeLogEntry {
  id: string
  at: string
  sessionId: string
  who: string
  title: string
  roleKind: RoleKind
  label: string
  summary: string
  status: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  error: string | null
  workflowId: string | null
}
export interface OfficeStreamLog {
  officeProjectId: string | null
  staff: OfficeLogPerson[]
  entries: OfficeLogEntry[]
  /** Tasks on the stream before the feed was clipped to the requested limit. */
  total: number
}
export interface OfficeEmployee {
  sessionId: string
  name: string
  title: OfficeTitle
  /** Resolved from the project's roles, so the UI can group by what a role does. */
  roleKind: RoleKind
  team: string
  managerId: string | null
  officeProjectId: string | null
  /** Tasks in flight right now: the office draws them working when this is above zero. */
  activeTasks: number
  totalTasks: number
}
export type OrchestrationStage = 'plan' | 'design' | 'build' | 'review' | 'signoff'
export interface PlannedNode {
  key: string
  stage: OrchestrationStage
  sessionId: string
  employeeName: string
  employeeTitle: OfficeTitle
  team: string
  title: string
  prompt: string
  dependsOn: string[]
  /** This step waits for the operator once its dependencies are done. */
  requiresApproval: boolean
}
export interface OrchestrationPlan {
  projectId: string
  buildingId: string
  agentId: string
  scope: 'project' | 'building'
  officeProject: OfficeStream
  staff: OfficeEmployee[]
  nodes: PlannedNode[]
  warnings: string[]
}
export interface OrchestrationNodeStatus {
  key: string
  stage: OrchestrationStage | null
  title: string
  employeeName: string | null
  taskId: string | null
  /** Task status, plus `awaiting_approval` for a gated step holding for a decision. */
  status: string
  requiresApproval: boolean
  dependsOn: string[]
  startedAt?: string | null
  completedAt?: string | null
  error?: string | null
}
export interface OrchestrationRun {
  id: string
  name: string
  status: string
  projectId: string
  buildingId: string | null
  officeProjectId: string | null
  createdAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  nodes: OrchestrationNodeStatus[]
}
/** One node with what it was asked and what it said. Read on demand, never polled. */
export interface TranscriptNode extends OrchestrationNodeStatus {
  prompt: string | null
  /**
   * `sent` when `prompt` is the text the provider actually received — the role brief, the
   * instruction and every upstream output, as composed by the engine. `assigned` when the step
   * has not run, so the only thing to show is what the orchestrator wrote for it.
   */
  promptSource: 'sent' | 'assigned'
  result: string | null
  /** `costSource` says whether the vendor reported the cost, prices estimated it, or nobody knows. */
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    costUsd: number | null
    estimatedCostUsd: number | null
    costSource: string | null
  } | null
  durationMs: number | null
}
export interface OrchestrationTranscript extends Omit<OrchestrationRun, 'nodes'> {
  goal: string | null
  nodes: TranscriptNode[]
  /** What the team handed back: the output of the node nothing else depends on. */
  delivered: { key: string; stage: OrchestrationStage | null; employeeName: string | null; result: string } | null
}
export interface OrchestrateBody {
  projectId: string
  buildingId: string
  officeProjectId: string
  goal?: string
  scope?: 'project' | 'building'
  notes?: string
  /** Stages that hold for the operator before they run, e.g. ['build']. */
  approvals?: OrchestrationStage[]
  priority?: number
}
/** A repository an employee can be assigned to: inside the allowlist, and a real Git repo. */
export interface WorkspaceRepo {
  path: string
  name: string
  branch: string | null
  /** The engine refuses to cut a worktree from a dirty tree, so this one will not take work. */
  clean: boolean
}

// A subtask: one piece of work dropped into a project. The operator's prompt goes to the
// project's lead, who names the engineer and briefs them; the engineer's task is created from
// that answer, so `engineer` is null until the lead has decided.
export type SubtaskStage = 'delegating' | 'building' | 'done' | 'failed' | 'cancelled'
export interface SubtaskPerson { sessionId: string; name: string }
export interface Subtask {
  id: string
  projectId: string
  buildingId: string
  officeProjectId: string
  projectName: string
  prompt: string
  stage: SubtaskStage
  createdAt: string
  lead: SubtaskPerson | null
  engineer: SubtaskPerson | null
  /** The lead's answer did not name anyone we could match, so the runner chose. */
  assignedByFallback: boolean
  /**
   * The lead's own confidence in this assignment, 0 to 1, or null when it did not state one.
   *
   * Null and 1 are different answers: null is a lead that wrote prose and was read by scraping
   * it, 1 is a lead that said it was certain. A low number is the lead telling you it guessed,
   * which is the row worth looking at first.
   */
  leadConfidence: number | null
  delegateTaskId: string | null
  buildTaskId: string | null
  delegation: string | null
  result: string | null
  error: string | null
}

/** What a live desk answered when it was messaged. */
export interface CliReply {
  /** The session the CLI continued. */
  sessionId: string
  /** The CLI could not share the session that is open on the machine, so it continued a copy. */
  copied: boolean
  reply: string
  costUsd: number | null
  durationMs: number | null
}

export interface BackendProvider {
  id: string
  name: string
  type: BackendProviderType
  model?: string
  baseUrl?: string
  apiKeyEnv?: string
  auth?: 'bearer' | 'none' | 'header'
  concurrency: number
  timeoutMs: number
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  capabilities?: ProviderCapabilities
  availability?: { available: boolean; message?: string; models?: string[] }
  checkedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BackendAgent {
  id: string
  name: string
  /** Null when the agent owns no city building; the backend always sends the field. */
  buildingId?: string | null
  projectId: string
  providerId: string
  role?: string
  /** Null when no repository is assigned, so every desk can only describe a change. */
  workspace?: string | null
  permissions: ('read' | 'write')[]
  createdAt: string
  updatedAt: string
}

export interface BackendSession {
  id: string
  projectId: string
  agentId: string
  buildingId?: string
  name: string
  status: 'active' | 'archived'
  memory?: string
  messages?: { role: 'user' | 'assistant' | 'system'; content: string }[]
  taskCount?: number
  activeTaskCount?: number
  taskCounts?: Record<string, number>
  providerSessionId?: string | null
  workspace?: string
  // Org fields, present on office employees: their job, where they sit, and the standing brief
  // the server composes from both. `brief` is read-only — it is rebuilt on every org write.
  title?: OfficeTitle
  team?: string
  managerId?: string | null
  officeProjectId?: string | null
  briefNotes?: string
  brief?: string
  createdAt: string
  updatedAt: string
}

export type BackendTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BackendTask {
  id: string
  projectId: string
  agentId: string
  sessionId?: string | null
  workflowId?: string | null
  title: string
  prompt: string
  status: BackendTaskStatus
  priority: number
  attempts: number
  result: string | null
  error: { code?: string; message?: string } | null
  usage: BackendUsage | null
  workspace?: string
  timeoutMs?: number
  maxRetries?: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  dependencies?: string[]
}

export interface BackendUsage {
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  estimatedCostUsd: number | null
  costSource: 'reported' | 'estimated' | 'unknown'
}

export interface BackendUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  reportedCostUsd: number
  estimatedCostUsd: number
  unknownCostRequests: number
  unknownTokenRequests: number
}

export interface BackendUsageSummary {
  totals: BackendUsageTotals
  today: BackendUsageTotals
  providers: (BackendUsageTotals & { providerId: string | null; name: string | null; type: string | null })[]
  /** The same usage grouped by the agent that spent it, so it can be attributed to a building.
   *  Older backends do not send this, hence optional. */
  agents?: (BackendUsageTotals & { agentId: string | null; name: string | null; buildingId: string | null })[]
  tokensLastMinute: number
  fetchedAt: string
  dayStart: string
}

export interface BackendUsageRecord extends BackendUsage {
  id: string
  taskId: string
  agentId: string
  providerId: string
  projectId: string
  createdAt: string
}

export interface BackendEvent {
  id: string
  seq: number
  type: string
  taskId: string | null
  sessionId?: string | null
  agentId?: string | null
  projectId?: string | null
  buildingId?: string | null
  data?: Record<string, unknown>
  timestamp: string
}

export interface BackendMetrics {
  tasks: Record<BackendTaskStatus, number>
  activeAgents: number
  workflowCompletionRate: number | null
  durations: { taskId: string; durationMs: number }[]
  durationsTotal: number
  durationLimit: number
  durationOffset: number
  capacity: { concurrency: number; inUse: number; utilization: number }
  providers: { id: string; availability: BackendProvider['availability'] | null }[]
}

export interface LibraryConnection {
  name: string
  buildingId: string
  baseUrl: string
  apiKeyEnv?: string
  timeoutMs: number
  repositoryUrl?: string
  connectedAt?: string
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface EventPage {
  items: BackendEvent[]
  nextCursor: number
}

export interface ContextEntry {
  id: string
  projectId: string
  title: string
  content: string
  kind?: string
  source?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** A `{ items, total }` route. A body that is not a page is a failure, never an empty list. */
async function page<T>(path: string, options: RequestOptions = {}): Promise<Page<T>> {
  return asPage<T>(await request<unknown>('GET', path, options), path)
}

/** An `{ items, nextCursor }` event route, held to the same rule. */
async function eventPage(path: string, options: RequestOptions = {}): Promise<EventPage> {
  const after = typeof options.query?.after === 'number' ? options.query.after : 0
  return asEventPage<BackendEvent>(await request<unknown>('GET', path, options), after, path)
}

export const backend = {
  // Answer a live desk: the backend continues that terminal's own Claude session, so the reply
  // lands in the transcript the desk is already showing. Slow by nature — it waits for the CLI to
  // finish a turn — so it gets a long timeout and no retry (a retry would ask twice).
  messageDesk: (pid: number, prompt: string) =>
    request<CliReply>('POST', '/api/v1/office/activity/message',
      { body: { pid, prompt }, timeoutMs: 600_000, retries: 0 }),
  officeOptions: () => request<{
    runtimes: OfficeRuntime[]
    terminal: string | null
    /** The raw allowlist, which is often a directory of projects rather than a repository. */
    workspaces: string[]
    /** The repositories inside it, which is what an employee can be assigned to. */
    repos: WorkspaceRepo[]
  }>('GET', '/api/v1/office/options'),
  officeProcesses: () => request<ProcessScan>('GET', '/api/v1/office/processes'),
  officeActivity: (pid: number, limit = 40) =>
    request<CliActivity>('GET', '/api/v1/office/activity', { query: { pid, limit }, retries: 0 }),
  officeStreams: (projectId: string) =>
    request<{ items: OfficeStream[] }>('GET', '/api/v1/office/projects', { query: { projectId } }),
  /**
   * Create a work stream. Naming the building staffs it on the way in — one lead to delegate and
   * one engineer to implement — because a stream with nobody on it does not fail at creation
   * time with something to fix, it fails at run time with a warning. Pass `staff: false` to
   * create it empty and hire by hand.
   */
  createOfficeStream: (body: { projectId: string; name: string; goal?: string; buildingId?: string; staff?: boolean }) =>
    request<OfficeStream>('POST', '/api/v1/office/projects', { body }),
  updateOfficeStream: (id: string, body: { projectId: string; name?: string; goal?: string }) =>
    request<OfficeStream>('PATCH', `/api/v1/office/projects/${encodeURIComponent(id)}`, { body }),
  deleteOfficeStream: (id: string, projectId: string) =>
    request<{ unassigned: number }>('DELETE', `/api/v1/office/projects/${encodeURIComponent(id)}`, { query: { projectId } }),
  officeSubtasks: (projectId: string, buildingId: string, officeProjectId?: string) =>
    request<{ items: Subtask[] }>('GET', '/api/v1/office/subtasks',
      { query: officeProjectId ? { projectId, buildingId, officeProjectId } : { projectId, buildingId } }),
  createSubtask: (body: { projectId: string; buildingId: string; officeProjectId: string; prompt: string }) =>
    request<Subtask>('POST', '/api/v1/office/subtasks', { body }),
  cancelSubtask: (id: string) => request<Subtask>('POST', `/api/v1/office/subtasks/${id}/cancel`),
  /**
   * Add one more engineer to a stream. The one unbounded role: a stream has exactly one lead,
   * because a subtask must resolve to a single delegate, and as many engineers as asked for.
   * Every hire reports to that lead, so the delegation graph stays a tree.
   */
  hireEngineer: (body: { projectId: string; buildingId: string; officeProjectId: string; name?: string }) =>
    request<OfficeHire>('POST', '/api/v1/office/engineers', { body }),
  /** Who is on a stream, what each is doing, and the stream's history newest first. */
  officeLog: (projectId: string, buildingId: string, officeProjectId?: string, limit = 120) =>
    request<OfficeStreamLog>('GET', '/api/v1/office/log', {
      query: officeProjectId ? { projectId, buildingId, officeProjectId, limit } : { projectId, buildingId, limit },
    }),
  officeStaff: (projectId: string, buildingId: string) =>
    request<{ items: OfficeEmployee[] }>('GET', '/api/v1/office/staff', { query: { projectId, buildingId } }),
  /**
   * An engineer hires an intern of their own, optionally with a first task.
   *
   * Only an implementing role may: the backend refuses a lead with a 409, because a lead that
   * could hire its own helper would be implementing through the back door. The intern's name,
   * team and work stream all come from the engineer, so none of them is sent.
   */
  hireIntern: (body: { projectId: string; buildingId: string; engineerSessionId: string; name?: string; task?: string }) =>
    request<{
      intern: { sessionId: string; name: string; engineerSessionId: string; engineerName: string; team: string }
      task: BackendTask | null
    }>('POST', '/api/v1/office/interns', { body }),
  // Hiring an orchestratable employee is creating a session with a role in the org chart.
  hireOfficeEmployee: (body: {
    projectId: string; agentId: string; name: string
    title?: OfficeTitle; team?: string; managerId?: string | null; officeProjectId?: string | null
    briefNotes?: string
  }) => request<BackendSession>('POST', '/api/v1/sessions', { body }),
  assignOfficeEmployee: (sessionId: string, body: {
    name?: string
    title?: OfficeTitle; team?: string; managerId?: string | null; officeProjectId?: string | null
    briefNotes?: string
  }) => request<BackendSession>('PATCH', `/api/v1/sessions/${sessionId}`, { body }),
  session: (id: string) => request<BackendSession>('GET', `/api/v1/sessions/${id}`),
  // ---- roles: what each job is, and the prompt every holder of it carries -------------------
  officeRoles: (projectId: string) =>
    request<OfficeRoleCatalog>('GET', '/api/v1/office/roles', { query: { projectId } }),
  createOfficeRole: (body: {
    projectId: string; name: string; kind?: RoleKind; rank?: number
    remit?: string[]; answer?: string[]
  }) => request<OfficeRole>('POST', '/api/v1/office/roles', { body }),
  // `rebriefed` is how many employees had their standing brief rebuilt from the edited role.
  updateOfficeRole: (id: string, body: {
    projectId: string; name?: string; kind?: RoleKind; rank?: number
    remit?: string[]; answer?: string[]
  }) => request<OfficeRole & { renamedFrom: string | null; rebriefed: number }>(
    'PATCH', `/api/v1/office/roles/${encodeURIComponent(id)}`, { body }),
  deleteOfficeRole: (id: string, projectId: string, reassignTo?: string) =>
    request<{ movedTo: string; moved: number }>('DELETE', `/api/v1/office/roles/${encodeURIComponent(id)}`,
      { query: reassignTo ? { projectId, reassignTo } : { projectId } }),
  // One rung of the ladder. The brief is rebuilt server-side, so the next task is briefed as the
  // new job rather than the old one.
  promoteEmployee: (sessionId: string) =>
    request<{ employee: BackendSession; from: string; to: string; direction: 'promote' }>(
      'POST', `/api/v1/office/employees/${sessionId}/promote`),
  demoteEmployee: (sessionId: string) =>
    request<{ employee: BackendSession; from: string; to: string; direction: 'demote' }>(
      'POST', `/api/v1/office/employees/${sessionId}/demote`),
  // A dry run: the graph the engine would be given, with nothing submitted or charged.
  planOrchestration: (body: OrchestrateBody) =>
    request<OrchestrationPlan>('POST', '/api/v1/office/orchestrate/plan', { body }),
  orchestrate: (body: OrchestrateBody) =>
    request<OrchestrationRun>('POST', '/api/v1/office/orchestrate', { body }),
  orchestrations: (projectId: string, buildingId?: string) =>
    request<{ items: OrchestrationRun[] }>('GET', '/api/v1/office/orchestrations',
      { query: buildingId ? { projectId, buildingId } : { projectId } }),
  orchestration: (id: string) => request<OrchestrationRun>('GET', `/api/v1/office/orchestrations/${id}`),
  orchestrationTranscript: (id: string) =>
    request<OrchestrationTranscript>('GET', `/api/v1/office/orchestrations/${encodeURIComponent(id)}/transcript`),
  cancelOrchestration: (id: string) =>
    request<OrchestrationRun>('POST', `/api/v1/office/orchestrations/${id}/cancel`),
  // A gated step waits in `awaiting_approval` until one of these. The node key travels in the
  // body because the backend validates every `:param` as a UUID.
  // Both paths written out rather than interpolating the decision: the endpoint a call uses is
  // then visible in the source, which is what the contract test reads to check that every route
  // this app asks for exists on the backend.
  decideOrchestrationNode: (id: string, key: string, decision: 'approve' | 'reject', reason?: string) =>
    request<OrchestrationRun>('POST', decision === 'approve'
      ? `/api/v1/office/orchestrations/${id}/approve`
      : `/api/v1/office/orchestrations/${id}/reject`,
      { body: reason ? { key, reason } : { key } }),
  // The building's agent is the provider identity *and* the file access for every employee in
  // it: assigning a repository here is what lets a build stage change code instead of
  // describing a change it could not make.
  agent: (agentId: string) => request<BackendAgent>('GET', `/api/v1/agents/${agentId}`),
  assignWorkspace: (agentId: string, body: { workspace?: string | null; permissions?: ('read' | 'write')[] }) =>
    request<BackendAgent>('PATCH', `/api/v1/agents/${agentId}`, { body }),
  // The first catalog read fetches every SKILL.md upstream, and an install clones a repo, so both
  // get their own generous timeout and no retry: repeating them only costs the machine bandwidth.
  officeSkills: (runtime: SkillRuntime, workspace?: string) =>
    request<SkillCatalog>('GET', '/api/v1/office/skills',
      { query: workspace ? { runtime, workspace } : { runtime }, timeoutMs: 90_000, retries: 0 }),
  installOfficeSkills: (body: { runtime: SkillRuntime; skills: string[]; workspace?: string }) =>
    request<{ installed: string[]; log: string }>('POST', '/api/v1/office/skills/install',
      { body, timeoutMs: 240_000, retries: 0 }),
  removeOfficeSkill: (body: { runtime: SkillRuntime; skill: string; workspace?: string }) =>
    request<{ removed: string }>('POST', '/api/v1/office/skills/remove', { body }),
  officeWorkers: (projectId: string, buildingId: string) => request<{ items: OfficeWorker[] }>('GET', '/api/v1/office/workers', { query: { projectId, buildingId } }),
  createOfficeWorker: (body: { projectId: string; buildingId: string; name: string; runtime: OfficeRuntime; workspace?: string }) =>
    request<OfficeWorker>('POST', '/api/v1/office/workers', { body }),
  removeOfficeWorker: (id: string) => request<void>('DELETE', `/api/v1/office/workers/${id}`),
  openOfficeWorker: (id: string) => request<{ opened: true }>('POST', `/api/v1/office/workers/${id}/open`),
  status: () => request<{ status: string; version: string; workerConcurrency: number; storage: string }>('GET', '/api/v1/status'),

  listProjects: (query?: Query) => page<Project>('/api/v1/projects', { query }),
  createProject: (body: { name: string; description?: string; instructions?: string; workspace?: string }) =>
    request<Project>('POST', '/api/v1/projects', { body }),

  listProviders: (query?: Query) => page<BackendProvider>('/api/v1/providers', { query }),
  getProvider: (id: string) => request<BackendProvider>('GET', `/api/v1/providers/${id}`),
  testProvider: (id: string) =>
    request<{ available: boolean; message?: string; models?: string[]; capabilities: ProviderCapabilities }>(
      'POST',
      `/api/v1/providers/${encodeURIComponent(id)}/test`,
      // A provider probe reaches a third party: give it room, but never retry it.
      { timeoutMs: 30_000, retries: 0 },
    ),

  listAgents: (query?: Query) => page<BackendAgent>('/api/v1/agents', { query }),
  createAgent: (body: {
    name: string
    projectId: string
    providerId: string
    buildingId?: string
    role?: string
    workspace?: string
    permissions?: ('read' | 'write')[]
  }) => request<BackendAgent>('POST', '/api/v1/agents', { body }),
  patchAgent: (id: string, body: Record<string, unknown>) =>
    request<BackendAgent>('PATCH', `/api/v1/agents/${id}`, { body }),
  deleteAgent: (id: string) => request<void>('DELETE', `/api/v1/agents/${id}`),

  listSessions: (query?: Query) => page<BackendSession>('/api/v1/sessions', { query }),
  getSession: (id: string) => request<BackendSession>('GET', `/api/v1/sessions/${id}`),
  agentSessions: (agentId: string) => page<BackendSession>(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions`),
  createAgentSession: (agentId: string, name: string) =>
    request<BackendSession>('POST', `/api/v1/agents/${agentId}/sessions`, { body: { name } }),
  patchSession: (id: string, body: { name?: string; status?: 'active' | 'archived'; memory?: string }) =>
    request<BackendSession>('PATCH', `/api/v1/sessions/${id}`, { body }),
  resumeSession: (id: string) => request<BackendSession>('POST', `/api/v1/sessions/${id}/resume`),
  cancelSession: (id: string) => request<BackendSession & { cancelledTaskIds: string[] }>('POST', `/api/v1/sessions/${id}/cancel`),
  sessionTasks: (id: string) => page<BackendTask>(`/api/v1/sessions/${encodeURIComponent(id)}/tasks`),
  sendMessage: (
    sessionId: string,
    body: { prompt: string; title?: string; contextIds?: string[]; priority?: number; timeoutMs?: number; maxRetries?: number },
  ) => request<BackendTask>('POST', `/api/v1/sessions/${sessionId}/messages`, { body }),

  listTasks: (query?: Query) => page<BackendTask>('/api/v1/tasks', { query }),
  getTask: (id: string) => request<BackendTask>('GET', `/api/v1/tasks/${id}`),
  submitTask: (body: {
    projectId: string
    agentId: string
    sessionId?: string
    prompt: string
    title?: string
    priority?: number
    dependencies?: string[]
    contextIds?: string[]
    timeoutMs?: number
    maxRetries?: number
  }) => request<BackendTask>('POST', '/api/v1/tasks', { body }),
  // Cancelling twice is harmless, so a dropped answer may be retried.
  cancelTask: (id: string) => request<BackendTask>('POST', `/api/v1/tasks/${encodeURIComponent(id)}/cancel`, { idempotent: true }),
  // A gated task waits in `awaiting_approval` until one of these; see the approvals selector in
  // the Runs tab, which is what puts a task in that state.
  // The empty object is load-bearing: the server rejects a JSON content-type with no body at all.
  approveTask: (id: string) => request<BackendTask>('POST', `/api/v1/tasks/${encodeURIComponent(id)}/approve`, { body: {} }),
  rejectTask: (id: string, reason?: string) =>
    request<BackendTask>('POST', `/api/v1/tasks/${encodeURIComponent(id)}/reject`, { body: reason ? { reason } : {} }),
  taskEvents: (id: string, query?: Query) => eventPage(`/api/v1/tasks/${encodeURIComponent(id)}/events`, { query }),
  taskArtifacts: (id: string) =>
    page<{ id: string; name: string; mimeType: string; createdAt: string }>(`/api/v1/tasks/${encodeURIComponent(id)}/artifacts`),
  // Artifact bodies are text, not JSON: the transport must not demand an envelope.
  artifactContent: (id: string) =>
    request<string>('GET', `/api/v1/artifacts/${encodeURIComponent(id)}/content`, { expect: 'text' }),

  events: (query?: Query) => eventPage('/api/v1/events', { query }),
  /** Newest durable event sequence, for starting a stream at "now". */
  eventsHead: (query?: Query) => request<{ seq: number }>('GET', '/api/v1/events/head', { query }),
  sessionEvents: (id: string, query?: Query) => eventPage(`/api/v1/sessions/${encodeURIComponent(id)}/events`, { query }),

  usage: (query?: Query) => page<BackendUsageRecord>('/api/v1/usage', { query }),
  providerCredits: (force = false, projectId?: string) => request<{ fetchedAt: number; rows: import('./providerCredits').CreditRow[]; usage?: BackendUsageSummary }>('GET', '/api/v1/provider-credits', { query: { refresh: force ? '1' : '0', projectId }, timeoutMs: 25_000, retries: 0 }),
  usageSummary: (projectId?: string) => request<BackendUsageSummary>('GET', '/api/v1/usage/summary', { query: { projectId } }),
  metrics: (query?: Query) => request<BackendMetrics>('GET', '/api/v1/metrics', { query }),

  listContext: (projectId: string) => page<ContextEntry>(`/api/v1/projects/${encodeURIComponent(projectId)}/context`),
  createContext: (projectId: string, body: { title: string; content: string; agentId?: string; sourceTaskId?: string }) =>
    request<ContextEntry>('POST', `/api/v1/projects/${projectId}/context`, { body }),

  // Library of Babel (read-only shared context)
  getLibrary: (projectId: string) => request<{ connection: LibraryConnection | null }>('GET', `/api/v1/projects/${projectId}/library`),
  connectLibrary: (projectId: string, body: { baseUrl: string; name?: string; buildingId?: string; apiKeyEnv?: string; timeoutMs?: number }) =>
    request<LibraryConnection>('PUT', `/api/v1/projects/${projectId}/library`, { body }),
  disconnectLibrary: (projectId: string) => request<void>('DELETE', `/api/v1/projects/${projectId}/library`),
  libraryStatus: (projectId: string) =>
    request<{ available: boolean; readOnly: boolean; repositoryUrl: string; catalogVersion: number | null; checkedAt: string }>(
      'GET',
      `/api/v1/projects/${projectId}/library/status`,
    ),
  libraryCatalog: (projectId: string, query?: Query) =>
    request<{ articles: Record<string, unknown>[]; total: number }>('GET', `/api/v1/projects/${projectId}/library/catalog`, { query }),
  librarySearch: (projectId: string, q: string, limit?: number) =>
    request<{ items: Record<string, unknown>[]; total: number }>('GET', `/api/v1/projects/${projectId}/library/search`, {
      query: { q, limit },
    }),
  libraryPapers: (projectId: string) =>
    request<{ items: Record<string, unknown>[] }>('GET', `/api/v1/projects/${projectId}/library/papers`),
  libraryNotebook: (projectId: string) =>
    request<{ entries: Record<string, unknown>[] }>('GET', `/api/v1/projects/${projectId}/library/notebook`),
  libraryNotes: (projectId: string, articleId: string) =>
    request<{ notes?: string; summary?: string; highlights?: unknown[] }>(
      'GET',
      `/api/v1/projects/${projectId}/library/articles/${articleId}/notes`,
    ),
  importLibraryContext: (projectId: string, body: { articleId?: string; paperId?: string; title?: string }) =>
    request<ContextEntry>('POST', `/api/v1/projects/${projectId}/library/context`, { body }),
}

/**
 * Sequence number of the newest durable event, so a stream can start at "now"
 * instead of replaying history.
 *
 * `GET /api/v1/events/head` answers in one call. Older backends do not have that
 * route, so a 404 falls back to paging forward — bounded, because a long-lived
 * backend would otherwise spend a hundred round trips before the city can start.
 */
export async function tailEventCursor(filters: Omit<StreamFilters, 'after'> = {}): Promise<number> {
  try {
    const head = await backend.eventsHead(filters)
    if (typeof head?.seq === 'number' && Number.isFinite(head.seq)) return Math.max(0, head.seq)
  } catch (error) {
    if (!isBackendError(error) || error.status !== 404) throw error
  }
  const limit = 1000
  let cursor = 0
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const result = await backend.events({ ...filters, after: cursor, limit })
    if (result.nextCursor <= cursor && result.items.length) break // backend not advancing: stop
    cursor = Math.max(cursor, result.nextCursor)
    if (result.items.length < limit) break
  }
  return cursor
}

export interface StreamFilters {
  after?: number
  taskId?: string
  sessionId?: string
  agentId?: string
  projectId?: string
}

export interface StreamHandlers {
  onEvent: (event: BackendEvent) => void
  /** Every failed attempt, with the reconnect already scheduled. */
  onError?: (error: unknown) => void
  /** Called after a (re)connection is established, for the connection badge. */
  onOpen?: () => void
}

/**
 * Durable SSE subscription to `/api/v1/events/stream`.
 *
 * Uses fetch rather than EventSource so the bearer token can be sent. What makes
 * it durable:
 *
 *   · resume — reconnects with `Last-Event-ID` *and* `after=<last seq>`, so no
 *     event is missed across a drop, and none is delivered twice (`seq` must
 *     advance or the event is dropped).
 *   · stall detection — the backend heartbeats every 15s; silence past 45s is a
 *     dead connection, which a bare `read()` would never report.
 *   · bounded retry — exponential backoff with jitter, capped, and it gives up on
 *     a `rejected` failure (a bad token or an unknown id will not fix itself).
 *
 * Returns an unsubscribe function.
 */
export function subscribeEvents(
  filters: StreamFilters,
  onEvent: StreamHandlers['onEvent'],
  onError?: StreamHandlers['onError'],
  onOpen?: StreamHandlers['onOpen'],
): () => void {
  const controller = new AbortController()
  let cursor = filters.after ?? 0
  let stopped = false

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const run = async () => {
    let backoff = 500
    while (!stopped) {
      try {
        const response = await openStream('/api/v1/events/stream', {
          query: { ...filters, after: cursor },
          signal: controller.signal,
          lastEventId: cursor || null,
        })
        onOpen?.()
        let delivered = 0
        for await (const data of readEventStream(response)) {
          if (stopped) break
          let event: BackendEvent
          try {
            event = JSON.parse(data) as BackendEvent
          } catch {
            continue // a truncated frame is re-sent from `cursor` after reconnect
          }
          if (typeof event.seq !== 'number' || !Number.isFinite(event.seq)) continue
          if (event.seq <= cursor) continue // replayed after a reconnect: already delivered
          cursor = event.seq
          delivered++
          try {
            onEvent(event)
          } catch (handlerError) {
            // A throwing consumer must not take the stream down with it.
            console.warn('[ghostgrid] event handler failed', handlerError)
          }
        }
        // A stream that ends cleanly is still a disconnection. Falling straight back into
        // `openStream` with no delay turned a backend that answers 200 and closes at once — a
        // worker shutting down, a proxy terminating the stream — into hundreds of requests a
        // second, each one firing `onOpen` and re-rendering every badge. Only a stream that
        // actually delivered something earns a reset of the backoff.
        if (stopped) return
        if (delivered) backoff = 500
        await sleep(backoff / 2 + Math.random() * (backoff / 2))
        backoff = Math.min(backoff * 2, 10_000)
      } catch (error) {
        if (stopped || controller.signal.aborted) return
        onError?.(error)
        // A 4xx is the request, not the connection: retrying it forever is a loop.
        if (isBackendError(error) && error.kind === 'rejected') return
        await sleep(backoff / 2 + Math.random() * (backoff / 2))
        backoff = Math.min(backoff * 2, 10_000)
      }
    }
  }
  void run()

  return () => {
    stopped = true
    controller.abort()
  }
}

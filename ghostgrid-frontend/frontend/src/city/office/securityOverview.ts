import type { BackendAgent, BackendSession, BackendTask, BackendUsageRecord } from '../../api/backend'

export type SessionActivity = 'running' | 'awaiting_approval' | 'queued' | 'error' | 'idle' | 'archived'
export const ACTIVITY_LABEL: Record<SessionActivity, string> = {
  running: 'Running', awaiting_approval: 'Needs approval', queued: 'Queued', error: 'Error', idle: 'Idle', archived: 'Archived',
}
export const ACTIVITY_ORDER: Record<SessionActivity, number> = { running: 0, awaiting_approval: 1, queued: 2, error: 3, idle: 4, archived: 5 }

export interface Spend {
  reported: number
  estimated: number
  estimatedRecords: number
  unknown: number
  records: number
  tokens: number
  unknownTokens: number
}
export const emptySpend = (): Spend => ({ reported: 0, estimated: 0, estimatedRecords: 0, unknown: 0, records: 0, tokens: 0, unknownTokens: 0 })
export const totalSpend = (spend: Spend) => spend.reported + spend.estimated
export function addUsage(spend: Spend, usage: BackendUsageRecord) {
  spend.records++
  spend.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  if (usage.inputTokens === null || usage.outputTokens === null) spend.unknownTokens++
  if (usage.costUsd !== null) spend.reported += usage.costUsd
  else if (usage.estimatedCostUsd !== null) { spend.estimated += usage.estimatedCostUsd; spend.estimatedRecords++ }
  else spend.unknown++
}

export interface SessionRow {
  id: string
  name: string
  agentId: string
  agentName: string
  status: SessionActivity
  activity: string
  updatedAt: string
  spend: Spend
}
export interface AgentRow { id: string; name: string; sessions: number; running: number; spend: Spend }

export function sessionActivity(session: BackendSession, tasks: BackendTask[]): SessionActivity {
  if (tasks.some((t) => t.status === 'running')) return 'running'
  if (tasks.some((t) => t.status === 'awaiting_approval')) return 'awaiting_approval'
  if (tasks.some((t) => t.status === 'queued' || t.status === 'pending')) return 'queued'
  if (session.status === 'archived') return 'archived'
  const latest = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return latest?.status === 'failed' ? 'error' : 'idle'
}

export function buildSecurityOverview(sessions: BackendSession[], agents: BackendAgent[], tasks: BackendTask[], usage: BackendUsageRecord[]) {
  const names = new Map(agents.map((a) => [a.id, a.name]))
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const sessionTasks = new Map<string, BackendTask[]>()
  for (const task of tasks) {
    if (task.sessionId) sessionTasks.set(task.sessionId, [...(sessionTasks.get(task.sessionId) ?? []), task])
  }
  const agentRows = new Map<string, AgentRow>()
  const ensureAgent = (id: string): AgentRow => {
    let row = agentRows.get(id)
    if (!row) {
      row = { id, name: names.get(id) ?? 'Unknown agent', sessions: 0, running: 0, spend: emptySpend() }
      agentRows.set(id, row)
    }
    return row
  }
  const rows: SessionRow[] = sessions.map((session) => {
    const ownTasks = sessionTasks.get(session.id) ?? []
    const status = sessionActivity(session, ownTasks)
    const agent = ensureAgent(session.agentId)
    agent.sessions++
    if (status === 'running') agent.running++
    const current = ownTasks.find((t) => t.status === 'running' || t.status === 'awaiting_approval')
      ?? [...ownTasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return { id: session.id, name: session.name, agentId: session.agentId, agentName: agent.name, status,
      activity: current?.title ?? 'No tasks yet', updatedAt: current?.updatedAt ?? session.updatedAt, spend: emptySpend() }
  })
  const bySession = new Map(rows.map((r) => [r.id, r]))
  const totals = emptySpend()
  for (const record of usage) {
    addUsage(totals, record)
    addUsage(ensureAgent(record.agentId).spend, record)
    const sessionId = taskById.get(record.taskId)?.sessionId
    const row = sessionId ? bySession.get(sessionId) : undefined
    if (row) addUsage(row.spend, record)
  }
  const standaloneTasks = tasks.filter((t) => !t.sessionId && ['running', 'pending', 'queued', 'awaiting_approval'].includes(t.status))
  return { sessions: rows, agents: [...agentRows.values()].sort((a, b) => totalSpend(b.spend) - totalSpend(a.spend) || b.spend.tokens - a.spend.tokens), totals, standaloneTasks }
}

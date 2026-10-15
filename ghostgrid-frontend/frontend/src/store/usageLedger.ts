// One ledger for everything the city's agents actually spend, because the city has one currency.
//
// Three kinds of LLM work happen here and each reports differently:
//   - API agents (DeepSeek, Groq, Claude SDK, custom endpoints) — the backend writes a usage
//     record per request, grouped per provider and per agent in `usage`.
//   - Local coding CLIs (Codex CLI, Claude Code) — billed to the user's own subscription, so
//     nothing reaches the usage table; the backend reads their JSONL transcripts instead and
//     reports them as credit rows with `source: 'local-cli'`.
//   - Personal agents on Agent Row (Grok, Dots, Muse) — API agents like any other once they
//     have a backend agent, which is why they are attributed by building id here too.
//
// Before this module the HUD's CREDITS only counted the first kind, so a day spent in Codex CLI
// moved nothing in the city. The ledger adds them up once and every surface reads it.
//
// Tokens are counted as input + output for both kinds. A CLI's `tokensUsed` also folds in cache
// reads, which run an order of magnitude larger and would swamp the API numbers next to them;
// the cache figure is kept separately so the dropdown can still show it.
import { useMemo } from 'react'
import { useCreditsStore } from './credits'
import {
  CREDIT_LABEL,
  cachedCreditTokens,
  freshCreditTokens,
  isLocalCli,
  type CreditRow,
} from '../api/providerCredits'
import type { BuildingId } from '../types'

/** Which city building runs each local CLI. The CLI is the building's real runtime. */
const CLI_BUILDING: Record<string, BuildingId> = {
  'codex-cli': 'codex',
  'claude-code': 'claude',
}

/** Bucket for spend by an agent that belongs to no city building. Not a real building id. */
export const UNASSIGNED = 'unassigned'

export type UsageKind = 'api' | 'cli'

export interface UsageSource {
  /** Provider record id, vendor key, or CLI id — unique within the ledger. */
  key: string
  label: string
  kind: UsageKind
  tokens: number
  requests: number
  /** The building this source runs in, when one owns it. */
  buildingId?: BuildingId
}

export interface BuildingUsage {
  tokens: number
  requests: number
  /** Reported plus estimated USD. Real money, so it is never shown in the city HUD. */
  costUsd: number
  /** Requests the provider priced at nothing we can read. */
  unpricedRequests: number
  /** Requests with no token counts at all (the mock runtime, mostly). */
  untokenedRequests: number
  kinds: UsageKind[]
  sources: string[]
}

export interface UsageLedger {
  /** False when the backend could not be read, so there are no numbers rather than zeroes. */
  reachable: boolean
  /** Tokens recorded against our own API keys. */
  apiTokens: number
  /** Fresh (non-cached) tokens the local CLIs spent on their subscriptions. */
  cliTokens: number
  /** What the city spends as currency: every agent's tokens, whoever billed them. */
  tokens: number
  requests: number
  apiRequests: number
  cliRequests: number
  /** Cache reads/writes the CLIs report on top of `cliTokens`. */
  cliCacheTokens: number
  /** Requests that reported no token counts, so `tokens` understates them. */
  untokenedRequests: number
  sources: UsageSource[]
  byBuilding: Record<BuildingId, BuildingUsage>
}

const emptyBuilding = (): BuildingUsage => ({
  tokens: 0, requests: 0, costUsd: 0, unpricedRequests: 0, untokenedRequests: 0, kinds: [], sources: [],
})

/** Tokens on a backend usage group (totals / per provider / per agent). Credit rows use
 *  `freshCreditTokens`, which also copes with a row that only reports a lifetime total. */
const freshTokens = (row: { inputTokens?: number; outputTokens?: number }) =>
  (row.inputTokens ?? 0) + (row.outputTokens ?? 0)

const cliLabel = (row: CreditRow) => row.name ?? CREDIT_LABEL[String(row.provider)] ?? String(row.provider)

/** Adds one source's numbers to the building that owns it. */
function attribute(
  into: Record<BuildingId, BuildingUsage>,
  buildingId: BuildingId,
  kind: UsageKind,
  label: string,
  numbers: { tokens: number; requests: number; costUsd?: number; unpriced?: number; untokened?: number },
) {
  const entry = (into[buildingId] ??= emptyBuilding())
  entry.tokens += numbers.tokens
  entry.requests += numbers.requests
  entry.costUsd += numbers.costUsd ?? 0
  entry.unpricedRequests += numbers.unpriced ?? 0
  entry.untokenedRequests += numbers.untokened ?? 0
  if (!entry.kinds.includes(kind)) entry.kinds.push(kind)
  if (!entry.sources.includes(label)) entry.sources.push(label)
}

/**
 * Folds a credits snapshot into the ledger. Pure, so the hook below is only subscription.
 *
 * An unreachable backend yields `reachable: false` and no numbers: a city that shows 0 tokens
 * because nothing could be read looks exactly like a city that has not run anything, and the
 * two mean very different things.
 */
export function buildLedger(snapshot: ReturnType<typeof useCreditsStore.getState>['snapshot']): UsageLedger {
  const ledger: UsageLedger = {
    reachable: !!snapshot && !snapshot.offline,
    apiTokens: 0, cliTokens: 0, tokens: 0,
    requests: 0, apiRequests: 0, cliRequests: 0,
    cliCacheTokens: 0, untokenedRequests: 0,
    sources: [], byBuilding: {},
  }
  if (!snapshot) return ledger
  const usage = snapshot.usage
  const rows = snapshot.rows ?? []

  // ---- API usage: the backend's own records ----
  if (usage) {
    ledger.apiTokens = freshTokens(usage.totals)
    ledger.apiRequests = usage.totals.requests
    ledger.untokenedRequests = usage.totals.unknownTokenRequests
    for (const provider of usage.providers) {
      const tokens = freshTokens(provider)
      if (!tokens && !provider.requests) continue
      // The mock runtime answers tasks without a key and reports no token counts, so it can only
      // ever be a 0-token row in a list about tokens. Its requests still count in the totals.
      if (provider.type === 'mock') continue
      ledger.sources.push({
        key: provider.providerId ?? provider.type ?? 'unknown',
        label: provider.name ?? provider.type ?? 'Unknown provider',
        kind: 'api',
        tokens,
        requests: provider.requests,
      })
    }
    // Per-agent rows are what tie spend to a building — including the Agent Row houses.
    // An agent that owns no building (an API client's own agent, or a hand-made one from early
    // dev) still spent real tokens, so it goes to UNASSIGNED rather than being dropped: the
    // backend guarantees every row carries an agentId and a name even when buildingId is null.
    for (const agent of usage.agents ?? []) {
      const key = agent.buildingId ?? UNASSIGNED
      attribute(ledger.byBuilding, key, 'api', agent.name ?? agent.agentId ?? 'API', {
        tokens: freshTokens(agent),
        requests: agent.requests,
        costUsd: agent.reportedCostUsd + agent.estimatedCostUsd,
        unpriced: agent.unknownCostRequests,
        untokened: agent.unknownTokenRequests,
      })
    }
  } else if (ledger.reachable) {
    // An older backend serves credit rows without the usage summary; their recorded token
    // counts are the same numbers, just already grouped by vendor.
    for (const row of rows.filter((r) => !isLocalCli(r))) {
      ledger.apiTokens += freshCreditTokens(row)
      ledger.apiRequests += row.requests ?? 0
      ledger.untokenedRequests += row.unknownTokenRequests ?? 0
    }
  }

  // ---- Subscription CLIs: read from their own transcripts ----
  for (const row of rows) {
    if (!isLocalCli(row) || row.status === 'error') continue
    // Same definition the credits dropdown prints per row, so the two can never disagree.
    const tokens = freshCreditTokens(row)
    const requests = row.requests ?? 0
    const label = cliLabel(row)
    ledger.cliTokens += tokens
    ledger.cliRequests += requests
    ledger.cliCacheTokens += cachedCreditTokens(row)
    const buildingId = CLI_BUILDING[String(row.provider)]
    ledger.sources.push({ key: String(row.provider), label, kind: 'cli', tokens, requests, buildingId })
    // A subscription has no per-request price, so the CLI adds tokens to its building but
    // never a dollar figure.
    if (buildingId) attribute(ledger.byBuilding, buildingId, 'cli', label, { tokens, requests })
  }

  ledger.tokens = ledger.apiTokens + ledger.cliTokens
  ledger.requests = ledger.apiRequests + ledger.cliRequests
  ledger.sources.sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
  return ledger
}

/** The city's usage ledger. Reads the shared credits snapshot; it does not fetch. */
export function useUsageLedger(): UsageLedger {
  const snapshot = useCreditsStore((s) => s.snapshot)
  return useMemo(() => buildLedger(snapshot), [snapshot])
}

/** One building's recorded usage, or null when nothing has been recorded for it. */
export function useBuildingUsage(buildingId: BuildingId): BuildingUsage | null {
  const ledger = useUsageLedger()
  return ledger.byBuilding[buildingId] ?? null
}

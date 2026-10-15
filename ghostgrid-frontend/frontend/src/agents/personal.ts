// The personal-agent neighbourhood: the player's own assistants, one house per agent, on the
// 3x3 plots of Agent Row (AGENT_LOTS in city3d/world.ts). The row is a quarter of Stochastic
// Park, the north-west plate — houses and a garden rather than a corner of the downtown island,
// and still the far side of the city from Wall Street: the player's own agents are not part of
// the trading floor.
//
// These are not provider buildings and not bots on a schedule: they are personal agents you talk
// to. Each house carries its agent's avatar glyph on the front board and its own accent light.
// Nothing here calls anything — `endpoint` is where a personal agent gets wired up later.
import type { BuildingId } from '../types'

export interface PersonalAgent {
  id: string // slug, also the building id suffix
  name: string // "Grok Bot"
  short: string // pixel label, <= 10 characters
  lot: number
  accent: string
  role: string // one line, shown in the side panel
  /** 8x8 avatar: '#' = accent pixel, '.' = empty. Drawn on the house's front board. */
  glyph: string[]
}

export const AGENT_DISTRICT = 'Agent Row'

// The seeded roster lived here: Grok Bot, Dots and Muse, three houses the city opened with.
// None of them called anything — `endpoint` was always empty — so they are gone rather than
// standing as furniture. The type and the helpers stay: an 'agent' house you place yourself is
// an ordinary building, and `personalAgentFor` simply finds nothing for it.
export const PERSONAL_AGENTS: PersonalAgent[] = []

export const agentBuildingId = (id: string): BuildingId => `agent_${id}`

export const personalAgentFor = (buildingId: BuildingId): PersonalAgent | undefined =>
  PERSONAL_AGENTS.find((a) => agentBuildingId(a.id) === buildingId)

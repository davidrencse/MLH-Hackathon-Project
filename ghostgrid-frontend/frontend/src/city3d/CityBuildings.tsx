// Renders every building in the store with its type-specific art inside a BuildingShell.
import type { ComponentType } from 'react'
import { useBuildingList } from '../store/grid'
import type { BuildingType } from '../types'
import { BotBuilding } from './buildings/BotBuilding'
import { ClaudeNexus } from './buildings/ClaudeNexus'
import { CodexTower } from './buildings/CodexTower'
import { CursorStudio } from './buildings/CursorStudio'
import { DeepSeekForge } from './buildings/DeepSeekForge'
import { GroqSpeedway } from './buildings/GroqSpeedway'
import { LibraryOfBabel } from './buildings/LibraryOfBabel'
import { SecurityCheckpoint } from './buildings/SecurityCheckpoint'
import { AgentHouse } from './buildings/AgentHouse'
import { WallStreetTower } from './buildings/WallStreetTower'
import { BuildingShell } from './BuildingShell'

const ART: Record<BuildingType, ComponentType> = {
  codex: CodexTower,
  cursor: CursorStudio,
  claude: ClaudeNexus,
  deepseek: DeepSeekForge,
  groq: GroqSpeedway,
  security: SecurityCheckpoint,
  bot: BotBuilding,
  library: LibraryOfBabel,
  quant: WallStreetTower,
  agent: AgentHouse,
}

export function CityBuildings() {
  const list = useBuildingList()
  return (
    <>
      {list.map((b) => {
        const Art = ART[b.type]
        // A type with no art yet is skipped. Rendering `undefined` as an element throws
        // inside the Canvas, and that error unmounts the whole city, not just one lot.
        if (!Art) return null
        return (
          <BuildingShell key={b.id} building={b}>
            <Art />
          </BuildingShell>
        )
      })}
    </>
  )
}

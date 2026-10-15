// The two city buildings. Rendered inside the 384x216 logical stage (see ../layout.ts).
// Only codex / security have 2D art; the other store buildings are not drawn here.
import { Building } from './Building'
import { CodexTower } from './CodexTower'
import { SecurityCheckpoint } from './SecurityCheckpoint'
import './buildings.css'

export function Buildings() {
  return (
    <>
      <Building id="codex" mark={{ x: 32, y: -4 }} nokeyY={86} glitch={[31, 74]}>
        <CodexTower />
      </Building>
      <Building id="security" mark={{ x: 40, y: 3 }} nokeyY={42} glitch={[21, 48]}>
        <SecurityCheckpoint />
      </Building>
    </>
  )
}

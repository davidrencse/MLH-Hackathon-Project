import { useBuildingList } from '../store/grid'
import { BuildingShell } from './BuildingShell'
import { VoxelBuilding } from './buildings/VoxelBuilding'

export function CityBuildings() {
  const list = useBuildingList()
  return <>{list.map((building) => <BuildingShell key={building.id} building={building}><VoxelBuilding /></BuildingShell>)}</>
}

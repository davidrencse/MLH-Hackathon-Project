// Composes the city: WebGL scene + DOM HUD overlays.
import { lazy, Suspense, useEffect } from 'react'
import { hasWebGL } from '../city2d/webgl'
import { TopNav } from '../components/TopNav'
import { WeatherWidget } from '../components/WeatherWidget'
import { useGrid } from '../store/grid'
import { BuildingNav } from './BuildingNav'
import { BuildMenu } from './BuildMenu'
import { OfficeView } from './office/OfficeView'
import { PanelBoundary, SceneBoundary, SceneDown } from './SceneBoundary'
import { SidePanel } from './SidePanel'

// Without WebGL, fall back to the older 2D DOM city (loaded only when needed).
const City2D = lazy(() => import('../city2d/City2D').then((m) => ({ default: m.City2D })))
const CityCanvas = lazy(() => import('../city3d/CityCanvas').then((m) => ({ default: m.CityCanvas })))

export function CityPage() {
  const loadInitialLogs = useGrid((s) => s.loadInitialLogs)
  const loadWallStreet = useGrid((s) => s.loadWallStreet)
  useEffect(() => {
    if (useGrid.getState().logs.length === 0) void loadInitialLogs()
    // Wall Street towers start on the bundled roster; this swaps in live GitHub metadata.
    void loadWallStreet()
  }, [loadInitialLogs, loadWallStreet])

  return (
    <div className="relative h-full w-full overflow-hidden bg-gg-void">
      {/* A scene that throws (missing chunk, refused WebGL context) drops to the DOM city
          rather than leaving the player a blank page; the HUD below keeps working either way. */}
      <SceneBoundary
        label="3D city"
        fallback={
          <SceneBoundary label="2D city" fallback={<SceneDown />}>
            <Suspense fallback={null}>
              <City2D />
            </Suspense>
          </SceneBoundary>
        }
      >
        <Suspense fallback={<div role="status" className="absolute inset-0 flex items-center justify-center font-mono text-lg text-gg-mute">Loading city…</div>}>
          {hasWebGL() ? <CityCanvas /> : <City2D />}
        </Suspense>
      </SceneBoundary>
      {/* Each HUD surface fails alone. They read backend data the compiler cannot vouch for,
          and they are edited concurrently, so one throw must not cost the whole page. */}
      <PanelBoundary label="Top nav"><TopNav /></PanelBoundary>
      <PanelBoundary label="Weather"><WeatherWidget /></PanelBoundary>
      <PanelBoundary label="Build menu"><BuildMenu /></PanelBoundary>
      <PanelBoundary label="Building nav"><BuildingNav /></PanelBoundary>
      <PanelBoundary label="Side panel"><SidePanel /></PanelBoundary>
      <PanelBoundary label="Office"><OfficeView /></PanelBoundary>
    </div>
  )
}

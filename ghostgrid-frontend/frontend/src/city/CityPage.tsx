// Composes the city: WebGL scene + DOM HUD overlays.
import { lazy, Suspense, useEffect, useState } from 'react'
import { hasWebGL } from '../city2d/webgl'
import { TopNav } from '../components/TopNav'
import { WeatherWidget } from '../components/WeatherWidget'
import { useGrid } from '../store/grid'
import { BuildMenu } from './BuildMenu'
import { OfficeView } from './office/OfficeView'
import { SidePanel } from './SidePanel'
import { DozerButton } from './DozerButton'
import { MobileCityControls } from './MobileCityControls'
import './mobile-city.css'

// Without WebGL, fall back to the older 2D DOM city (loaded only when needed).
const City2D = lazy(() => import('../city2d/City2D').then((m) => ({ default: m.City2D })))
const CityCanvas = lazy(() => import('../city3d/CityCanvas').then((m) => ({ default: m.CityCanvas })))

export function CityPage() {
  const [mobilePanel, setMobilePanel] = useState<'build' | 'directory' | null>(null)
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobilePanel(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const loadInitialLogs = useGrid((s) => s.loadInitialLogs)
  useEffect(() => {
    if (useGrid.getState().logs.length === 0) void loadInitialLogs()
  }, [loadInitialLogs])

  return (
    <div className="gg-city-page relative h-full w-full overflow-hidden bg-gg-void">
      <Suspense fallback={<div role="status" className="absolute inset-0 flex items-center justify-center font-mono text-lg text-gg-mute">Loading city…</div>}>
        {hasWebGL() ? <CityCanvas /> : <City2D />}
        {hasWebGL() && <DozerButton />}
      </Suspense>
      <TopNav />
      <WeatherWidget />
      <BuildMenu expanded={mobilePanel === 'build'} onToggle={() => setMobilePanel(mobilePanel === 'build' ? null : 'build')} onClose={() => setMobilePanel(null)} />
      <MobileCityControls directory={mobilePanel === 'directory'} onToggle={() => setMobilePanel(mobilePanel === 'directory' ? null : 'directory')} onClose={() => setMobilePanel(null)} />
      <SidePanel />
      <OfficeView />
    </div>
  )
}

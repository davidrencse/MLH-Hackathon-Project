// The 2D DOM city: the fallback scene when WebGL is not available (see ./webgl.ts).
// Only the scene layers live here. CityPage renders the HUD (BuildingNav, BuildMenu, SidePanel) on top.
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Buildings } from './buildings/Buildings'
import { FlightLayer } from './FlightLayer'
import { CHROME, STAGE, computeStageScale } from './layout'
import { Rain2D } from './Rain2D'
import { ShaderSky } from './ShaderSky'
import { Skyline } from './Skyline'

function useStageScale() {
  const [scale, setScale] = useState(() => computeStageScale(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const onResize = () => setScale(computeStageScale(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

export function City2D() {
  const scale = useStageScale()

  return (
    <div
      className="absolute inset-0 isolate overflow-hidden"
      style={
        {
          '--stage-scale': scale,
          '--stage-w': `${STAGE.w * scale}px`,
          '--stage-h': `${STAGE.h * scale}px`,
          // distance from viewport bottom to the street's top edge, in real px
          '--ground-bottom': `${CHROME.bottom + (STAGE.h - STAGE.ground) * scale}px`,
        } as CSSProperties
      }
    >
      <ShaderSky />
      <Skyline />
      {/* Real NYC rain, over the whole scene (see weather/nyc.ts). */}
      <Rain2D />

      {/* Integer-scaled stage, bottom-centered */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center" style={{ top: CHROME.top, bottom: CHROME.bottom }}>
        <div className="relative self-end" style={{ width: STAGE.w * scale, height: STAGE.h * scale }}>
          <div
            className="pixelated absolute left-0 top-0 origin-top-left"
            style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
          >
            <Buildings />
            <FlightLayer />
          </div>
        </div>
      </div>
    </div>
  )
}

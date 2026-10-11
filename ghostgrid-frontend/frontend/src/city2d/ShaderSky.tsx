// Layer 1 of the 2D city: the night sky behind everything.
// Pure CSS: banded gradient + horizon glows + slow nebula drift (see shader-sky.css).
// The WebGPU `shaders` path was removed together with the `shaders` package.
import { useGrid } from '../store/grid'
import './shader-sky.css'

type SkyTint = 'calm' | 'approval' | 'error'

// One primitive string, so the selector never returns a new object (zustand v5).
function useSkyTint(): SkyTint {
  return useGrid((s) => {
    let approval = false
    for (const b of Object.values(s.buildings)) {
      if (b.status === 'error') return 'error'
      if (b.status === 'needs_approval') approval = true
    }
    return approval ? 'approval' : 'calm'
  })
}

export function ShaderSky() {
  const tint = useSkyTint()

  return (
    <div className="gg-atmo-root" aria-hidden="true">
      <div className="gg-atmo-css" />
      <div className="gg-atmo-css-nebula" />

      {/* State tint: CSS so color changes cross-fade smoothly over the sky. */}
      <div className="gg-atmo-tint gg-atmo-tint--approval" data-on={tint === 'approval'} />
      <div className="gg-atmo-tint gg-atmo-tint--error" data-on={tint === 'error'} />
      <div className="gg-atmo-scan" />
    </div>
  )
}

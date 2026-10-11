// Post effects: bloom on neon / bright emissive only, plus a subtle vignette. The composer renders at the
// canvas' 1/3 resolution, so the glow upscales as chunky pixels like the rest of the scene.
// Bloom and vignette merge into one EffectPass. No MSAA (pixel art + cheaper).
// Safety: if the composer throws, the boundary drops it and R3F renders the scene without effects.
// While the tab is hidden the composer is disabled.
import { useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HalfFloatType, UnsignedByteType } from 'three'

class EffectsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[Ghost Grid] post-processing disabled, rendering without it:', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function Effects() {
  const gl = useThree((s) => s.gl)
  const [visible, setVisible] = useState(() => !document.hidden)

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Half-float targets keep neon values above 1.0, which the bloom threshold needs.
  // Without float render targets, use 8-bit buffers (neon clips to 1.0 and still passes the threshold).
  const frameBufferType = useMemo(
    () =>
      gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float')
        ? HalfFloatType
        : UnsignedByteType,
    [gl],
  )

  return (
    <EffectsBoundary>
      <EffectComposer enabled={visible} multisampling={0} stencilBuffer={false} frameBufferType={frameBufferType}>
        <Bloom mipmapBlur luminanceThreshold={0.75} luminanceSmoothing={0.1} intensity={1.1} radius={0.6} levels={5} />
        <Vignette offset={0.32} darkness={0.5} />
      </EffectComposer>
    </EffectsBoundary>
  )
}

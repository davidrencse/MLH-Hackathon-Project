// The WebGL city. One <Canvas>, orthographic 2:1 iso camera, rendered at 1/PIXEL_SIZE resolution
// and upscaled with nearest-neighbour for a crisp 3D pixel-art look (and cheap fill rate).
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useGrid } from '../store/grid'
import type { Building } from '../types'
import { Atmosphere } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { CityBuildings } from './CityBuildings'
import { Drones } from './Drones'
import { Zeppelins } from './Zeppelins'
import { Citizens } from './Citizens'
import { Effects } from './Effects'
import { Ground } from './Ground'
import { Scenery } from './scenery/Scenery'
import { BuildingLabels, LabelProjector } from './Labels'
import { PALETTE } from './materials'
import { BUILDING_HEIGHT, CAMERA, lotCenter, PIXEL_SIZE } from './world'

// Lights: exactly 3 (hemisphere, moon, one alert light). No real-time shadows —
// BuildingShell draws cheap fake shadows instead. Never add lights elsewhere: changing the
// light count recompiles every shader.
function AlertLight() {
  // Moves to the building that is in error (red) or waiting for approval (yellow) and blinks.
  const ref = useRef<THREE.PointLight>(null)
  useFrame(({ clock }) => {
    const light = ref.current
    if (!light) return
    const s = useGrid.getState()
    let target: Building | null = null
    for (const id of s.order) {
      const b = s.buildings[id]
      if (b.status === 'error') {
        target = b
        break
      }
      if (b.status === 'needs_approval' && !target) target = b
    }
    if (!target) {
      light.intensity = 0
      return
    }
    const [x, , z] = lotCenter(target.lot)
    light.position.set(x, BUILDING_HEIGHT[target.type] * 1.8 + 1.2, z)
    light.color.set(target.status === 'error' ? PALETTE.red : PALETTE.yellow)
    light.intensity = Math.floor(clock.elapsedTime / 0.3) % 2 ? 45 : 8
  })
  return <pointLight ref={ref} distance={10} decay={1.4} intensity={0} />
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#6a56c8', '#140c34', 1.6]} />
      <directionalLight position={[-9, 16, 7]} intensity={1.5} color="#a9b8ff" />
      <AlertLight />
    </>
  )
}

export function CityCanvas() {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  return (
    <div className="gg-city-canvas absolute inset-0 z-10">
      <Canvas
        orthographic
        frameloop={visible ? 'always' : 'never'}
        dpr={Math.min(2, window.devicePixelRatio || 1) / PIXEL_SIZE}
        camera={{ position: CAMERA.position, zoom: CAMERA.zoom, near: CAMERA.near, far: CAMERA.far }}
        gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
        onCreated={({ gl }) => {
          gl.domElement.style.imageRendering = 'pixelated'
        }}
        onPointerMissed={() => {
          const s = useGrid.getState()
          if (!s.buildMode && s.panel === 'building') s.closePanel()
        }}
      >
        <color attach="background" args={[PALETTE.void]} />
        <fog attach="fog" args={['#170d3d', 30, 64]} />
        <Lights />
        <Atmosphere />
        <Ground />
        <Scenery />
        <CityBuildings />
        <Drones />
        <Zeppelins />
        <Citizens />
        <CameraRig />
        <LabelProjector />
        <Effects />
      </Canvas>
      <BuildingLabels />
    </div>
  )
}

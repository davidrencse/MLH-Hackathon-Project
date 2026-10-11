// Router Spire, img2threejs build: a CN-Tower-style procedural model (see ../models/routerSpireModel).
// Rendered inside BuildingShell at the lot center. The pod roof sits at y = 7 (= BuildingCtx height),
// so drones still dock at height + 0.6. The scene uses fake shadows, so shadows stay off.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { createRouterSpireModel } from '../models/routerSpireModel'

export function RouterSpireImg() {
  const model = useMemo(() => {
    const m = createRouterSpireModel()
    m.traverse((o) => {
      o.castShadow = false
      o.receiveShadow = false
    })
    return m
  }, [])
  const ring = useMemo(() => model.getObjectByName('lightRing'), [model])

  // The factory owns its geometries/materials: free them when the building unmounts.
  useEffect(
    () => () => {
      const geos = new Set<THREE.BufferGeometry>()
      const mats = new Set<THREE.Material>()
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry)
          mats.add(o.material as THREE.Material)
        }
      })
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
    },
    [model],
  )

  useFrame((_, delta) => {
    if (ring) ring.rotation.y += Math.min(delta, 0.1) * 0.4 // slow spin, 0.4 rad/s
  })

  return <primitive object={model} />
}

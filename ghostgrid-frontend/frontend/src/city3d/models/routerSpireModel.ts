// Router Spire model: procedural, low-poly, cyberpunk-night restyle of Toronto's CN Tower
// (Y-shaped tapered concrete shaft, stacked observation pod, SkyPod, antenna mast).
// Built with the img2threejs skill from one side-on reference photo (modeling reference only, not shipped).
// Origin: base center on the ground, +y up. Footprint 1.58 x 1.4. Pod roof at y = 7, antenna tip ~ y = 9.
// Named nodes for callers:
//   "pod"           group, pivot at the pod center (y = 6.5)
//   "lightRing"     group inside "pod": 12 alternating cyan/pink window lights, spin it around y
//   "antenna"       group, pivot on the pod roof (y = 7): neck, SkyPod, mast, tip lamp
//   "aviationLight" red lamp mesh on the antenna tip (y = 8.98)
// Budget: 27 meshes (2 of them InstancedMesh), ~830 triangles. Each geometry/material is created once.
import * as THREE from 'three'

const BASE_H = 0.16 // plinth height
const SHAFT_TOP = 6.16 // shaft ends inside the pod bulb
const POD_Y = 6.5 // pod center; pod spans 6.04 .. 7.0
const ROOF_Y = 7 // = BUILDING_HEIGHT.router (drones dock at roof + 0.6)
const FIN_YAW = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3] // the three wings of the Y-shaped shaft
const HEX_START = Math.PI / 2 // puts a hexagon corner on +x, so each wing meets a corner

export function createRouterSpireModel(): THREE.Group {
  // ---- materials (once) ----
  const night = new THREE.MeshLambertMaterial({ color: '#1a1040' })
  const dusk = new THREE.MeshLambertMaterial({ color: '#2a1a5e' })
  const haze = new THREE.MeshLambertMaterial({ color: '#3d2a7a' })
  // Neon: unlit, x2 like the scene's other neon so bloom picks it up.
  const neon = (hex: string, k: number) =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false })
  const cyan = neon('#00f0ff', 2)
  const pink = neon('#ff2bd6', 2)
  const red = neon('#ff3355', 3)

  // ---- geometries (once) ----
  const box = new THREE.BoxGeometry(1, 1, 1) // strips, window lights and the tip lamp are scaled boxes
  const plinthGeo = new THREE.CylinderGeometry(0.78, 0.78, BASE_H, 6, 1, false, HEX_START)
  const plinthTrimGeo = new THREE.CylinderGeometry(0.79, 0.79, 0.08, 6, 1, true, HEX_START)
  const coreGeo = new THREE.CylinderGeometry(0.15, 0.32, SHAFT_TOP - BASE_H, 6, 1, false, HEX_START)
  // Wing: side profile (x = radial reach, y = height), extruded 0.16 thick, centered on z.
  const finShape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.6, 0),
    new THREE.Vector2(0.19, 5.95),
    new THREE.Vector2(0, 5.95),
  ])
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.16, bevelEnabled: false })
  finGeo.translate(0, BASE_H, -0.08)
  const bulbGeo = new THREE.CylinderGeometry(0.64, 0.3, 0.26, 16)
  const lowBandGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.14, 16)
  const deckGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.1, 16)
  const deckStripeGeo = new THREE.CylinderGeometry(0.705, 0.705, 0.06, 16, 1, true)
  const upBandGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.16, 16)
  const capGeo = new THREE.CylinderGeometry(0.36, 0.56, 0.3, 16)
  const roofRimGeo = new THREE.CylinderGeometry(0.405, 0.405, 0.07, 16, 1, true)
  const neckGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.75, 6)
  const skyPodGeo = new THREE.CylinderGeometry(0.2, 0.17, 0.14, 10)
  const skyStripeGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.06, 10, 1, true)
  const mastGeo = new THREE.CylinderGeometry(0.045, 0.075, 1.05, 6)
  const mastBandGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 6, 1, true)

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, name = '') => {
    const m = new THREE.Mesh(geo, mat)
    m.position.y = y
    m.name = name
    parent.add(m)
    return m
  }
  // Neon strip along a tapering edge: radial distance r0 at y0 -> r1 at y1, in the wing plane at `yaw`.
  // Euler XYZ applies the tilt (z) first, then the yaw (y).
  const strip = (parent: THREE.Object3D, mat: THREE.Material, yaw: number, r0: number, y0: number, r1: number, y1: number) => {
    const rm = (r0 + r1) / 2
    const m = add(parent, box, mat, (y0 + y1) / 2)
    m.position.x = rm * Math.cos(yaw)
    m.position.z = -rm * Math.sin(yaw)
    m.rotation.set(0, yaw, Math.atan2(r0 - r1, y1 - y0))
    m.scale.set(0.12, Math.hypot(r0 - r1, y1 - y0), 0.1) // >= 1 px wide at the game's 1/3 resolution
  }

  const root = new THREE.Group()
  root.name = 'routerSpire'

  // ---- base + Y-shaped tapered shaft ----
  add(root, plinthGeo, night, BASE_H / 2, 'base')
  add(root, plinthTrimGeo, cyan, BASE_H - 0.04)
  add(root, coreGeo, dusk, (BASE_H + SHAFT_TOP) / 2, 'shaft')
  for (const yaw of FIN_YAW) {
    add(root, finGeo, haze).rotation.y = yaw
    strip(root, cyan, yaw, 0.6, 0.2, 0.2, 6.0) // wing edge
    strip(root, pink, yaw + Math.PI / 3, 0.319, 0.2, 0.155, 6.0) // core corner between wings (elevator glass)
  }

  // ---- observation pod (stacked rings, bottom to top) ----
  const pod = new THREE.Group()
  pod.name = 'pod'
  pod.position.y = POD_Y
  root.add(pod)
  add(pod, bulbGeo, haze, -0.33) // 6.04 .. 6.30 bulb under the pod
  add(pod, lowBandGeo, night, -0.13) // lower window band
  add(pod, deckGeo, haze, -0.01) // wide outdoor deck ring
  add(pod, deckStripeGeo, pink, -0.01) // the tower's red stripe, as pink neon
  add(pod, upBandGeo, night, 0.12) // upper window band, wrapped by the light ring
  add(pod, capGeo, dusk, ROOF_Y - POD_Y - 0.15) // cap; its flat top is the roof at y = 7
  add(pod, roofRimGeo, cyan, ROOF_Y - POD_Y - 0.02)

  const ring = new THREE.Group()
  ring.name = 'lightRing'
  ring.position.y = 0.12
  pod.add(ring)
  const LIGHTS = 12
  const lightsA = new THREE.InstancedMesh(box, cyan, LIGHTS / 2)
  const lightsB = new THREE.InstancedMesh(box, pink, LIGHTS / 2)
  const o = new THREE.Object3D()
  for (let i = 0; i < LIGHTS; i++) {
    const a = (i / LIGHTS) * Math.PI * 2
    o.position.set(0.575 * Math.cos(a), 0, -0.575 * Math.sin(a))
    o.rotation.set(0, a, 0)
    o.scale.set(0.05, 0.13, 0.17) // thin radially, 0.17 along the ring
    o.updateMatrix()
    ;(i % 2 ? lightsB : lightsA).setMatrixAt(i >> 1, o.matrix)
  }
  for (const im of [lightsA, lightsB]) {
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    ring.add(im)
  }

  // ---- antenna: neck, SkyPod, mast, aviation light ----
  const antenna = new THREE.Group()
  antenna.name = 'antenna'
  antenna.position.y = ROOF_Y
  root.add(antenna)
  add(antenna, neckGeo, dusk, 0.375)
  add(antenna, skyPodGeo, haze, 0.82)
  add(antenna, skyStripeGeo, cyan, 0.84)
  add(antenna, mastGeo, haze, 1.415)
  add(antenna, mastBandGeo, pink, 1.2)
  add(antenna, box, red, 1.98, 'aviationLight').scale.setScalar(0.16)

  return root
}

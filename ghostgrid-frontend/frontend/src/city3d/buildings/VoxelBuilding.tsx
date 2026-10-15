// Solid, stepped architecture. Body, facade recesses, and lit windows each use one draw call.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { UNIT_BOX } from '../materials'
import { makeIndustrialTexture } from '../industrialTexture'
import type { BuildingType } from '@/types'

type Part = { p: [number, number, number]; s: [number, number, number]; color: string }
type Tier = { x: number; z: number; y: number; w: number; d: number; h: number }
const BODY = new THREE.MeshLambertMaterial({ color: '#ffffff', map: makeIndustrialTexture(), flatShading: true })
const RECESS = new THREE.MeshLambertMaterial({ color: '#080f1d' })
const ACCENTS: Record<BuildingType, string> = { codex: '#b6f36b', claude: '#ff995a', cursor: '#42e8ed', deepseek: '#688dff', groq: '#ffcd70', security: '#42e8ed', router: '#42e8ed', bot: '#ff4da6', library: '#ffcd70' }
const WALLS: Record<BuildingType, string> = { codex: '#416079', claude: '#73505d', cursor: '#385b73', deepseek: '#3c496d', groq: '#6d5b49', security: '#375767', router: '#48778a', bot: '#655070', library: '#536175' }
const noRaycast = () => null
const matrix = new THREE.Matrix4()
const color = new THREE.Color()

function install(mesh: THREE.InstancedMesh, parts: Part[]) {
  parts.forEach((part, i) => {
    mesh.setMatrixAt(i, matrix.makeScale(...part.s).setPosition(...part.p))
    mesh.setColorAt(i, color.set(part.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
}

function architecture(type: BuildingType, w: number, d: number, h: number, seed: number) {
  const body: Part[] = [], recess: Part[] = [], lights: Part[] = []
  const accent = ACCENTS[type], wall = WALLS[type]
  const box = (parts: Part[], p: Part['p'], s: Part['s'], color: string) => parts.push({ p, s, color })
  const tiers: Tier[] = []
  const tier = (y: number, height: number, width: number, depth: number, x = 0, z = 0) => tiers.push({ x, z, y, h: height, w: width, d: depth })
  const podium = 0.7
  // Wide foundations, readable shoulders, and a recognisable silhouette for each agent.
  box(body, [0, 0.16, 0], [w * 1.03, 0.32, d * 1.03], '#53677c')
  box(body, [0, 0.49, 0], [w, 0.34, d], '#24394d')
  switch (type) {
    case 'codex':
      tier(podium, h * .40, w * .98, d * .98)
      tier(podium + h * .40, h * .33, w * .82, d * .82)
      tier(podium + h * .73, h * .20 - podium, w * .62, d * .66)
      break
    case 'claude':
      tier(podium, h * .38, w, d)
      tier(podium + h * .38, h * .28, w * .88, d * .82, -w * .05)
      tier(podium + h * .66, h * .27 - podium, w * .68, d * .66, -w * .14, -d * .06)
      break
    case 'cursor':
      tier(podium, h * .38, w * .94, d)
      tier(podium + h * .38, h * .27, w, d * .78, w * .06)
      tier(podium + h * .65, h * .28 - podium, w * .65, d * .65, w * .18)
      break
    case 'security':
      tier(podium, h * .68, w, d)
      tier(podium + h * .68, h * .25 - podium, w * .64, d * .70)
      break
    case 'groq':
      tier(podium, h * .33, w, d)
      tier(podium + h * .33, h * .60 - podium, w * .74, d * .88)
      break
    case 'router':
      tier(podium, h * .22, w, d)
      tier(podium + h * .22, h * .45, w * .68, d * .68)
      tier(podium + h * .67, h * .26 - podium, w * .42, d * .42)
      break
    default:
      tier(podium, h * .35, w, d)
      tier(podium + h * .35, h * .36, w * .84, d * .86)
      tier(podium + h * .71, h * .22 - podium, w * .62, d * .68)
  }
  tiers.forEach((t, index) => {
    box(body, [t.x, t.y + t.h / 2, t.z], [t.w, t.h, t.d], wall)
    box(lights, [t.x, t.y + t.h - .02, t.z + t.d / 2 + .025], [t.w * .72, .035, .035], accent)
    // Heavy cornices and concrete ribs create real depth, not glowing outlines.
    box(body, [t.x, t.y + t.h - .06, t.z], [t.w + .16, .24, t.d + .16], '#53677c')
    box(body, [t.x, t.y + .12, t.z], [t.w + .12, .24, t.d + .12], '#2e475c')
    const rows = Math.max(1, Math.floor((t.h - .45) / .47))
    const colsX = Math.max(2, Math.floor(t.w / .36)), colsZ = Math.max(2, Math.floor(t.d / .36))
    for (let row = 0; row < rows; row++) {
      const y = t.y + .42 + row * .47
      // Recessed horizontal facade bands with chunky mullions.
      box(recess, [t.x, y, t.z + t.d / 2 + .014], [t.w - .24, .27, .03], '#080f1d')
      box(recess, [t.x + t.w / 2 + .014, y, t.z], [.03, .27, t.d - .24], '#080f1d')
      box(recess, [t.x, y, t.z - t.d / 2 - .014], [t.w - .24, .27, .03], '#080f1d')
      box(recess, [t.x - t.w / 2 - .014, y, t.z], [.03, .27, t.d - .24], '#080f1d')
      for (let col = 0; col < Math.max(colsX, colsZ); col++) {
        const lit = (row * 13 + col * 7 + seed * 3 + index) % 7 < 4
        const tint = lit ? ((col + row + seed) % 5 === 0 ? accent : '#95dce9') : '#172b42'
        if (col < colsX) {
          const x = t.x - t.w / 2 + .20 + col * (t.w - .4) / Math.max(1, colsX - 1)
          box(lights, [x, y, t.z + t.d / 2 + .036], [.13, .19, .026], tint)
          box(lights, [x, y, t.z - t.d / 2 - .036], [.13, .19, .026], tint)
        }
        if (col < colsZ) {
          const z = t.z - t.d / 2 + .20 + col * (t.d - .4) / Math.max(1, colsZ - 1)
          box(lights, [t.x + t.w / 2 + .036, y, z], [.026, .19, .13], tint)
          box(lights, [t.x - t.w / 2 - .036, y, z], [.026, .19, .13], tint)
        }
      }
    }
    // Vertical pilasters are discrete structural blocks, with light and dark faces.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(body, [t.x + sx * (t.w / 2 - .08), t.y + t.h / 2, t.z + sz * (t.d / 2 - .08)], [.18, t.h + .08, .18], '#637c91')
    }
    if (index < tiers.length - 1) {
      box(body, [t.x + t.w / 2 - .18, t.y + t.h + .16, t.z + t.d / 2 - .35], [.22, .32, .48], '#314d62')
    }
  })
  const top = tiers[tiers.length - 1], roof = top.y + top.h
  // Mechanical penthouse, stepped roof slabs, vents, and a compact signal mast.
  box(body, [top.x, roof + .20, top.z], [top.w * .72, .40, top.d * .72], '#2c4057')
  box(body, [top.x, roof + .44, top.z], [top.w * .82, .12, top.d * .82], '#65788e')
  box(body, [top.x - top.w * .20, roof + .66, top.z - top.d * .16], [.34, .34, .40], '#40576a')
  box(body, [top.x + top.w * .21, roof + .59, top.z + top.d * .14], [.38, .20, .36], '#31475d')
  box(body, [top.x, roof + .97, top.z], [.10, .9, .10], '#638da3')
  box(lights, [top.x, roof + 1.45, top.z], [.14, .14, .14], accent)
  // Street-level doors and canopies help a tower read as inhabitable architecture.
  box(recess, [0, .65, d / 2 + .025], [w * .42, .7, .035], '#080f1d')
  box(body, [0, 1.04, d / 2 + .18], [w * .68, .16, .44], '#486278')
  box(lights, [0, 1.02, d / 2 + .41], [w * .55, .055, .045], accent)
  if (type === 'groq') for (let i = 0; i < 3; i++) box(body, [-w * .36 + i * w * .36, h * .48, d * .48], [.15, h * .65, .22], '#486278')
  if (type === 'deepseek') for (let i = 0; i < 2; i++) box(body, [-w * .35, h * .55 + i * .6, -d * .32], [.3, h * .48, .3], '#31495f')
  return { body, recess, lights }
}

export function VoxelBuilding() {
  const { building, footprint, height, statusRef, offlineRef } = useContext(BuildingCtx)
  const parts = useMemo(() => architecture(building.type, footprint.w, footprint.d, height, building.lot), [building.type, building.lot, footprint.w, footprint.d, height])
  const body = useRef<THREE.InstancedMesh>(null), recess = useRef<THREE.InstancedMesh>(null), windows = useRef<THREE.InstancedMesh>(null)
  const windowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), [])
  useEffect(() => () => windowMaterial.dispose(), [windowMaterial])
  useLayoutEffect(() => {
    if (body.current) install(body.current, parts.body)
    if (recess.current) install(recess.current, parts.recess)
    if (windows.current) install(windows.current, parts.lights)
  }, [parts])
  useFrame(() => {
    const status = statusRef.current
    windowMaterial.color.set(status === 'error' ? '#ff627b' : status === 'needs_approval' ? '#ffcd70' : status === 'working' ? '#b6f36b' : '#ffffff')
    windowMaterial.color.multiplyScalar(offlineRef.current && status === 'idle' ? .65 : 1.15)
  })
  return <group>
    <instancedMesh ref={body} args={[UNIT_BOX, BODY, parts.body.length]} />
    <instancedMesh ref={recess} raycast={noRaycast} args={[UNIT_BOX, RECESS, parts.recess.length]} />
    <instancedMesh ref={windows} raycast={noRaycast} args={[UNIT_BOX, windowMaterial, parts.lights.length]} />
  </group>
}

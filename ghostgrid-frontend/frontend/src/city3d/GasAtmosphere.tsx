// Local vent vapor: one GPU-animated draw call, separate from distance fog.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE, UNIT_BOX } from './materials'
import { MAP, ROAD_INDEXES } from './world'

const VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aTint;
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
varying float vLife;
void main() {
  float life = fract(aPhase + uTime * 0.035);
  vec3 center = aCenter + vec3(life * 2.8, life * 3.0, sin(life * 5.0 + aPhase * 15.0) * 0.6);
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  view.xy += position.xy * vec2(3.0 + life * 4.0, 1.8 + life * 2.8);
  gl_Position = projectionMatrix * view;
  vUv = uv;
  vTint = aTint;
  vLife = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.6, 1.0, life));
}`
const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
varying float vLife;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.55 + noise(p * 2.03 + 7.0) * 0.28 + noise(p * 4.01 + 13.0) * 0.17;
}
void main() {
  vec2 drift = vec2(uTime * 0.035, -uTime * 0.025);
  float grain = fbm(vUv * 6.0 + drift);
  vec2 p = (vUv - 0.5) * 2.0;
  p += (vec2(grain, fbm(vUv * 5.0 - drift)) - 0.5) * 0.55;
  float edge = 1.0 - smoothstep(0.1, 0.92, dot(p, p));
  float alpha = edge * smoothstep(0.22, 0.8, grain) * vLife * 0.32;
  gl_FragColor = vec4(vTint, alpha);
  #include <colorspace_fragment>
}`

export function GasAtmosphere() {
  const resources = useMemo(() => {
    const half = MAP.size / 2
    // Two edges of each road; always clear of interactive building footprints.
    const vents = ROAD_INDEXES.flatMap((road, i) => [
      { x: road + 0.5 - half, z: half - 2.4 - (i % 3) * 4.7, tint: i % 2 ? PALETTE.pink : PALETTE.cyan },
      { x: -half + 2.4 + (i % 3) * 4.7, z: road + 0.5 - half, tint: i % 2 ? PALETTE.cyan : PALETTE.yellow },
    ])
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index?.clone() ?? null
    geometry.setAttribute('position', plane.attributes.position.clone())
    geometry.setAttribute('uv', plane.attributes.uv.clone())
    plane.dispose()
    const centers: number[] = [], tints: number[] = [], phases: number[] = []
    for (const [index, vent] of vents.entries()) {
      const tint = new THREE.Color(vent.tint)
      for (let puff = 0; puff < 3; puff++) {
        centers.push(vent.x, 0.55, vent.z)
        tints.push(tint.r, tint.g, tint.b)
        phases.push((puff / 3 + index * 0.137) % 1)
      }
    }
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3))
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 3))
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases), 1))
    geometry.instanceCount = phases.length
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, toneMapped: false,
    })
    const ventMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' })
    const stripMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
    const hardware = new THREE.InstancedMesh(UNIT_BOX, ventMaterial, vents.length * 4)
    const strips = new THREE.InstancedMesh(UNIT_BOX, stripMaterial, vents.length)
    const matrix = new THREE.Matrix4(), color = new THREE.Color()
    vents.forEach((vent, i) => {
      hardware.setMatrixAt(i * 4, matrix.makeScale(0.55, 0.16, 0.8).setPosition(vent.x, 0.16, vent.z))
      hardware.setColorAt(i * 4, color.set(PALETTE.steel))
      for (let slot = 0; slot < 3; slot++) {
        hardware.setMatrixAt(i * 4 + slot + 1, matrix.makeScale(0.4, 0.015, 0.09).setPosition(vent.x, 0.245, vent.z - 0.24 + slot * 0.24))
        hardware.setColorAt(i * 4 + slot + 1, color.set(PALETTE.void))
      }
      strips.setMatrixAt(i, matrix.makeScale(0.025, 0.025, 0.7).setPosition(vent.x + 0.26, 0.25, vent.z))
      strips.setColorAt(i, color.set(vent.tint).multiplyScalar(1.5))
    })
    for (const mesh of [hardware, strips]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.raycast = () => null
    }
    return { geometry, material, hardware, strips, ventMaterial, stripMaterial, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { resources.reduced = media.matches }
    media.addEventListener('change', update)
    return () => {
      media.removeEventListener('change', update)
      resources.geometry.dispose()
      resources.material.dispose()
      resources.hardware.dispose()
      resources.strips.dispose()
      resources.ventMaterial.dispose()
      resources.stripMaterial.dispose()
    }
  }, [resources])
  useFrame(({ clock }) => { resources.material.uniforms.uTime.value = resources.reduced ? 8 : clock.elapsedTime % 10000 })
  return <group>
    <primitive object={resources.hardware} />
    <primitive object={resources.strips} />
    <mesh geometry={resources.geometry} material={resources.material} frustumCulled={false} raycast={() => null} />
  </group>
}

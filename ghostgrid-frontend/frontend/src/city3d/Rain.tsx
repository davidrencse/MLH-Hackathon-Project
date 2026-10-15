// Rain over the city, driven by the real weather in New York (see weather/nyc.ts).
// Dry in NYC → nothing renders at all. Raining → the harder it rains there, the
// harder it rains here: more drops, longer and faster streaks, more lean, and at
// storm severity the sky flashes.
//
// EFFICIENCY: one instanced draw call, allocated once at the storm count. Severity
// changes only move uniforms and `instanceCount` — no buffers are rebuilt, and
// nothing per-drop runs on the CPU. The curtain tracks the live camera each frame,
// so it stays square to the screen while the player orbits or zooms.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useRainSeverity, useWeatherStore } from '../store/weather'
import type { RainSeverity } from '../weather/nyc'

const REDUCED =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Per-severity look. Index 0 is unused: at severity 0 the component renders nothing.
interface RainLook {
  count: number
  /** Screen heights per second. */
  speed: number
  /** Streak length and width, world units. */
  len: number
  width: number
  alpha: number
  /** Horizontal lean, before wind is added. */
  slant: number
  /** Mean seconds between lightning flashes; 0 = never. */
  lightning: number
}
const LOOKS: Record<Exclude<RainSeverity, 0>, RainLook> = {
  1: { count: 320, speed: 0.42, len: 0.6, width: 0.12, alpha: 0.3, slant: 0.1, lightning: 0 },
  2: { count: 760, speed: 0.62, len: 0.9, width: 0.14, alpha: 0.42, slant: 0.17, lightning: 0 },
  3: { count: 1400, speed: 0.92, len: 1.25, width: 0.16, alpha: 0.55, slant: 0.26, lightning: 0 },
  4: { count: 2100, speed: 1.2, len: 1.7, width: 0.19, alpha: 0.7, slant: 0.42, lightning: 7 },
}
const MAX_COUNT = LOOKS[4].count

// How far toward the camera the curtain sits from the middle of the view, and how
// much bigger than the viewport it is drawn (streaks lean, so the sides need slack).
const CURTAIN_Z = 50
const MARGIN = 1.3

const VERT = /* glsl */ `
attribute vec4 aDrop;    // x: column across the screen (-0.5..0.5), y: phase, z: speed, w: length
attribute float aLayer;  // 0 = far and dim, 1 = near and bright
uniform vec2 uSpan;      // visible world size at the curtain
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
uniform float uWidth;
uniform float uSlant;
varying vec2 vUv;
varying float vFade;
void main() {
  float layer = mix(0.72, 1.3, aLayer);
  float t = fract(aDrop.y + uTime * uSpeed * aDrop.z * layer);

  // The streak lies along its own fall direction, so lean never shears it sideways.
  vec2 fall = normalize(vec2(uSlant, -1.0));
  vec2 along = -fall;
  vec2 perp = vec2(along.y, -along.x);

  vec2 head = vec2(aDrop.x * uSpan.x, uSpan.y * 0.5) + fall * (uSpan.y * (1.0 + abs(uSlant)) * t);
  vec2 quad = vec2(position.x * uWidth * mix(0.75, 1.25, aLayer), position.y * uLen * aDrop.w * layer);
  vec2 screen = head + perp * quad.x + along * (quad.y + uLen * 0.5);

  vUv = uv;
  vFade = mix(0.5, 1.0, aLayer) * aDrop.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(screen, mix(2.0, 18.0, aLayer), 1.0);
}`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
varying float vFade;
void main() {
  float head = smoothstep(0.0, 0.9, 1.0 - vUv.y);          // brightest at the leading end
  float across = smoothstep(0.0, 0.4, 1.0 - abs(vUv.x - 0.5) * 2.0);
  float a = uAlpha * vFade * head * across;
  if (a < 0.012) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`

const FLASH_VERT = /* glsl */ `
uniform vec2 uSpan;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uSpan * 1.2, 1.0, 1.0);
}`
const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  if (uAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor, uAlpha);
  #include <colorspace_fragment>
}`

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Where the flash is in its 0..1 life: two quick strikes, then dark. */
function flashEnvelope(phase: number): number {
  if (phase > 0.22) return 0
  const strike = phase < 0.08 ? phase / 0.08 : phase < 0.14 ? 0 : (0.22 - phase) / 0.08
  return Math.max(0, Math.min(1, strike)) ** 1.6
}

export function Rain() {
  const severity = useRainSeverity()
  const wind = useWeatherStore((s) => s.weather?.wind ?? 0)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const group = useRef<THREE.Group>(null)
  const nextFlash = useRef(0)
  const flashStart = useRef(-1)

  // Allocated once at the storm count; lighter rain draws a prefix of it.
  const { geometry, material, flashGeometry, flashMaterial } = useMemo(() => {
    // One unit quad, written out rather than taken from a PlaneGeometry we would
    // then have to keep alive just to own these buffers.
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    )
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])

    const r = rng(4091)
    const drops = new Float32Array(MAX_COUNT * 4)
    const layers = new Float32Array(MAX_COUNT)
    for (let i = 0; i < MAX_COUNT; i++) {
      drops.set([r() - 0.5, r(), 0.8 + r() * 0.45, 0.7 + r() * 0.6], i * 4)
      layers[i] = r() < 0.45 ? r() * 0.45 : 0.6 + r() * 0.4
    }
    geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4))
    geometry.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1))
    geometry.instanceCount = 0
    // The curtain is camera-aligned and drawn last, so it needs no bounds check.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpan: { value: new THREE.Vector2(40, 30) },
        uSpeed: { value: LOOKS[1].speed },
        uLen: { value: LOOKS[1].len },
        uWidth: { value: LOOKS[1].width },
        uAlpha: { value: 0 },
        uSlant: { value: LOOKS[1].slant },
        uColor: { value: new THREE.Color('#bfe9ff') },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    const flashGeometry = new THREE.PlaneGeometry(1, 1)
    const flashMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSpan: { value: material.uniforms.uSpan.value },
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color('#dff3ff') },
      },
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    return { geometry, material, flashGeometry, flashMaterial }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      flashGeometry.dispose()
      flashMaterial.dispose()
    },
    [geometry, material, flashGeometry, flashMaterial],
  )

  // Severity and wind are the only things that change the look, and they change
  // every ten minutes at most — so they move uniforms, not buffers.
  useEffect(() => {
    if (severity === 0) {
      geometry.instanceCount = 0
      material.uniforms.uAlpha.value = 0
      flashMaterial.uniforms.uAlpha.value = 0
      return
    }
    const look = LOOKS[severity]
    geometry.instanceCount = look.count
    material.uniforms.uSpeed.value = look.speed
    material.uniforms.uLen.value = look.len
    material.uniforms.uWidth.value = look.width
    material.uniforms.uAlpha.value = look.alpha * (REDUCED ? 0.7 : 1)
    // Real wind leans the rain further, up to about a 30° tilt.
    material.uniforms.uSlant.value = look.slant + Math.min(wind / 70, 0.25)
    nextFlash.current = 0
    flashStart.current = -1
  }, [severity, wind, geometry, material, flashMaterial])

  useFrame(({ clock }) => {
    const node = group.current
    if (!node || severity === 0) return

    // Square to the screen and centred on what the viewport actually shows, whatever
    // the player has done with the orbit controls. Unprojecting the middle of the
    // frame rather than using the camera position is what keeps the curtain centred:
    // CameraRig gives the camera a view offset, so the two are not the same point.
    node.quaternion.copy(camera.quaternion)
    node.position.set(0, 0, 0).unproject(camera)
    node.translateZ(CURTAIN_Z)

    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const span = material.uniforms.uSpan.value as THREE.Vector2
    span.set(((size.width || 1) / zoom) * MARGIN, ((size.height || 1) / zoom) * MARGIN)

    const t = clock.elapsedTime
    if (!REDUCED) material.uniforms.uTime.value = t % 1000

    const lightning = LOOKS[severity].lightning
    if (!lightning || REDUCED) {
      flashMaterial.uniforms.uAlpha.value = 0
      return
    }
    if (nextFlash.current === 0) nextFlash.current = t + lightning * (0.4 + Math.random())
    if (flashStart.current < 0 && t >= nextFlash.current) flashStart.current = t
    if (flashStart.current >= 0) {
      const phase = (t - flashStart.current) / 0.55
      flashMaterial.uniforms.uAlpha.value = flashEnvelope(phase) * 0.1
      if (phase >= 1) {
        flashStart.current = -1
        nextFlash.current = t + lightning * (0.4 + Math.random())
      }
    }
  })

  if (severity === 0) return null
  return (
    <group ref={group}>
      <mesh geometry={flashGeometry} material={flashMaterial} renderOrder={19} frustumCulled={false} />
      <mesh geometry={geometry} material={material} renderOrder={20} frustumCulled={false} />
    </group>
  )
}

import type { Camera, Vector3 } from 'three'

// OrbitControls moves its target when panning or zooming to the cursor. Use that
// same target for animations so the two camera updates never fight each other.
export function placeCamera(camera: Camera, target: Vector3, azimuth: number, polar: number) {
  const radius = camera.position.distanceTo(target)
  camera.position.setFromSphericalCoords(radius, polar, azimuth).add(target)
  camera.lookAt(target)
}

// Recover the home orbit even if the user has panned far from the city.
export function resetCameraOrbit(camera: Camera, target: Vector3, radius: number) {
  camera.position.sub(target).setLength(radius)
  target.set(0, 0, 0)
  camera.lookAt(target)
}

// The HUD's one way to move the camera (city/BuildMenu.tsx "VIEW ALL"): pull back to the full
// 3x3 grid so the locked outer plates and their OPEN PLOT buttons come on screen. It lives here,
// in a module with no three.js runtime imports, so the DOM build menu can call it without
// pulling the WebGL city into its bundle. CameraRig registers the implementation; the 2D
// fallback city has no rig, where a no-op is the right answer.
let wideView: (() => void) | null = null

export function registerWideView(fn: () => void) {
  wideView = fn
  return () => {
    if (wideView === fn) wideView = null
  }
}

export const requestWideView = () => wideView?.()

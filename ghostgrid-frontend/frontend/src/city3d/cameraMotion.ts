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

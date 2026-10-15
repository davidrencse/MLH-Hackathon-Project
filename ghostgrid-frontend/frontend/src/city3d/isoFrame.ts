// The default iso view as a quaternion, kept out of world.ts on purpose.
//
// world.ts is plain layout arithmetic and is imported by the store, the build menu and the types
// — all of which land in the entry chunk. Importing three for this one value dragged the whole
// 3D engine in behind it, so every page paid for three.js including the ones with no canvas.
// Anything that needs the iso frame is already inside the lazily-loaded city, so it lives here.
import * as THREE from 'three'
import { CAMERA } from './world'

// A group carrying ISO_Q has local +x = screen right, +y = screen up, +z = toward the camera —
// the frame screen-space effects (stars, rain) are laid out in. It is the *default* view:
// anything that must stay aligned while the player orbits copies the live camera quaternion.
export const ISO_Q = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().lookAt(new THREE.Vector3(...CAMERA.position), new THREE.Vector3(), new THREE.Vector3(0, 1, 0)),
)

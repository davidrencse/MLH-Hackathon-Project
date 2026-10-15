import assert from 'node:assert/strict'
import test from 'node:test'
import { OrthographicCamera, Vector3 } from 'three'
import { OrbitControls } from 'three-stdlib'
import { placeCamera, resetCameraOrbit } from '../src/city3d/cameraMotion.ts'

const home = new Vector3(20, 16.33, 20)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

for (const pan of [[0, 0, 0], [-10, 0, 10], [0, 10, 0], [20, 0, 20]]) {
  test(`idle sway and quarter turns preserve orbit distance after pan/zoom target ${pan}`, () => {
    const camera = new OrthographicCamera(-30, 30, 30, -30, -300, 400)
    const controls = new OrbitControls(camera)
    controls.minPolarAngle = Math.PI / 4
    controls.maxPolarAngle = 70 * Math.PI / 180
    controls.target.set(...pan)
    camera.position.copy(home).add(controls.target)
    controls.update()
    const initialTarget = controls.target.clone()
    const radius = camera.position.distanceTo(controls.target)
    // Same ordering as the render loop: controls update, then the animation.
    for (let frame = 0; frame < 3600; frame++) {
      controls.update()
      const turn = Math.floor(frame / 900) * Math.PI / 2
      placeCamera(camera, controls.target, Math.PI / 4 + turn + 0.1 * Math.sin(frame / 150), Math.PI / 3)
      close(camera.position.distanceTo(controls.target), radius)
      close(controls.target.distanceTo(initialTarget), 0)
      const direction = camera.getWorldDirection(new Vector3())
      const towardTarget = controls.target.clone().sub(camera.position).normalize()
      close(direction.distanceTo(towardTarget), 0)
    }
    controls.dispose()
  })
}

test('reset recenters a panned camera and recovers its home distance', () => {
  const camera = new OrthographicCamera()
  const controls = new OrbitControls(camera)
  controls.target.set(20, 10, -30)
  camera.position.copy(home).multiplyScalar(5).add(controls.target)
  resetCameraOrbit(camera, controls.target, home.length())
  controls.update()
  placeCamera(camera, controls.target, Math.PI / 4, Math.PI / 3)
  close(controls.target.length(), 0)
  close(camera.position.distanceTo(controls.target), home.length())
  close(camera.getWorldDirection(new Vector3()).distanceTo(camera.position.clone().negate().normalize()), 0)
  controls.dispose()
})

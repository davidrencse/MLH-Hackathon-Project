// WebGL check that picks the 3D city (CityCanvas) or the 2D DOM fallback (City2D).
// Runs the check once per page load and caches the result.
let cached: boolean | null = null

export function hasWebGL(): boolean {
  if (cached !== null) return cached
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    // Release the test context now: browsers allow only a few live WebGL contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    cached = gl !== null
  } catch {
    cached = false
  }
  return cached
}

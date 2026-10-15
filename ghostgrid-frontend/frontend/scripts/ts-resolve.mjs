// Resolve hook for `node --test`: the app's imports are extensionless because Vite resolves
// them, and Node's ESM resolver requires the extension. Tests that pull real modules out of
// src/ would otherwise stop at the first `import { x } from '../city3d/world'`.
// Only extensionless relative specifiers are touched, and only when a TS file actually exists.
//
// `@/x` is resolved the same way, to `src/x`, because that alias is the app's own convention
// (vite.config.ts `resolve.alias`, tsconfig.app.json `paths`): without it a test can only reach
// modules whose whole import graph happens to avoid it.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HAS_EXT = /\.(?:[cm]?[jt]sx?|json|css|svg|png)$/
const SRC = pathToFileURL(fileURLToPath(new URL('../src/', import.meta.url))).href

/** The first of `base`, `base.ts`, `base.tsx`, `base/index.ts` that exists on disk. */
function withExtension(base) {
  if (HAS_EXT.test(base)) return existsSync(fileURLToPath(base)) ? base : null
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    const candidate = base + ext
    if (existsSync(fileURLToPath(candidate))) return candidate
  }
  return existsSync(fileURLToPath(base)) ? base : null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const resolved = withExtension(new URL(specifier.slice(2), SRC).href)
      if (resolved) return nextResolve(resolved, context)
    }
    if (specifier.startsWith('.') && !HAS_EXT.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        if (existsSync(fileURLToPath(new URL(base + ext)))) return nextResolve(specifier + ext, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

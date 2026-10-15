// Every import in src/ points at a file that exists.
//
// `tsc` already checks the ones it can type, but it does not check the paths of side-effect
// imports: a stale `import './Thing.css'` or a missing image survives a clean typecheck and only
// fails the production build. Deleting a component is exactly when that happens.
//
//   node --test scripts/frontend-imports.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const CODE = /\.(?:[cm]?[jt]sx?)$/
// What Vite will try when a specifier has no extension of its own.
const CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.json', '/index.ts', '/index.tsx']

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : walk(path)
    return [path]
  })
}

/** Relative and `@/`-aliased specifiers, which are the ones that can point at a deleted file. */
function localImports(source) {
  const found = []
  // `from '…'`, a bare side-effect `import '…'`, and `import('…')`.
  for (const pattern of [/\bfrom\s*'([^']+)'/g, /\bimport\s*'([^']+)'/g, /\bimport\(\s*'([^']+)'\s*\)/g]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('@/')) found.push(specifier)
    }
  }
  return found
}

const files = walk(SRC).filter((path) => CODE.test(path) || path.endsWith('.css'))

test('src/ is not empty, so a silent miss cannot pass this file', () => {
  assert.ok(files.length > 50, `only found ${files.length} files under src/`)
})

test('every relative and aliased import in src/ resolves to a file on disk', () => {
  const broken = []
  for (const file of files) {
    for (const specifier of localImports(readFileSync(file, 'utf8'))) {
      const base = specifier.startsWith('@/')
        ? resolve(SRC, specifier.slice(2))
        : resolve(dirname(file), specifier)
      if (!CANDIDATES.some((ext) => existsSync(base + ext) && statSync(base + ext).isFile())) {
        broken.push(`${file.slice(SRC.length + 1)} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(broken, [], `imports pointing at nothing:\n  ${broken.join('\n  ')}`)
})

test('stylesheets only @import files that are there', () => {
  const broken = []
  for (const file of files.filter((path) => path.endsWith('.css'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue // a package or a URL, not ours to resolve
      const path = resolve(dirname(file), specifier)
      if (!existsSync(path)) broken.push(`${file.slice(SRC.length + 1)} -> ${specifier}`)
    }
  }
  assert.deepEqual(broken, [], `stylesheets importing nothing:\n  ${broken.join('\n  ')}`)
})

test('the weather reading still reaches the city as rain', () => {
  // Whether or not a readout is on screen, the rain is what the reading is for: both scenes pull
  // severity from the shared store, and the store is what polls. Removing the last consumer would
  // leave a dry city under a real downpour.
  const store = readFileSync(join(SRC, 'store/weather.ts'), 'utf8')
  assert.ok(store.includes('export function useRainSeverity'), 'the rain lost its source of truth')
  assert.ok(/useVisibleInterval\(load/.test(store), 'nothing refreshes the reading any more')
  for (const consumer of ['city3d/Rain.tsx', 'city2d/Rain2D.tsx']) {
    assert.ok(readFileSync(join(SRC, consumer), 'utf8').includes('useRainSeverity'), `${consumer} stopped reading the weather`)
  }
})

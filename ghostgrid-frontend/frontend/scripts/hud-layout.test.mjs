// The city HUD is four floating panels over one canvas, and their geometry lives in Tailwind class
// strings rather than in any shared constant. So the numbers have to agree across files by hand:
// widen the side panel and the buildings rail ends up underneath it, with nothing to catch it.
// These checks read the numbers back out of the source and assert the relationships.
//
//   node --test scripts/hud-layout.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const read = (path) => readFileSync(join(SRC, path), 'utf8')
/** Tailwind's spacing scale: `right-4` is 4 × 0.25rem. */
const SPACING_PX = 4
const GUTTER = 4 * SPACING_PX // 16px, the margin every HUD panel keeps from the viewport edge

const sidePanel = read('city/SidePanel.tsx')
const buildingNav = read('city/BuildingNav.tsx')
const buildMenu = read('city/BuildMenu.tsx')

/** The first `name-[123px]` in a source, as a number. */
const arbitrary = (source, name) => {
  const match = new RegExp(`${name}-\\[(\\d+)px\\]`).exec(source)
  assert.ok(match, `could not find a ${name}-[…px] class`)
  return Number(match[1])
}
const breakpoint = (source, kind) => {
  const match = new RegExp(`${kind}-\\[(\\d+)px\\]:`).exec(source)
  assert.ok(match, `could not find a ${kind}-[…px]: variant`)
  return Number(match[1])
}

test('the side panel is the panel the other HUD pieces have to clear', () => {
  assert.match(sidePanel, /className="gg-sp-shell absolute top-20 right-4 bottom-4 z-50/)
  assert.equal(arbitrary(sidePanel, 'w'), 380)
  // Below the breakpoint it grows to nearly the full width, which is why neighbours hide instead
  // of shuffling sideways down there.
  assert.match(sidePanel, /max-w-\[calc\(100%-2rem\)\]/)
})

test('everything that shares the right edge clears the open side panel', () => {
  const panelWidth = arbitrary(sidePanel, 'w')
  const panelEdge = panelWidth + GUTTER // how far in from the right the panel reaches

  // The build menu's banner is centred in what is left, so it may sit right up against the panel.
  const bannerInset = arbitrary(buildMenu, 'min-\\[900px\\]:right')
  assert.equal(bannerInset, panelEdge, 'the banner should stop exactly where the panel starts')

  // The buildings rail is an opaque panel of its own, so it needs a gutter in between.
  const railInset = arbitrary(buildingNav, 'min-\\[900px\\]:right')
  assert.ok(railInset >= panelEdge + GUTTER,
    `the rail sits ${railInset}px in but the panel reaches ${panelEdge}px; it needs ${panelEdge + GUTTER}px`)
})

test('the rail hides at exactly the width it stops stepping aside', () => {
  // `max-[Npx]` compiles to `width < N` and `min-[Mpx]` to `width >= M`, so the two numbers have to
  // be equal to cover the axis. `max-[899px]` with `min-[900px]` left 899px itself overlapping.
  const hidesBelow = breakpoint(buildingNav, 'max')
  const shiftsAbove = breakpoint(buildingNav, 'min')
  assert.equal(hidesBelow, shiftsAbove,
    `width < ${hidesBelow} hides the rail and width >= ${shiftsAbove} shifts it: ${Math.min(hidesBelow, shiftsAbove)}px is covered twice or not at all`)
  // Both side rails change width at the same place, so they stay the same shape as each other.
  assert.ok(buildMenu.includes(`min-[${shiftsAbove}px]:w-48`), 'the build menu changes width at a different breakpoint')
  assert.ok(buildingNav.includes(`min-[${shiftsAbove}px]:w-48`), 'the rail changes width at a different breakpoint')
})

test('the buildings rail is on the right, and opens its tooltips inward', () => {
  assert.match(buildingNav, /className=\{`absolute right-4 bottom-4 z-40/)
  // A right-edge rail with `side="right"` tooltips opens them off the edge of the screen.
  assert.match(buildingNav, /<TooltipContent side="left"/)
  assert.ok(!/<TooltipContent side="right"/.test(buildingNav))
})

// ---- label occlusion ----
// City labels are projected DOM, and one that lands under an opaque panel is hidden rather than
// drawn half-covered. The projector finds those panels by attribute; a panel that forgets the
// attribute gets labels drawn underneath it.

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const tsx = walk(SRC).filter((path) => path.endsWith('.tsx'))
const MARKER = 'data-hud-panel'

test('the projector looks panels up by attribute, not by a list of class names', () => {
  const labels = read('city3d/Labels.tsx')
  const match = /const KEEP_OUT = '([^']+)'/.exec(labels)
  assert.ok(match, 'Labels.tsx no longer declares KEEP_OUT')
  assert.equal(match[1], `[${MARKER}]`)
  // The list used to name eight classes, six of which were applied nowhere in this tree and so
  // silently matched nothing. An attribute cannot go stale the same way.
  assert.ok(!match[1].includes('.'), 'a class in KEEP_OUT can stop matching without anything failing')
})

test('every opaque HUD panel over the city is registered as one', () => {
  const registered = tsx.filter((path) => readFileSync(path, 'utf8').includes(MARKER))
    .map((path) => path.slice(SRC.length + 1))
  for (const panel of [
    'components/TopNav.tsx', // fixed across the top
    'city/BuildMenu.tsx', // the build rail, and its banner
    'city/BuildingNav.tsx', // the buildings rail
    'city/SidePanel.tsx', // the building/result panel
    'components/WeatherWidget.tsx', // the weather readout, bottom left
  ]) {
    assert.ok(registered.includes(panel), `${panel} is an opaque panel over the city but is not marked ${MARKER}`)
  }
})

test('only panels that actually cover something are registered', () => {
  // A transparent full-width wrapper carrying the marker would hide every label across its band.
  // Each marked element must declare a background of its own.
  for (const path of tsx) {
    const source = readFileSync(path, 'utf8')
    // The JSX attribute, not the `[data-hud-panel]` selector the projector looks it up with.
    for (const match of source.matchAll(/(?<!\[)data-hud-panel(?!\])/g)) {
      const element = source.slice(match.index, match.index + 700)
      // A panel states its background in Tailwind, inline, or through a `gg-` class in a
      // stylesheet. A pass-through wrapper has none of the three.
      const opaque = /bg-gg-|background:|\bgg-[a-z-]+\b/.test(element)
      assert.ok(opaque, `${path.slice(SRC.length + 1)} marks an element with no background of its own`)
      assert.ok(!/pointer-events-none/.test(element.split('>')[0]),
        `${path.slice(SRC.length + 1)} marks a pass-through wrapper rather than the panel itself`)
    }
  }
})

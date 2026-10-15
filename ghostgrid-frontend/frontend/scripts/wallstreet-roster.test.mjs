// The vendored Wall Street roster must still match the backend's, which owns it.
//
// src/wallstreet/roster.ts is a hand-kept copy of WALL_STREET_ROSTER in
// ghostgrid-backend/src/wallstreet/service.ts, and the two drift the moment a tower is added to
// one of them. Both failure modes are quiet:
//
//   - A slug only the backend knows arrives through GET /api/v1/wallstreet, and
//     loadWallStreet builds it with makeBuilding(bid, 'quant', repo.lot). If that lot is not in
//     the frontend's LOTS table, the first thing to call lotCenter on it throws "unknown lot N"
//     — in the 3D render, at runtime, where no typecheck or existing test can see it.
//   - A slug only the frontend knows renders fine and simply never gets GitHub stats, so the
//     tower sits there looking live while its star count is permanently static.
//
// This reads the backend file as text rather than importing it, so the frontend suite stays
// runnable with no backend dependency, and skips when the backend tree is not checked out.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { WALL_STREET_SEEDS } from '../src/wallstreet/roster.ts'
import { lotById, WALL_STREET_LOTS } from '../src/city3d/world.ts'

const BACKEND = new URL('../../../ghostgrid-backend/src/wallstreet/service.ts', import.meta.url)

/** Fields worth comparing character for character: everything the city positions or links by. */
const EXACT = ['name', 'short', 'ticker', 'accent', 'lot', 'repo']
/** Prose is compared loosely: a dash or a line break moved is not a drift worth failing over. */
const loose = (s) => String(s).replace(/[—–-]/g, '-').replace(/\s+/g, ' ').trim()

function backendRoster() {
  const text = readFileSync(BACKEND, 'utf8')
  const start = text.indexOf('WALL_STREET_ROSTER')
  assert.ok(start > 0, 'WALL_STREET_ROSTER is not in the backend service any more')
  const body = text.slice(start, text.indexOf('\n]', start))
  const out = []
  for (const m of body.matchAll(/\{\s*slug:\s*"([^"]+)"([\s\S]*?)\n {2}\},/g)) {
    const [, slug, rest] = m
    const str = (key) => rest.match(new RegExp(`${key}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1]
    const repo = rest.match(/repo:\s*\{\s*owner:\s*"([^"]+)",\s*name:\s*"([^"]+)"/)
    out.push({
      slug,
      name: str('name'),
      short: str('short'),
      ticker: str('ticker'),
      accent: str('accent'),
      asset: str('asset'),
      strategy: str('strategy'),
      lot: Number(rest.match(/lot:\s*(\d+)/)?.[1]),
      repo: repo && `${repo[1]}/${repo[2]}`,
    })
  }
  assert.ok(out.length > 0, 'could not parse a single entry out of the backend roster')
  return out
}

test('the vendored roster carries the same towers as the backend, in the same order', (t) => {
  if (!existsSync(BACKEND)) return t.skip('backend tree not checked out')
  const backend = backendRoster()
  const front = WALL_STREET_SEEDS.map((seed) => ({
    ...seed,
    repo: `${seed.repo.owner}/${seed.repo.name}`,
  }))
  assert.deepEqual(
    front.map((s) => s.slug),
    backend.map((s) => s.slug),
    'the two rosters list different towers, or list them in a different order',
  )
  for (const [i, seed] of front.entries()) {
    for (const key of EXACT) {
      assert.equal(seed[key], backend[i][key], `${seed.slug}.${key} differs between the two rosters`)
    }
    for (const key of ['asset', 'strategy']) {
      assert.equal(loose(seed[key]), loose(backend[i][key]), `${seed.slug}.${key} differs between the two rosters`)
    }
  }
})

test('every tower the backend can send has a lot the city knows', (t) => {
  if (!existsSync(BACKEND)) return t.skip('backend tree not checked out')
  for (const seed of backendRoster()) {
    // Throws "unknown lot N" rather than returning undefined, which is the crash this guards.
    const lot = lotById(seed.lot)
    assert.ok(lot, `${seed.slug} has no lot ${seed.lot} in the city`)
    assert.ok(WALL_STREET_LOTS.includes(seed.lot), `${seed.slug} sits on lot ${seed.lot}, which is not zoned to Wall Street`)
  }
})

test('every lot zoned to Wall Street carries a tower', () => {
  // The district is built out: a zoned lot with nothing on it is an invisible hole in the
  // skyline, and unlike a leasable plot it has no pad to show the player it exists.
  const taken = new Set(WALL_STREET_SEEDS.map((seed) => seed.lot))
  for (const id of WALL_STREET_LOTS) assert.ok(taken.has(id), `Wall Street lot ${id} has no tower on it`)
})

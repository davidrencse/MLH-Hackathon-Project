// Zoning tests for the city map (src/city3d/world.ts).
//
// The city cannot be checked in a browser from this workspace, so the geometry is checked here
// instead: lots must not overlap each other or the roads, the two zoned quarters must contain
// exactly the buildings that belong to them and nothing else, and the district furniture must
// stand on the boundary-avenue median rather than inside the towers on the lots.
//
//   node --test scripts/city-zoning.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_PLOT,
  AGENT_LOTS,
  ATTENTION_LOTS,
  BUILDABLE_LOTS,
  CORE_BUILDABLE_LOTS,
  DISTRICTS,
  LOTS,
  MAP,
  OUTER_LOTS,
  OUTER_LOT_RECTS,
  PLOT_OFFSETS,
  ROAD_INDEXES,
  CORE_NAME,
  PLOT_NAMES,
  TRADING_LOTS,
  WALL_STREET_LOTS,
  WALL_STREET_RIM_LOTS,
  WALL_STREET_DOWNTOWN_LOTS,
  WALL_ST_PLOT,
  WORLD_HALF,
  districtEdges,
  districtMedian,
  districtReserved,
  isLotLeasable,
  leasableLots,
  lotById,
  lotCenter,
  plateOffset,
  platformCorners,
} from '../src/city3d/world.ts'
import { usePlots } from '../src/store/plots.ts'
import { DEFAULT_BUILDINGS } from '../src/constants.ts'
import { WALL_STREET_SEEDS } from '../src/wallstreet/roster.ts'

const HALF = MAP.size / 2
const rect = (l) => ({ x0: l.tx, x1: l.tx + l.w, z0: l.tz, z1: l.tz + l.d })
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1
const district = (id) => DISTRICTS.find((d) => d.id === id)

test('lot ids are unique, so lotById can stand in for indexing LOTS', () => {
  const ids = LOTS.map((l) => l.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const l of LOTS) assert.equal(lotById(l.id), l)
})

test('no two lots on the same plate overlap', () => {
  // Tile coordinates repeat on every plate — Wall Street's downtown sits on the same tiles as
  // the core's landmark blocks — so tile rects only compare within one plate. The world-space
  // test further down is what rules out two plates colliding.
  for (let i = 0; i < LOTS.length; i++)
    for (let j = i + 1; j < LOTS.length; j++)
      if (LOTS[i].plot === LOTS[j].plot)
        assert.ok(
          !overlaps(rect(LOTS[i]), rect(LOTS[j])),
          `lot ${LOTS[i].id} overlaps lot ${LOTS[j].id}`,
        )
})

test('every lot sits inside the map and clear of the road rows', () => {
  for (const l of LOTS) {
    assert.ok(l.tx >= 0 && l.tx + l.w <= MAP.size, `lot ${l.id} off the map in x`)
    assert.ok(l.tz >= 0 && l.tz + l.d <= MAP.size, `lot ${l.id} off the map in z`)
    for (let t = l.tx; t < l.tx + l.w; t++) assert.ok(!ROAD_INDEXES.includes(t), `lot ${l.id} covers road column ${t}`)
    for (let t = l.tz; t < l.tz + l.d; t++) assert.ok(!ROAD_INDEXES.includes(t), `lot ${l.id} covers road row ${t}`)
  }
})

test('the districts are disjoint; Wall Street is the east plate, Agent Row the north-west one', () => {
  const [a, b] = DISTRICTS.map(districtEdges)
  assert.ok(!overlaps({ x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1 }, { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }))
  // Wall Street is a plate of its own now, and that plate is named after it.
  const ws = district('wallstreet')
  assert.equal(ws.plot, WALL_ST_PLOT, 'Wall Street should stand on the plate the city names for it')
  assert.equal(PLOT_NAMES[WALL_ST_PLOT], 'Wall St')
  const [ox, oz] = plateOffset(WALL_ST_PLOT)
  assert.ok(ox > 0 && oz === 0, 'WALL_ST_PLOT should be the plate due east of the core')

  // Screen compass used throughout the city: -x is west (back left), +x/-z is NE (upper right).
  const e = districtEdges(ws)
  assert.ok(e.x0 > 0, 'Wall Street should sit east of the centre city, on its own plate')
  // It runs down that plate's west flank, so the towers face the core across the rim. That rim
  // has no avenue outside it, so the furniture edge is the inner one — the avenue between the
  // strip and the rest of its plate — which the district has to name for itself.
  assert.equal(ws.face, 'x1', 'a strip flush with a plate rim must name its own furniture edge')
  assert.equal(e.ix, e.x1, 'Wall Street should put its avenue on its inner edge')
  assert.ok(e.ix - e.x0 > 0, 'the avenue should be on the far side from the plate rim')
  // It still spans the core in z, so neither z end is a boundary with the city — districtEdges
  // has to say so or the furniture lands on a cap.
  assert.ok(e.z0 < 0 && e.z1 > 0, 'Wall Street does not span the core in z')
  assert.equal(e.iz, null, 'a flank strip must report no core-facing edge on the axis it straddles')
  // Agent Row moved off the core island onto Stochastic Park: houses and a garden belong in a
  // park, not on the downtown island.
  const agents = district('agentrow')
  assert.equal(agents.plot, AGENT_PLOT, 'Agent Row should stand on the plate that holds its park')
  assert.equal(PLOT_NAMES[AGENT_PLOT], 'Stochastic Park')
  const [ax, az] = plateOffset(AGENT_PLOT)
  assert.ok(ax < 0 && az < 0, 'AGENT_PLOT should be the plate north-west of the core')

  // Still the far side of the city from the trading floor, which was the point of the original
  // placement: the player's own agents are not part of Wall Street.
  assert.ok(ax < plateOffset(WALL_ST_PLOT)[0], 'Agent Row should sit away from Wall Street')

  // A quarter inside its plate, not flush with a rim, so it faces the core on both axes and
  // needs no `face` of its own — there is an avenue on every side to stand furniture on.
  const row = districtEdges(agents)
  assert.equal(agents.face, undefined, 'a quarter with avenues all round should not name an edge')
  assert.ok(row.ix !== null && row.iz !== null, 'a corner quarter faces the core on both axes')
})

test('each zoned quarter contains exactly its own lots', () => {
  // Tile bounds repeat on every plate, so a lot one cell over would look "inside" on tiles alone.
  const inside = (d, l) => {
    const e = rect(l)
    return l.plot === d.plot && e.x0 >= d.tx0 && e.x1 <= d.tx1 && e.z0 >= d.tz0 && e.z1 <= d.tz1
  }
  const ws = district('wallstreet')
  const row = district('agentrow')
  for (const id of [...WALL_STREET_LOTS, ...TRADING_LOTS]) assert.ok(inside(ws, lotById(id)), `lot ${id} is not in Wall Street`)
  for (const id of AGENT_LOTS) assert.ok(inside(row, lotById(id)), `lot ${id} is not on Agent Row`)
  // Nothing unzoned may sit inside a zoned quarter, or the district would contain a plot the
  // build menu can lease and the segregation would be cosmetic.
  for (const l of LOTS) {
    if (![...WALL_STREET_LOTS, ...TRADING_LOTS].includes(l.id)) assert.ok(!inside(ws, l), `lot ${l.id} squats in Wall Street`)
    if (!AGENT_LOTS.includes(l.id)) assert.ok(!inside(row, l), `lot ${l.id} squats on Agent Row`)
  }
})

test('zoned lots are not leasable and every other lot above 4 is', () => {
  const zoned = [...WALL_STREET_LOTS, ...TRADING_LOTS, ...AGENT_LOTS]
  for (const id of zoned) assert.ok(!BUILDABLE_LOTS.includes(id), `lot ${id} is zoned but leasable`)
  for (const l of LOTS) {
    if (l.id >= 5 && !zoned.includes(l.id)) assert.ok(BUILDABLE_LOTS.includes(l.id), `lot ${l.id} is leasable to nobody`)
  }
})

// The demo bot catalog that used to fill these zones is gone (nothing ran it), so what is left
// to guard is the zones themselves: a bot you place yourself still needs somewhere to stand,
// and an edit to the lot tables can empty a zone with no error anywhere.
test('the bot zones still offer lots to build on', () => {
  assert.ok(TRADING_LOTS.length >= 2, `Wall Street offers ${TRADING_LOTS.length} bot lots, needs 2+`)
  assert.ok(ATTENTION_LOTS.length >= 4, `Attention Span offers ${ATTENTION_LOTS.length} lots, needs 4+`)
  for (const id of [...TRADING_LOTS, ...ATTENTION_LOTS])
    assert.doesNotThrow(() => lotById(id), `bot zone lot ${id} is not a lot`)
})

test('every seeded building has a lot of its own', () => {
  const seeded = [
    ...DEFAULT_BUILDINGS.map((b) => [b.id, b.lot]),
    ...WALL_STREET_SEEDS.map((s) => [s.slug, s.lot]),
  ]
  const byLot = new Map()
  for (const [id, lot] of seeded) {
    assert.doesNotThrow(() => lotById(lot), `${id} is seeded on unknown lot ${lot}`)
    assert.ok(!byLot.has(lot), `${id} and ${byLot.get(lot)} both sit on lot ${lot}`)
    byLot.set(lot, id)
  }
})

test('district furniture stands on a road median, never on a lot', () => {
  for (const d of DISTRICTS) {
    const { mx, mz } = districtMedian(d)
    // One median per core-facing edge, and every quarter has at least one or its furniture
    // would have nowhere to stand.
    const present = [['x', mx], ['z', mz]].filter(([, m]) => m !== null)
    assert.ok(present.length > 0, `${d.id} has no median to put its furniture on`)
    // A median is the centre line of a road tile: cars run at centre +/- 0.22, the mast between.
    // Roads repeat at the same indexes on every plate, so the median has to be read back in its
    // own plate's tile space: the plates are PLOT_GAP apart, which is not a whole tile.
    const [ox, oz] = plateOffset(d.plot)
    for (const [axis, m] of present) {
      const local = m - (axis === 'x' ? ox : oz) + HALF
      const tile = Math.floor(local)
      assert.ok(ROAD_INDEXES.includes(tile), `${d.id} ${axis} median at tile ${tile} is not a road`)
      assert.ok(Math.abs(local - (tile + 0.5)) < 1e-9, `${d.id} ${axis} median is off the road centre`)
    }
  }
})

test('each gateway plaza is a block with no lot on it, so the arch has room', () => {
  for (const d of DISTRICTS) {
    const [gx, gz] = d.gate
    const plaza = { x0: gx, x1: gx + 4, z0: gz, z1: gz + 4 }
    assert.ok(gx >= d.tx0 && gx + 4 <= d.tx1 && gz >= d.tz0 && gz + 4 <= d.tz1, `${d.id} gate is outside its district`)
    for (const l of LOTS.filter((l) => l.plot === d.plot)) {
      assert.ok(!overlaps(plaza, rect(l)), `${d.id} gate plaza is taken by lot ${l.id}`)
    }
  }
})

test('the quant towers keep their rostered lots, and Agent Row stays buildable', () => {
  for (const seed of WALL_STREET_SEEDS) assert.ok(WALL_STREET_LOTS.includes(seed.lot), `${seed.slug} is off Wall Street`)
  // Agent Row no longer opens with seeded houses, so what matters is that its lots exist for
  // the houses a player places.
  assert.ok(AGENT_LOTS.length >= 3, `Agent Row offers ${AGENT_LOTS.length} lots, needs 3+`)
  for (const id of AGENT_LOTS) assert.doesNotThrow(() => lotById(id), `Agent Row lot ${id} is not a lot`)
  // The rim towers share one column, so they read as a wall of skyscrapers rather than a
  // scatter. Break the column and the district stops looking like a skyline from the core.
  const columns = new Set(WALL_STREET_RIM_LOTS.map((id) => lotCenter(id)[0]))
  assert.equal(columns.size, 1, 'the rim towers are not in one column')
  const rows = WALL_STREET_RIM_LOTS.map((id) => lotCenter(id)[2])
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'the rim towers are not in roster order along the column')
  // Downtown is the opposite: a grid behind the rim, one tower per inner block, never in the
  // rim's column (that column is the skyline and has its own five).
  const rimColumn = [...columns][0]
  const blocks = new Set()
  for (const id of WALL_STREET_DOWNTOWN_LOTS) {
    const l = lotById(id)
    assert.equal(l.plot, WALL_ST_PLOT, `downtown lot ${id} is off the Wall Street plate`)
    assert.ok(lotCenter(id)[0] !== rimColumn, `downtown lot ${id} stands in the rim column`)
    assert.ok([10, 15, 20].includes(l.tx) && [10, 15, 20].includes(l.tz), `downtown lot ${id} is not on an inner block`)
    blocks.add(`${l.tx},${l.tz}`)
  }
  assert.equal(blocks.size, WALL_STREET_DOWNTOWN_LOTS.length, 'two downtown towers share a block')
  // Every tower, rim or downtown, is a lot the build menu cannot lease.
  assert.deepEqual(WALL_STREET_LOTS, [...WALL_STREET_RIM_LOTS, ...WALL_STREET_DOWNTOWN_LOTS])
})

// ---- The outer plates (OUTER_LOTS / PLOT_OFFSETS in world.ts) ----
// Nine leasable super-blocks per plate, on ground the filler-city packer has to keep clear, and
// only once the player has opened that plate. Same no-overlap rules as the core, now in world
// space, because two plates are only 1.2 units apart.

const ALL_PLOTS = PLOT_OFFSETS.map((_, k) => k)
const worldRect = (l) => {
  const [ox, oz] = l.plot === undefined ? [0, 0] : PLOT_OFFSETS[l.plot]
  return { x0: l.tx - HALF + ox, x1: l.tx + l.w - HALF + ox, z0: l.tz - HALF + oz, z1: l.tz + l.d - HALF + oz }
}

test('outer lot ids are unique, distinct from the core, and resolve through lotById', () => {
  const core = new Set(LOTS.map((l) => l.id))
  const ids = OUTER_LOTS.map((l) => l.id)
  assert.equal(new Set(ids).size, ids.length)
  // Nine per plate, less what a district already owns: Wall Street's inner blocks are its own
  // downtown towers, so that plate leases nothing, and Agent Row holds four of Stochastic
  // Park's — three houses and the garden plaza — so that plate leases five.
  assert.equal(OUTER_LOTS.filter((l) => l.plot === WALL_ST_PLOT).length, 0)
  assert.equal(OUTER_LOTS.filter((l) => l.plot === AGENT_PLOT).length, 5)
  assert.equal(OUTER_LOTS.length, (PLOT_OFFSETS.length - 2) * 9 + 5)
  for (const l of OUTER_LOTS) {
    assert.ok(!core.has(l.id), `outer lot ${l.id} collides with a core lot id`)
    assert.equal(lotById(l.id), l)
    assert.ok(ALL_PLOTS.includes(l.plot), `outer lot ${l.id} is on no plate`)
  }
})

test('every outer lot sits inside its own plate, clear of that plate roads', () => {
  for (const l of OUTER_LOTS) {
    assert.ok(l.tx >= 0 && l.tx + l.w <= MAP.size, `lot ${l.id} off its plate in x`)
    assert.ok(l.tz >= 0 && l.tz + l.d <= MAP.size, `lot ${l.id} off its plate in z`)
    for (let t = l.tx; t < l.tx + l.w; t++) assert.ok(!ROAD_INDEXES.includes(t), `lot ${l.id} covers road column ${t}`)
    for (let t = l.tz; t < l.tz + l.d; t++) assert.ok(!ROAD_INDEXES.includes(t), `lot ${l.id} covers road row ${t}`)
    // lotCenter must carry the plate offset, or the whole plate would build on the core island.
    const [x, , z] = lotCenter(l.id)
    const [ox, oz] = PLOT_OFFSETS[l.plot]
    assert.ok(Math.abs(x - ox) <= HALF && Math.abs(z - oz) <= HALF, `lot ${l.id} centre is off its plate`)
  }
})

test('no two lots in the whole 3x3 grid overlap in world space', () => {
  const all = [...LOTS, ...OUTER_LOTS]
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      assert.ok(!overlaps(worldRect(all[i]), worldRect(all[j])), `lot ${all[i].id} overlaps lot ${all[j].id}`)
})

test('the filler-city packer reserves exactly the outer lots it has to', () => {
  const key = (r) => `${r.x0},${r.z0},${r.x1},${r.z1}`
  const reserved = new Set(OUTER_LOT_RECTS.map(key))
  assert.equal(reserved.size, OUTER_LOT_RECTS.length)
  // Plate-local footprints are identical on every plate, which is why one layout serves all 8.
  for (const l of OUTER_LOTS) {
    const local = { x0: l.tx - HALF, z0: l.tz - HALF, x1: l.tx + l.w - HALF, z1: l.tz + l.d - HALF }
    assert.ok(reserved.has(key(local)), `lot ${l.id} would be built over by the filler city`)
  }
})

test('outer lots are leasable only while their plate is open', () => {
  assert.deepEqual(leasableLots([]), CORE_BUILDABLE_LOTS)
  assert.deepEqual([...leasableLots(ALL_PLOTS)].sort((a, b) => a - b), [...BUILDABLE_LOTS].sort((a, b) => a - b))
  for (const l of OUTER_LOTS) {
    assert.ok(!isLotLeasable(l.id, []), `lot ${l.id} is leasable with every plate locked`)
    assert.ok(isLotLeasable(l.id, [l.plot]), `lot ${l.id} stays locked with its own plate open`)
    assert.ok(!isLotLeasable(l.id, ALL_PLOTS.filter((k) => k !== l.plot)), `lot ${l.id} opened with the wrong plate`)
  }
  for (const id of CORE_BUILDABLE_LOTS) assert.ok(isLotLeasable(id, []), `core lot ${id} needs a plate open`)
})

test('a plate only advertises lease pads where it has a lot to lease', () => {
  // The pads were drawn from the shared block grid, so the Wall St plate put nine of them over a
  // district that leases nothing: seven under its own downtown towers and two on bare ground,
  // offering a lease the build menu then refuses.
  for (const k of ALL_PLOTS) {
    const pads = OUTER_LOTS.filter((l) => l.plot === k)
    for (const pad of pads) {
      assert.ok(isLotLeasable(pad.id, [k]), `plate ${k} shows a pad on lot ${pad.id}, which is not leasable`)
      for (const zoned of LOTS.filter((l) => l.plot === k)) {
        assert.ok(!overlaps(rect(pad), rect(zoned)), `plate ${k}: pad ${pad.id} sits on zoned lot ${zoned.id}`)
      }
    }
  }
  assert.equal(OUTER_LOTS.filter((l) => l.plot === WALL_ST_PLOT).length, 0, 'the Wall St plate should lease nothing')
  assert.equal(leasableLots(ALL_PLOTS).filter((id) => lotById(id).plot === WALL_ST_PLOT).length, 0,
    'a Wall St lot came up for lease')
})

test('the camera frames the core plus exactly the open plates', () => {
  assert.equal(platformCorners([]).length, 4)
  assert.equal(platformCorners(ALL_PLOTS).length, 4 * (1 + PLOT_OFFSETS.length))
  // Out-of-range indexes from a stale localStorage entry must not widen the frame.
  assert.equal(platformCorners([99, -1]).length, 4)
  // The pan bound is on the orbit target, so it has to reach every plate's centre (or a corner
  // plate could never be brought into view) without letting the camera wander off the grid.
  for (const [ox, oz] of PLOT_OFFSETS)
    assert.ok(Math.abs(ox) <= WORLD_HALF && Math.abs(oz) <= WORLD_HALF, `plate at ${ox},${oz} is outside the pan bounds`)
  assert.ok(WORLD_HALF <= 2 * (MAP.size + 1.2), 'pan bounds reach past the grid into empty space')
})

test('the core island mid blocks stay spread and leasable', () => {
  // The mid blocks are the four 4x4 blocks N / S / E / W of the centre plaza; each holds two
  // small lots. Crowding buildings into one block is what this guards against.
  const mids = { N: [5, 13, 6, 14], S: [7, 8], E: [11, 12], W: [9, 10] }

  const seeded = new Set(DEFAULT_BUILDINGS.map((b) => b.lot))
  const occupied = []
  for (const [name, lots] of Object.entries(mids)) {
    const taken = lots.filter((id) => seeded.has(id))
    assert.ok(taken.length < lots.length, `the ${name} mid block is full: ${taken.length} of ${lots.length} lots seeded`)
    if (taken.length) occupied.push(name)
  }
  // The landmark towers that remain are spread around the spire, not stacked on one approach.
  assert.ok(occupied.length >= 3, `only ${occupied.length} mid blocks have a seeded tower: ${occupied}`)
  // And nothing was stranded by the rezoning: every mid lot is either built on or for lease.
  for (const id of Object.values(mids).flat()) {
    assert.ok(seeded.has(id) || isLotLeasable(id, []), `mid-block lot ${id} is neither seeded nor leasable`)
  }
})

test('the Wall St plate is open before the player opens anything', () => {
  // The district is seeded and backed by live GitHub data, so it cannot start behind a click.
  // Loading the store here takes the no-localStorage path, same as a private window.
  assert.ok(usePlots.getState().open.includes(WALL_ST_PLOT), 'the trading district starts hidden')
  usePlots.getState().reset()
  assert.ok(usePlots.getState().open.includes(WALL_ST_PLOT), 'reset shut the plate the district stands on')
})

test('a zoned lot is never real estate, whatever plate is open', () => {
  // Moving these onto a plate made them look like ordinary outer lots to isLotLeasable, which
  // would have put district layout up for lease the moment that plate opened.
  for (const id of [...WALL_STREET_LOTS, ...TRADING_LOTS, ...AGENT_LOTS]) {
    assert.ok(!isLotLeasable(id, []), `zoned lot ${id} is leasable with every plate shut`)
    assert.ok(!isLotLeasable(id, ALL_PLOTS), `zoned lot ${id} comes up for lease once its plate opens`)
    assert.ok(!BUILDABLE_LOTS.includes(id), `zoned lot ${id} is offered by the build menu`)
  }
})

test("the filler city leaves room for the district standing on the Wall St plate", () => {
  // The outer packer knows only a plate's nine super-blocks, so without these reservations it
  // would build procedural city straight through the towers and the arch.
  const reserved = districtReserved(WALL_ST_PLOT)
  assert.equal(reserved.length, WALL_STREET_LOTS.length + TRADING_LOTS.length + 1, 'seven lots and one plaza')
  for (const id of [...WALL_STREET_LOTS, ...TRADING_LOTS]) {
    const l = lotById(id)
    assert.ok(
      reserved.some((r) => r.x0 === l.tx - HALF && r.z0 === l.tz - HALF && r.x1 === l.tx + l.w - HALF && r.z1 === l.tz + l.d - HALF),
      `lot ${id} is not reserved on its own plate`,
    )
  }
  // Reservations are plate-local, like OUTER_LOT_RECTS, not world space.
  for (const r of reserved) assert.ok(Math.abs(r.x0) <= HALF && Math.abs(r.z0) <= HALF, 'a reservation is off its plate')
  // The island reserves only its own districts' plazas now, not the lots that left it.
  const core = districtReserved()
  assert.equal(core.length, DISTRICTS.filter((d) => d.plot === undefined).length)
})

test('the rim towers stand in one line on the flank facing the core, with downtown behind them', () => {
  const centres = WALL_STREET_RIM_LOTS.map((id) => lotCenter(id))
  const [ox, oz] = plateOffset(WALL_ST_PLOT)
  // One column: every rim tower on the same x, stepping along z, so they read as a single wall.
  assert.equal(new Set(centres.map(([x]) => x)).size, 1, 'the rim towers are not in one straight line')
  const zs = centres.map(([, , z]) => z).sort((a, b) => a - b)
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] > zs[i - 1], 'two rim towers share a row')
  // On that plate, and hugging the rim that faces the core rather than the far one.
  const ws = DISTRICTS.find((d) => d.plot === WALL_ST_PLOT)
  const { x0, x1 } = districtEdges(ws)
  for (const [x, , z] of centres) {
    assert.ok(Math.abs(x - ox) <= HALF && Math.abs(z - oz) <= HALF, `a tower at ${x},${z} is off its plate`)
    assert.ok(Math.abs(x - x0) < Math.abs(x - x1), 'the rim towers should hug the rim facing the core')
  }
  // Downtown stands behind the wall: same plate, inside the district, and further from the
  // core-facing rim than every rim tower, so the skyline keeps its front row.
  const rimX = centres[0][0]
  for (const id of WALL_STREET_DOWNTOWN_LOTS) {
    const [x, , z] = lotCenter(id)
    assert.ok(Math.abs(x - ox) <= HALF && Math.abs(z - oz) <= HALF, `downtown lot ${id} is off its plate`)
    assert.ok(Math.abs(x - x0) > Math.abs(rimX - x0), `downtown lot ${id} is not behind the rim`)
  }
})

test('every cell of the 3x3 grid has a name that fits the pixel nameplate', () => {
  assert.equal(PLOT_NAMES.length, PLOT_OFFSETS.length, 'one name per plate, in PLOT_OFFSETS order')
  const all = [CORE_NAME, ...PLOT_NAMES]
  assert.equal(new Set(all).size, all.length, 'two cells share a name')
  for (const name of all) {
    assert.match(name, /^[A-Za-z][A-Za-z -]*[A-Za-z]$/, `${name} is not plain label text`)
    // The nameplate is one nowrap line of Press Start 2P; past ~18 characters it runs off a
    // plate and over its neighbour.
    assert.ok(name.length <= 18, `"${name}" is ${name.length} chars, too long for the nameplate`)
  }
})

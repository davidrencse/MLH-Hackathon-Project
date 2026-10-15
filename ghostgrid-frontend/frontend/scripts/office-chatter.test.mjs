// Office chatter: one voice at a time. A bubble over every head at once reads as a glitch, so
// the turn must belong to exactly one rendered person, whatever the data behind them looks like.
//
// The bug this guards against: the turn used to be keyed on a number derived from the person —
// a seat's `index * 97 + i`, or the sum of a worker id's character codes — and a bubble showed
// whenever the stored speaker equalled its key. Those numbers collided, so colliding people
// spoke in unison.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-chatter.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  endTurn, joinChatter, lineSeed, nextSpeaker, resetChatter, useChatter, voiceCount,
} from '../src/city/office/chatter.ts'
import { pickLine, SF_LINES } from '../src/city/office/slang.ts'

/** One voice per rendered person, as React's useId gives each mounted bubble its own. */
const room = (count) => Array.from({ length: count }, (_, i) => joinChatter(`:r${i}:`))
const speaker = () => useChatter.getState().speaker

test('only one person in the room holds the turn', () => {
  resetChatter()
  room(12)
  assert.equal(voiceCount(), 12)
  // Whatever the dice say, the turn is a single voice, and it is one that is in the room.
  for (const roll of [0, 0.0001, 0.42, 0.5, 0.999999]) {
    const chosen = nextSpeaker(() => roll)
    assert.equal(chosen, speaker())
    assert.match(speaker(), /^:r\d+:$/)
    const speaking = Array.from({ length: 12 }, (_, i) => `:r${i}:`).filter((voice) => voice === speaker())
    assert.equal(speaking.length, 1, 'exactly one voice may match the stored speaker')
  }
  resetChatter()
})

test('an empty room is silent, and the turn ends cleanly', () => {
  resetChatter()
  assert.equal(nextSpeaker(() => 0.5), null)
  assert.equal(speaker(), null)
  room(3)
  nextSpeaker(() => 0)
  assert.notEqual(speaker(), null)
  endTurn()
  assert.equal(speaker(), null, 'the bubble must disappear when its time is up')
  resetChatter()
})

test('someone who leaves mid-sentence takes their bubble with them', () => {
  resetChatter()
  const [first, ...rest] = room(3)
  nextSpeaker(() => 0)
  const held = speaker()
  assert.equal(held, ':r0:')
  // A desk removed, a floor changed, a terminal closed: the voice unmounts while speaking.
  first()
  assert.equal(voiceCount(), 2)
  assert.equal(speaker(), null, 'a departed speaker must not keep the turn')
  // The room keeps working for whoever is left.
  assert.notEqual(nextSpeaker(() => 0.9), null)
  for (const leave of rest) leave()
  assert.equal(nextSpeaker(() => 0), null)
  resetChatter()
})

test('the turn does not depend on identity, so the old collisions cannot speak together', () => {
  resetChatter()
  // The two shapes that actually collided. Character-code sums are equal for digit permutations,
  // and a seat at index 0 seat 3 produced the same 3 the greeter was hardcoded to.
  const sum = (id) => [...id].reduce((total, letter) => total + letter.charCodeAt(0), 0)
  assert.equal(sum('cli:715228'), sum('cli:718225'), 'the old desk seed collided')
  assert.equal(0 * 97 + 3, 3, 'the old seat seed collided with the greeter')
  // Identity now only picks the line, and reordering characters changes it.
  assert.notEqual(lineSeed('cli:715228'), lineSeed('cli:718225'))
  assert.notEqual(lineSeed('host'), lineSeed('hq-m'))
  // Two people are two voices even when they share an id, so one of them still waits its turn.
  const leaveA = joinChatter(':r0:')
  const leaveB = joinChatter(':r1:')
  nextSpeaker(() => 0)
  assert.equal([':r0:', ':r1:'].filter((voice) => voice === speaker()).length, 1)
  leaveA()
  leaveB()
  resetChatter()
})

test('a person keeps their own line, and every line is a real one', () => {
  resetChatter()
  // Stable for one person across calls, so their joke does not reshuffle on every render.
  assert.equal(lineSeed('hq-e1'), lineSeed('hq-e1'))
  // Distinct employees mostly get distinct lines rather than all telling the same joke.
  const ids = Array.from({ length: 40 }, (_, i) => `cli:${7000 + i * 13}`)
  const lines = new Set(ids.map((id) => pickLine(lineSeed(id), 0)))
  assert.ok(lines.size > 10, `expected varied chatter, got ${lines.size} distinct lines`)
  for (const id of ids) assert.ok(SF_LINES.includes(pickLine(lineSeed(id), 7)))
})

test('the room renders the bubble from the chatter module, not its own seeds', () => {
  const source = readFileSync(new URL('../src/city/office/OfficeRoom3D.tsx', import.meta.url), 'utf8')
  // A reintroduced arithmetic seed is exactly how this broke, so fail on one coming back.
  assert.ok(!/seed=\{/.test(source), 'Person must take a voice, not a numeric seed')
  assert.ok(!/SPEAKERS/.test(source), 'the voice registry belongs to chatter.ts')
  assert.ok(source.includes('useId()'), 'each rendered person needs its own voice key')
})

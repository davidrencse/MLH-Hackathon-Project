// Why: the room is funnier when one person speaks at a time. A bubble over every head at once
// reads as a glitch, not as banter.
//
// The rule is enforced by what the turn is keyed on. Each mounted person registers one **voice**
// key, unique to that rendered person, and the clock stores exactly one of those keys as the
// current speaker; a bubble shows only when its own voice holds the turn.
//
// This replaced keying the turn on a number derived from the person — a seat's `index * 97 + i`,
// or the sum of a worker id's character codes. Those numbers were not unique: a seat could land
// on the greeter's fixed seed, and two terminals whose pids are digit permutations summed to the
// same value. Since a bubble appeared whenever the stored speaker equalled its key, everyone
// sharing a key delivered the same line in unison.
//
// The line itself is still chosen from the person's identity, so each employee keeps their own
// joke across turns, but identity no longer decides whose turn it is.
import { create } from 'zustand'

/** Voices currently in the room. One entry per rendered person, added on mount. */
const VOICES = new Set<string>()

export const useChatter = create<{ speaker: string | null; tick: number }>(() => ({ speaker: null, tick: 0 }))

/** Registers a voice and returns the function that removes it again. */
export function joinChatter(voice: string): () => void {
  VOICES.add(voice)
  return () => {
    VOICES.delete(voice)
    // Whoever is leaving must not keep the turn, or the room falls silent until the next tick.
    useChatter.setState((state) => (state.speaker === voice ? { speaker: null } : state))
  }
}

export const voiceCount = () => VOICES.size

/** Hands the turn to one voice at random. No voices in the room means nobody speaks. */
export function nextSpeaker(random: () => number = Math.random): string | null {
  const voices = [...VOICES]
  if (!voices.length) return null
  const speaker = voices[Math.floor(random() * voices.length)] ?? null
  useChatter.setState((state) => ({ speaker, tick: state.tick + 1 }))
  return speaker
}

export function endTurn() {
  useChatter.setState({ speaker: null })
}

/** Test seam: forget every voice and the current turn. */
export function resetChatter() {
  VOICES.clear()
  useChatter.setState({ speaker: null, tick: 0 })
}

/**
 * A stable number per person, so one employee keeps their own line while the turn moves around.
 * FNV-1a over the id: unlike a sum of character codes, reordering the characters changes it.
 */
export function lineSeed(id: string): number {
  let hash = 2166136261
  for (const letter of id) hash = (hash ^ letter.charCodeAt(0)) * 16777619 >>> 0
  return hash % 100003
}

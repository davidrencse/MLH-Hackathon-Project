// Per-building flavor for the office interior. Only the look changes: every office runs the
// same desks (= sessions) and the same session menu.
import type { BuildingType } from '@/types'

export type RoomPropKind = 'whiteboard' | 'shelf' | 'rack' | 'rail' | 'switchboard'

export interface OfficeFlavor {
  floor: string // "FLOOR 24 · ENGINEERING"
  tagline: string // one line under the room name
  prop: RoomPropKind // the big wall fixture
  deskWord: string // what a desk is called here
  notes: string[] // pinned notes on the wall board
}

// Office types the player can walk into. Everything else has no interior.
export const OFFICE_TYPES: BuildingType[] = ['codex', 'cursor', 'claude', 'deepseek', 'groq', 'security']

export const OFFICE: Record<string, OfficeFlavor> = {
  security: {
    floor: 'CITY OPERATIONS',
    tagline: 'Every session, current activity and agent spending in one place.',
    prop: 'switchboard',
    deskWord: 'SESSION',
    notes: ['watch active work', 'track spending', 'check approvals'],
  },
  codex: {
    floor: 'FLOOR 24 · ENGINEERING',
    tagline: 'Parallel coding sessions. One worktree per desk.',
    prop: 'whiteboard',
    deskWord: 'WORKSTATION',
    notes: ['build green', 'rebase before merge', 'no force push'],
  },
  claude: {
    floor: 'FLOOR 18 · ARCHITECTURE',
    tagline: 'Long-context review and design. Quiet floor.',
    prop: 'shelf',
    deskWord: 'READING DESK',
    notes: ['read the whole file', 'write the why', 'small diffs'],
  },
  cursor: {
    floor: 'STUDIO 08 · EDITOR',
    tagline: 'Plan the edit, inspect the diff, iterate in the workspace.',
    prop: 'whiteboard',
    deskWord: 'EDITOR DESK',
    notes: ['scope the change', 'review every diff', 'keep context close'],
  },
  deepseek: {
    floor: 'HALL B · BATCH FLOOR',
    tagline: 'Cheap bulk work. Desks run queues, not conversations.',
    prop: 'rack',
    deskWord: 'BATCH BENCH',
    notes: ['watch the rate limit', 'retry with backoff', 'log every job'],
  },
  groq: {
    floor: 'PIT LANE · INFERENCE',
    tagline: 'Low latency only. If it waits, it loses.',
    prop: 'rail',
    deskWord: 'PIT STALL',
    notes: ['first token < 100ms', 'stream everything', 'keep prompts short'],
  },
}

export const flavorFor = (type: BuildingType): OfficeFlavor => OFFICE[type] ?? OFFICE.codex

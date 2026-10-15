// Office project assignments and the invented org-chart headcount (saved in this browser).
//
// PROJECTS ARE NOT INVENTED HERE. A project is a folder a coding CLI is actually open in, which
// the staffing board derives from the live crew's working directories — nine `claude` terminals
// in one repo are one project with nine people on it, with nothing to type. A fresh machine with
// no terminal running therefore has no projects, which is the honest answer. What this store
// holds is only what the browser cannot work out for itself: the lanes the player named by hand,
// and the assignments that override a person's real folder.
import { create } from 'zustand'

// A job title as the office's roles define it (the backend holds the definitions; see
// office/roles.ts there). The three below are only what a new office starts with — the operator
// can rename them and add their own — so this is a string and not a union.
export type Role = string
// Intern is last on purpose: it is not a rung below Engineer but a different relationship —
// one engineer hires an intern for one piece of their task and stays accountable for it — so
// nobody is promoted or demoted into it and the orchestrator never plans a node for one.
export const BUILTIN_ROLES = ['Manager', 'Team Lead', 'Engineer', 'Intern'] as const

// Short badge for the pixel UI. The built-ins keep the initials the city has always shown; a
// custom title is cut to four letters, which is what the badge has room for.
const SHORT_BUILTIN: Record<string, string> = { Manager: 'MGR', 'Team Lead': 'LEAD', Engineer: 'ENG' }
export function shortRole(role: string): string {
  const name = (role ?? '').trim()
  if (!name) return 'ENG'
  if (SHORT_BUILTIN[name]) return SHORT_BUILTIN[name]
  const words = name.split(/\s+/)
  // Two or more words give initials ("Staff Engineer" -> SE); one word gives its first four.
  return (words.length > 1 ? words.map((word) => word[0]).join('') : name.slice(0, 4)).toUpperCase()
}
export interface Employee { id: string; name: string; role: Role; reportsTo?: string; officeId?: string }

const KEY = 'gg-org'

// Projects this store used to seed itself with. Nobody chose them — they shipped as the default —
// so a browser still holding exactly that list is treated as never having named a project.
const LEGACY_SEED = ['GhostGrid Demo', 'MLH Pitch Deck', 'Car Listings Agent', 'Plaud Summaries']

interface Saved {
  projects: string[]
  assign: Record<string, string>
}

function load(): Saved {
  let saved: Saved | null = null
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null } catch { saved = null }
  const projects = Array.isArray(saved?.projects) ? saved.projects.filter((name) => typeof name === 'string') : []
  const legacy = projects.length === LEGACY_SEED.length && projects.every((name, i) => name === LEGACY_SEED[i])
  return {
    projects: legacy ? [] : projects,
    assign: saved?.assign && typeof saved.assign === 'object' ? saved.assign : {},
  }
}

export const useOrg = create<{
  /** Lanes the player named by hand. The folder lanes are derived, so they are not in here. */
  projects: string[]
  /** Person id -> lane id, only where it differs from the folder they really work in. */
  assign: Record<string, string>
  picked: Employee | null
  pick: (e: Employee | null) => void
  assignTo: (empId: string, project: string) => void
  addProject: (name: string) => void
  /** Forgets a hand-named lane and benches whoever was assigned to it. */
  removeProject: (name: string) => void
}>((set) => {
  const initial = load()
  const persist = (s: Saved) => {
    try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private window: assignments last for this visit only */ }
  }
  return {
    projects: initial.projects,
    assign: initial.assign,
    picked: null,
    pick: (picked) => set({ picked }),
    assignTo: (empId, project) => set((s) => {
      const assign = { ...s.assign, [empId]: project }
      persist({ projects: s.projects, assign })
      return { assign }
    }),
    addProject: (name) => set((s) => {
      const trimmed = name.trim()
      if (!trimmed || s.projects.includes(trimmed)) return s
      const projects = [...s.projects, trimmed]
      persist({ projects, assign: s.assign })
      return { projects }
    }),
    removeProject: (name) => set((s) => {
      const projects = s.projects.filter((project) => project !== name)
      // Closing a lane must not delete the people standing in it.
      const assign = Object.fromEntries(Object.entries(s.assign).filter(([, lane]) => lane !== name))
      persist({ projects, assign })
      return { projects, assign }
    }),
  }
})

const FIRST = ['Maya', 'Leo', 'Priya', 'Kai', 'Zoe', 'Arjun', 'Nova', 'Sam', 'Iris', 'Theo', 'Luna', 'Rex']
export const managerOf = (room: string): Employee => ({ id: `mgr:${room}`, name: 'Morgan (Manager)', role: 'Manager' })
export function employeeFor(room: string, worker: { id: string; name: string }, index: number, columns: number): Employee {
  const lead = index % columns === 0
  const leadIndex = index - (index % columns)
  return {
    id: worker.id,
    name: worker.name || FIRST[index % FIRST.length],
    role: lead ? 'Team Lead' : 'Engineer',
    reportsTo: lead ? `mgr:${room}` : `lead:${room}:${leadIndex}`,
  }
}

// Office org chart: Manager -> Team Leads -> Engineers, plus project assignments (saved in this browser).
import { create } from 'zustand'

export type Role = 'Manager' | 'Team Lead' | 'Engineer'
export interface Employee { id: string; name: string; role: Role; reportsTo?: string; officeId?: string }
const KEY = 'gg-org'
const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { projects: string[]; assign: Record<string, string> } | null

export const useOrg = create<{
  projects: string[]
  assign: Record<string, string>
  picked: Employee | null
  pick: (e: Employee | null) => void
  assignTo: (empId: string, project: string) => void
  addProject: (name: string) => void
}>((set) => {
  const persist = (s: { projects: string[]; assign: Record<string, string> }) => localStorage.setItem(KEY, JSON.stringify(s))
  return {
    projects: saved?.projects ?? ['GhostGrid Demo', 'MLH Pitch Deck', 'Car Listings Agent', 'Plaud Summaries'],
    assign: saved?.assign ?? {},
    picked: null,
    pick: (picked) => set({ picked }),
    assignTo: (empId, project) => set((s) => { const assign = { ...s.assign, [empId]: project }; persist({ projects: s.projects, assign }); return { assign } }),
    addProject: (name) => set((s) => { if (!name.trim() || s.projects.includes(name)) return s; const projects = [...s.projects, name.trim()]; persist({ projects, assign: s.assign }); return { projects } }),
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

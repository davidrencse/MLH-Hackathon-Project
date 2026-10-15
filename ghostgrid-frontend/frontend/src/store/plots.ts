// Which outer plates of the 3x3 city grid the player has opened, persisted so the city stays
// the size they grew it to. Opening a plate is permanent and free: the cost of expanding is
// that its nine super-blocks still have to be leased one building at a time.
//
// WALL_ST_PLOT is the exception: the trading district stands on it, seeded and backed by live
// GitHub data, so it is open from the first visit. Leaving it shut would have hidden the five
// quant towers behind a click nobody told the player to make.
//
// Lived in city3d/OuterDistricts.tsx before; it is a store, not a mesh, and both the renderer
// (city3d/VoxelDistricts.tsx) and the build rules (store/grid.ts) read it.
import { create } from 'zustand'
import { AGENT_PLOT, ATTENTION_PLOT, PLOT_OFFSETS, WALL_ST_PLOT } from '../city3d/world'

const KEY = 'gg-open-plots'

// Indexes outside the grid would silently widen the pan bounds, so a stale or hand-edited
// localStorage entry is filtered instead of trusted.
/** The plates that are open before the player opens anything. Wall St carries the quant towers,
 *  which are still seeded; Attention Span and Stochastic Park carry the bot zones and Agent Row,
 *  which opened with demo bots and seeded agent houses until those were removed. They stay open
 *  because a building placed there must be visible — a tower on ground nobody can see may as
 *  well not exist — and the build menu offers those lots. */
const ALWAYS_OPEN = [WALL_ST_PLOT, ATTENTION_PLOT, AGENT_PLOT]

const withAlwaysOpen = (open: number[]) => [...new Set([...ALWAYS_OPEN, ...open])].sort((a, b) => a - b)

function load(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return withAlwaysOpen([])
    return withAlwaysOpen(raw.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < PLOT_OFFSETS.length))
  } catch {
    return withAlwaysOpen([])
  }
}

function save(open: number[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(open))
  } catch {
    // private browsing / full quota: the city still works, it just will not remember its size
  }
}

interface PlotsState {
  open: number[]
  openPlot: (k: number) => void
  reset: () => void
}

export const usePlots = create<PlotsState>((set) => ({
  open: load(),
  openPlot: (k) =>
    set((s) => {
      if (s.open.includes(k) || k < 0 || k >= PLOT_OFFSETS.length) return s
      const open = withAlwaysOpen([...s.open, k])
      save(open)
      return { open }
    }),
  reset: () => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // see save()
    }
    set({ open: withAlwaysOpen([]) })
  },
}))

/** Read the open plates outside React (store/grid.ts validates placements with this). */
export const openPlots = () => usePlots.getState().open

import { create } from 'zustand'
export const useDozer = create<{ on: boolean; toggle: () => void; set: (on: boolean) => void }>((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
  set: (on) => set({ on }),
}))

// Shared NYC weather state: one reading, several consumers (the rain in the 3D
// scene, the rain in the 2D fallback).
//
// The fetch itself is cached in `weather/nyc.ts`, so the poll here is cheap and
// several mounted consumers cannot multiply requests.
//
// There is no weather readout in the HUD any more; the reading reaches the player
// only as rain. `useNycWeather` below still serves the whole reading, for whatever
// shows it next.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useVisibleInterval } from '../lib/useVisibleInterval'
import {
  cachedNycWeather,
  readNycWeather,
  type NycWeather,
  type RainSeverity,
} from '../weather/nyc'

const POLL_MS = 60_000

interface WeatherState {
  /** Null until a real reading arrives, and again if the sky cannot be read. */
  weather: NycWeather | null
  /** True until the first read resolves, for consumers that show a placeholder. */
  pending: boolean
  load: () => Promise<void>
}

export const useWeatherStore = create<WeatherState>()((set) => ({
  weather: cachedNycWeather(),
  pending: cachedNycWeather() === null,
  load: async () => {
    set({ weather: await readNycWeather(), pending: false })
  },
}))

/** The whole reading, kept fresh while the tab is visible. No consumer today. */
export function useNycWeather(): WeatherState {
  const state = useWeatherStore()
  const load = state.load
  useEffect(() => {
    void load()
  }, [load])
  useVisibleInterval(load, POLL_MS)
  return state
}

/** Just the rain intensity, for scene code that only cares about that. */
export function useRainSeverity(): RainSeverity {
  // No reading means no rain in the scene, which is the one safe reading of "unknown" here.
  const severity = useWeatherStore((s) => s.weather?.severity ?? 0)
  const load = useWeatherStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  useVisibleInterval(load, POLL_MS)
  return severity
}

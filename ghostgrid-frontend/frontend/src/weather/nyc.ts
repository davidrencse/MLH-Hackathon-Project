// Real New York City weather, and the one place that decides whether it is raining
// on the map.
//
// Open-Meteo needs no key and allows browser requests, so the city reads it
// directly. One cached read serves both the HUD widget and the rain in the scene
// (`city3d/Rain.tsx`, `city2d/Rain2D.tsx`): the sky over the city is the sky over
// New York, at the intensity New York is getting.
//
// When the request fails the city falls back to DEMO — partly cloudy, no rain —
// and says `live: false`, so a dry city is never mistaken for a reading.

/** 0 none · 1 light · 2 moderate · 3 heavy · 4 storm. Drives every rain parameter. */
export type RainSeverity = 0 | 1 | 2 | 3 | 4

export const SEVERITY_LABEL = ['none', 'light', 'moderate', 'heavy', 'storm'] as const

export type Precipitation = 'none' | 'rain' | 'snow'

export interface NycWeather {
  temperature: number
  feelsLike: number
  wind: number
  /** WMO weather code, as Open-Meteo reports it. */
  code: number
  /** Rain in the last hour, mm. `null` when the station reported none. */
  rainMm: number | null
  kind: Precipitation
  /** True only for liquid precipitation: snow leaves the city dry. */
  raining: boolean
  severity: RainSeverity
  label: string
  /** False when this is the offline stand-in rather than a reading. */
  live: boolean
  fetchedAt: number
}

// WMO code → how hard it is raining. Drizzle and slight showers are light; a
// violent shower or any thunderstorm is a storm.
const CODE_SEVERITY: Record<number, RainSeverity> = {
  51: 1, 53: 1, 55: 2, // drizzle
  56: 1, 57: 2, // freezing drizzle
  61: 1, 63: 2, 65: 3, // rain
  66: 2, 67: 3, // freezing rain
  80: 1, 81: 2, 82: 4, // showers
  95: 4, 96: 4, 99: 4, // thunderstorm, with or without hail
}
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])

/**
 * Measured rain → severity. Looser than the meteorological bands (light is
 * < 2.5 mm/h there) because the city has to *show* the difference: a drizzle and
 * a downpour should not look the same.
 */
export function severityFromMm(mm: number): RainSeverity {
  if (!(mm > 0)) return 0
  if (mm >= 7.6) return 4
  if (mm >= 2.5) return 3
  if (mm >= 0.5) return 2
  return 1
}

export function conditionLabel(code: number): string {
  if (code === 0) return 'Clear skies'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Foggy'
  if (SNOW_CODES.has(code)) return 'Snow'
  if (code >= 95) return 'Thunderstorms'
  if (code <= 57) return 'Drizzle'
  if (code >= 80) return 'Showers'
  return 'Rain'
}

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** Open-Meteo `current` block → our shape. `null` when the payload is unusable. */
export function classifyCurrent(current: unknown, now = Date.now()): NycWeather | null {
  if (typeof current !== 'object' || current === null) return null
  const c = current as Record<string, unknown>
  const temperature = number(c.temperature_2m)
  const feelsLike = number(c.apparent_temperature)
  const wind = number(c.wind_speed_10m)
  const code = number(c.weather_code)
  if (temperature === null || feelsLike === null || wind === null || code === null) return null

  // `rain` and `showers` are liquid only; `precipitation` would fold in snowfall.
  const liquid = Math.max(number(c.rain) ?? 0, number(c.showers) ?? 0)
  const snowing = SNOW_CODES.has(code) || (number(c.snowfall) ?? 0) > 0
  const codeSeverity = CODE_SEVERITY[code] ?? 0
  const measured = severityFromMm(liquid)
  // Either signal is enough: a code can say "rain" before the hourly total moves,
  // and measurable rain counts even under a merely cloudy code.
  const severity = (Math.max(codeSeverity, measured) as RainSeverity)
  const raining = severity > 0 && !(snowing && liquid === 0 && codeSeverity === 0)
  const kind: Precipitation = raining ? 'rain' : snowing ? 'snow' : 'none'

  return {
    temperature,
    feelsLike,
    wind,
    code,
    rainMm: liquid > 0 ? liquid : null,
    kind,
    raining,
    severity: raining ? severity : 0,
    label: conditionLabel(code),
    live: true,
    fetchedAt: now,
  }
}


const URL =
  'https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060' +
  '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,rain,showers,snowfall' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York'

const LIVE_TTL_MS = 600_000 // Open-Meteo updates hourly; ten minutes is plenty

let cache: NycWeather | null = null
let inflight: Promise<NycWeather | null> | null = null

/**
 * Cached NYC reading, or null when the sky could not be read. There used to be a stand-in here
 * — 68°F, "Partly cloudy" — which the widget showed with a DEMO badge and the scene took as
 * "no rain". An unknown sky is now unknown.
 */
export function readNycWeather(): Promise<NycWeather | null> {
  if (cache && Date.now() - cache.fetchedAt < LIVE_TTL_MS) return Promise.resolve(cache)
  inflight ??= (async () => {
    try {
      const response = await fetch(URL, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error(`weather returned HTTP ${response.status}`)
      const body = (await response.json()) as { current?: unknown }
      const weather = classifyCurrent(body.current)
      if (!weather) throw new Error('weather payload was unusable')
      cache = weather
      return weather
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** The last reading, without triggering a fetch. */
export function cachedNycWeather(): NycWeather | null {
  return cache
}

import { useEffect, useState } from 'react'
import { Cloud, CloudRain, Snowflake, Sun, Wind } from 'lucide-react'
import './WeatherWidget.css'

interface Weather { temperature: number; feelsLike: number; wind: number; code: number; demo: boolean }
const DEMO: Weather = { temperature: 68, feelsLike: 67, wind: 6, code: 2, demo: true }
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York'
let cache: { value: Weather; time: number } | undefined
let inflight: Promise<Weather> | undefined

async function readWeather(): Promise<Weather> {
  if (cache && Date.now() - cache.time < (cache.value.demo ? 60_000 : 600_000)) return cache.value
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const response = await fetch(URL, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Weather unavailable')
      const { current } = await response.json()
      const values = [current?.temperature_2m, current?.apparent_temperature, current?.wind_speed_10m, current?.weather_code]
      if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid weather')
      const value = { temperature: values[0], feelsLike: values[1], wind: values[2], code: values[3], demo: false }
      cache = { value, time: Date.now() }
      return value
    } catch {
      cache = { value: DEMO, time: Date.now() }
      return DEMO
    } finally { inflight = undefined }
  })()
  return inflight
}

function conditions(code: number) {
  if (code === 0) return { label: 'Clear skies', Icon: Sun }
  if (code <= 3) return { label: code === 3 ? 'Overcast' : 'Partly cloudy', Icon: Cloud }
  if (code <= 48) return { label: 'Foggy', Icon: Cloud }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow', Icon: Snowflake }
  return { label: code >= 95 ? 'Thunderstorms' : 'Rain', Icon: CloudRain }
}

export function WeatherWidget() {
  const [weather, setWeather] = useState<Weather | null>(cache?.value ?? null)
  useEffect(() => {
    let active = true
    const refresh = () => {
      if (!document.hidden) void readWeather().then(value => { if (active) setWeather(value) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const { label, Icon } = conditions(weather?.code ?? 2)
  return (
    <aside className="gg-weather" aria-label="New York City weather">
      <div className="gg-weather-heading font-pixel"><span>NYC WEATHER</span><span className="gg-weather-source">{weather ? weather.demo ? 'DEMO' : 'LIVE' : '…'}</span></div>
      <div className="gg-weather-main"><Icon size={26} strokeWidth={1.5} aria-hidden /><span className="font-pixel">{weather ? `${Math.round(weather.temperature)}°F` : '…'}</span><span className="font-mono">{weather ? label : 'Checking skies…'}</span></div>
      <div className="gg-weather-details font-mono"><span>{weather ? `Feels ${Math.round(weather.feelsLike)}°` : 'New York, NY'}</span><span><Wind size={12} aria-hidden />{weather ? `${Math.round(weather.wind)} mph` : '—'}</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></div>
    </aside>
  )
}

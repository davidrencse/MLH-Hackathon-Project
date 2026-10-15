// NYC weather, and a readout of what it is doing to the city.
//
// The reading comes from the shared store (see weather/nyc.ts), which also drives
// the rain in the scene — so this badge and the sky over the city can never
// disagree. Hidden below 1100px, where the command bar would sit on top of it.
import { Cloud, CloudLightning, CloudRain, Snowflake, Sun, Wind } from 'lucide-react'
import { useNycWeather } from '../store/weather'
import { SEVERITY_LABEL, type NycWeather } from '../weather/nyc'
import './WeatherWidget.css'

function Icon({ weather }: { weather: NycWeather }) {
  const props = { size: 26, strokeWidth: 1.5, 'aria-hidden': true } as const
  if (weather.severity === 4) return <CloudLightning {...props} />
  if (weather.raining) return <CloudRain {...props} />
  if (weather.kind === 'snow') return <Snowflake {...props} />
  if (weather.code === 0) return <Sun {...props} />
  return <Cloud {...props} />
}

export function WeatherWidget() {
  const { weather, pending } = useNycWeather()
  // No reading is its own state: the widget used to fall back to a stand-in reading (68°F,
  // partly cloudy) behind a DEMO badge, which is a weather report nobody measured.
  const conditions = weather && (weather.raining ? `${weather.label} · ${SEVERITY_LABEL[weather.severity]}` : weather.label)
  const dash = pending ? '…' : '—'
  return (
    <aside data-hud-panel className="gg-weather" aria-label="New York City weather">
      <div className="gg-weather-heading font-pixel">
        <span>NYC WEATHER</span>
        <span className="gg-weather-source">{pending ? '…' : weather?.live ? 'LIVE' : 'NO READING'}</span>
      </div>
      <div className="gg-weather-main">
        {weather ? <Icon weather={weather} /> : <Cloud size={26} strokeWidth={1.5} aria-hidden />}
        <span className="font-pixel">{weather ? `${Math.round(weather.temperature)}°F` : dash}</span>
        <span className="font-mono">{weather ? conditions : pending ? 'Checking skies…' : 'Sky could not be read'}</span>
      </div>
      <div className="gg-weather-details font-mono">
        <span>{weather ? `Feels ${Math.round(weather.feelsLike)}°` : 'New York, NY'}</span>
        <span>
          <Wind size={12} aria-hidden />
          {weather ? `${Math.round(weather.wind)} mph` : dash}
        </span>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>
      </div>
      {weather?.raining ? (
        <p className="gg-weather-rain font-mono">
          Raining on the grid
          {weather.rainMm === null ? '' : ` · ${weather.rainMm.toFixed(1)} mm/h`}
        </p>
      ) : null}
    </aside>
  )
}

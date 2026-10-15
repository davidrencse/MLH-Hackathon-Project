// Rain for the 2D fallback city (no WebGL). Same source of truth as the 3D rain:
// the live weather in New York, at the severity New York is getting.
//
// Three parallax sheets of CSS gradient streaks, so there is no per-drop DOM and
// nothing for JavaScript to animate. Severity moves four CSS variables.
import type { CSSProperties } from 'react'
import { useRainSeverity } from '../store/weather'
import type { RainSeverity } from '../weather/nyc'
import './rain.css'

interface Sheet {
  /** Seconds for one fall cycle; smaller is faster. */
  fall: number
  /** Gap between streaks, px (stage pixels). */
  gap: number
  length: number
  opacity: number
}
const LOOKS: Record<Exclude<RainSeverity, 0>, { sheets: Sheet[]; lean: number; flash: boolean }> = {
  1: { sheets: [{ fall: 1.5, gap: 46, length: 12, opacity: 0.22 }, { fall: 2.1, gap: 62, length: 9, opacity: 0.14 }], lean: 6, flash: false },
  2: { sheets: [{ fall: 1.1, gap: 30, length: 17, opacity: 0.3 }, { fall: 1.6, gap: 42, length: 12, opacity: 0.2 }], lean: 9, flash: false },
  3: {
    sheets: [
      { fall: 0.8, gap: 19, length: 23, opacity: 0.38 },
      { fall: 1.15, gap: 27, length: 17, opacity: 0.26 },
      { fall: 1.6, gap: 37, length: 12, opacity: 0.16 },
    ],
    lean: 13,
    flash: false,
  },
  4: {
    sheets: [
      { fall: 0.62, gap: 13, length: 30, opacity: 0.46 },
      { fall: 0.9, gap: 19, length: 22, opacity: 0.32 },
      { fall: 1.3, gap: 27, length: 15, opacity: 0.2 },
    ],
    lean: 19,
    flash: true,
  },
}

export function Rain2D() {
  const severity = useRainSeverity()
  if (severity === 0) return null
  const look = LOOKS[severity]
  return (
    <div className="gg-rain-root" aria-hidden>
      {look.flash ? <div className="gg-rain-flash" /> : null}
      {look.sheets.map((sheet, index) => (
        <div
          key={index}
          className="gg-rain-sheet"
          style={
            {
              '--gg-rain-fall': `${sheet.fall}s`,
              '--gg-rain-gap': `${sheet.gap}px`,
              '--gg-rain-len': `${sheet.length}px`,
              '--gg-rain-opacity': sheet.opacity,
              '--gg-rain-lean': `${look.lean}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

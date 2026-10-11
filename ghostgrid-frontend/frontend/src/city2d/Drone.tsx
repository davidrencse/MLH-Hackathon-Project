// Pixel-art sprites for the flight layer. Every sprite is drawn with box-shadow
// pixels in LOGICAL px (the stage is integer-scaled), so it stays crisp.
import type { CSSProperties } from 'react'
import './Drone.css'

type Palette = Record<string, string>

// The carrier element sits at (-O,-O) and every pixel is offset by +O: an outer
// box-shadow at offset (0,0) would be hidden under the element, and the keyline
// needs room for pixels at x/y = -1.
const O = 2
const KEYLINE = 'rgba(11,8,32,0.8)' // --gg-void

// ASCII rows → box-shadow list. '.' = empty; chars missing from the palette are skipped.
function sprite(rows: string[], pal: Palette): string {
  const out: string[] = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]]
      if (c) out.push(`${x + O}px ${y + O}px 0 0 ${c}`)
    }
  })
  return out.join(',')
}

// 1px dark keyline around the filled pixels, so sprites stay readable over neon buildings.
function keyline(rows: string[]): string {
  const filled = (x: number, y: number) => (rows[y]?.[x] ?? '.') !== '.'
  const w = Math.max(...rows.map((r) => r.length))
  const out: string[] = []
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= w; x++) {
      if (filled(x, y)) continue
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        out.push(`${x + O}px ${y + O}px 0 0 ${KEYLINE}`)
      }
    }
  }
  return out.join(',')
}

function Px({ shadow, className = '', style }: { shadow: string; className?: string; style?: CSSProperties }) {
  return <i className={`gg-flt-px ${className}`} style={{ boxShadow: shadow, ...style }} />
}

const INK = 'var(--gg-ink)'
const MUTE = 'var(--gg-mute)'
const HAZE = 'var(--gg-haze)'
const CYAN = 'var(--gg-cyan)'
const PINK = 'var(--gg-pink)'
const RED = 'var(--gg-red)'
const GREEN = 'var(--gg-green)'
const YELLOW = 'var(--gg-yellow)'
const CYAN_DIM = 'rgba(0,240,255,0.45)'

// ---- Quadcopter, 10×6 (cargo variant 10×11) ----
const DRONE_W = 10
const DRONE_ROWS = [
  'khk....khk', // rotor hubs + dim blade tips (blades blink on top)
  '.m..CC..m.', // rotor shafts, canopy
  '.mmCiCCmm.', // arms + body with ink glint
  '...cCLc...', // belly + LED
  '...m..m...', // legs
  '..m....m..', // splayed skids
]
const CARGO_ROWS = [
  ...DRONE_ROWS.slice(0, 4),
  '...mt.m...', // tether starts between the legs
  '..m.t..m..',
  '....t.....',
  '...QQQg...', // data cube: cyan top edge, green body, dark right side
  '...GjGg...',
  '...GGGg...',
  '...gggg...',
]
const BODY_PAL: Palette = { k: HAZE, h: MUTE, m: MUTE, C: CYAN, c: CYAN_DIM, i: INK }
const DRONE_BODY = sprite(DRONE_ROWS, BODY_PAL)
const DRONE_ROTOR = sprite(['rrr....rrr'], { r: INK })
const DRONE_LED = sprite(DRONE_ROWS, { L: PINK })
const DRONE_LED_RED = sprite(DRONE_ROWS, { L: RED })
const DRONE_KEYLINE = keyline(DRONE_ROWS)
const CARGO_KEYLINE = keyline(CARGO_ROWS)
const CARGO_TETHER = sprite(CARGO_ROWS, { t: 'rgba(232,230,255,0.55)' })
const CARGO_CUBE = sprite(CARGO_ROWS, { Q: CYAN, G: GREEN, g: 'rgba(57,255,20,0.5)', j: INK })

export function DroneSprite({
  cargo = false,
  flip = false,
  damaged = false,
  idle = false,
}: {
  cargo?: boolean
  flip?: boolean
  damaged?: boolean
  idle?: boolean
}) {
  const h = cargo ? CARGO_ROWS.length : DRONE_ROWS.length
  // Anchor = bottom-center of the sprite (skids, or the cube when carrying cargo).
  return (
    <div
      className={`gg-flt-box ${flip ? 'gg-flt-flip' : ''}`}
      style={{ left: -DRONE_W / 2, top: -h, width: DRONE_W, height: h }}
    >
      <div className={damaged ? 'gg-flt-shake' : undefined}>
        <Px shadow={cargo ? CARGO_KEYLINE : DRONE_KEYLINE} />
        <Px shadow={DRONE_BODY} className="gg-flt-glow-cyan" />
        <Px shadow={DRONE_ROTOR} className={`gg-flt-rotor ${idle ? 'gg-flt-rotor-idle' : ''}`} />
        <Px shadow={damaged ? DRONE_LED_RED : DRONE_LED} className={damaged ? 'gg-flt-led gg-flt-led-red' : 'gg-flt-led'} />
        {cargo && (
          <>
            <Px shadow={CARGO_TETHER} />
            <Px shadow={CARGO_CUBE} className="gg-flt-cube" />
          </>
        )}
      </div>
    </div>
  )
}

// ---- Data packet, 3×3 ----
const PACKET_ROWS = ['yYy', 'YiY', 'yYy']
const PACKET = sprite(PACKET_ROWS, { Y: YELLOW, y: 'rgba(255,212,0,0.6)', i: INK })
const PACKET_KEYLINE = keyline(PACKET_ROWS)
const PACKET_GHOST = sprite(PACKET_ROWS, { Y: YELLOW, y: YELLOW, i: YELLOW })

export function PacketSprite({ ghost = 0 }: { ghost?: number }) {
  return (
    <div className="gg-flt-box" style={{ left: -1, top: -3, width: 3, height: 3 }}>
      {ghost > 0 ? (
        <Px shadow={PACKET_GHOST} style={{ opacity: ghost }} />
      ) : (
        <>
          <Px shadow={PACKET_KEYLINE} />
          <Px shadow={PACKET} className="gg-flt-glow-yellow" />
        </>
      )}
    </div>
  )
}

// ---- Thruster spark, 1×1 ----
export function Spark({ color, opacity }: { color: string; opacity: number }) {
  return <Px shadow={`${O}px ${O}px 0 0 ${color}`} className="gg-flt-spark" style={{ opacity }} />
}

// ---- Ring burst on take-off / landing (frames live in Drone.css) ----
export function Burst({ x, y, color }: { x: number; y: number; color: string }) {
  return <i className="gg-flt-burst" style={{ left: x, top: y, color }} />
}

// ---- Smoke puff for a damaged drone (frames live in Drone.css) ----
export function SmokePuff({ x, y, light }: { x: number; y: number; light: boolean }) {
  return (
    <div className="gg-flt-anchor" style={{ left: x - 2, top: y - 2 }}>
      <i className="gg-flt-puff" style={{ color: light ? MUTE : 'var(--gg-grey)' }} />
    </div>
  )
}

// ---- Parked drone, hovering over its dock until the next dispatch ----
export function ParkedDrone({ x, y }: { x: number; y: number }) {
  return (
    <div className="gg-flt-anchor gg-flt-boot" style={{ left: x, top: y }}>
      <div className="gg-flt-bob">
        <DroneSprite idle />
      </div>
    </div>
  )
}

// ---- Ambient patrol drone, 5×3, crosses the top of the stage now and then ----
const PATROL_BODY = sprite(['k...k', 'mmCmm', '.c.c.'], { k: HAZE, m: MUTE, C: CYAN, c: CYAN_DIM })
const PATROL_ROTOR = sprite(['r...r'], { r: INK })
const PATROL_LED = sprite(['', '', '..L'], { L: PINK })

export function PatrolDrone() {
  return (
    <div className="gg-flt-patrol">
      <div className="gg-flt-bob gg-flt-bob-slow">
        <div className="gg-flt-box" style={{ left: 0, top: 0, width: 5, height: 3 }}>
          <Px shadow={PATROL_BODY} />
          <Px shadow={PATROL_ROTOR} className="gg-flt-rotor" />
          <Px shadow={PATROL_LED} className="gg-flt-led" />
        </div>
      </div>
    </div>
  )
}

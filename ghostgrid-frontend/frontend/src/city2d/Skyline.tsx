// Skyline: the distant scenery between ShaderSky and the stage (z-10).
// Everything sits on the stage pixel grid: 1 logical px = var(--stage-scale) real px.
// The strip is 1024 logical px wide and centred on the stage, so it lines up with the
// stage grid and covers any viewport. All geometry is generated once at module load
// from fixed seeds (deterministic). Motion is CSS only (transform / opacity), see skyline.css.
import type { CSSProperties, ReactNode } from 'react'
import './skyline.css'

/* ------------------------------------------------------------------ grid helpers */

const W = 1024 // logical width of the scenery strip
const CX = W / 2 // strip x of the stage centre (stage spans 320..704 in strip coords)
const SKY_H = 150 // logical height of the skyline strip, above the street top edge
const STAR_H = 104 // logical height of the star field (about the top 40% of the viewport)
const STREET_H = 24 // logical street height (STAGE.h - STAGE.ground)

const S = 'var(--stage-scale, 3)'
const px = (n: number) => `calc(${S} * ${n}px)`
const atX = (x: number) => `calc(50% + ${px(x - CX)})`
const atH = (h: number) => `calc(var(--ground-bottom, 72px) + ${px(h)})`
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`
const strip = (h: number): CSSProperties => ({ left: `calc(50% - ${px(CX)})`, width: px(W), height: px(h) })

const T = {
  void: 'var(--gg-void)',
  night: 'var(--gg-night)',
  dusk: 'var(--gg-dusk)',
  haze: 'var(--gg-haze)',
  ink: 'var(--gg-ink)',
  mute: 'var(--gg-mute)',
  pink: 'var(--gg-pink)',
  cyan: 'var(--gg-cyan)',
  yellow: 'var(--gg-yellow)',
}
const MID_BODY = '#24164f' // between haze and night

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One SVG path in a palette color. Renders nothing for an empty path. */
function P({ d, fill, a = 1, className }: { d: string; fill: string; a?: number; className?: string }) {
  if (!d) return null
  return <path d={d} className={className} style={{ fill, fillOpacity: a }} />
}

/* ------------------------------------------------------------------ bitmap fonts */

// 3x5 pixel font, rows separated by spaces. Only the glyphs we draw.
const FONT3: Record<string, string> = {
  A: '.#. #.# ### #.# #.#',
  C: '### #.. #.. #.. ###',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  G: '### #.. #.# #.# ###',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  L: '#.. #.. #.. #.. ###',
  N: '##. #.# #.# #.# #.#',
  O: '### #.# #.# #.# ###',
  P: '### #.# ### #.. #..',
  R: '##. #.# ##. #.# #.#',
  S: '### #.. ### ..# ###',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  '3': '### ..# .## ..# ###',
  '/': '..# ..# .#. #.. #..',
  '>': '#.. .#. ..# .#. #..',
}

// 5x7 katakana for the vertical neon sign.
const KANA: Record<string, string> = {
  ネ: '..#.. ##### ...#. ..##. .##.# #.#.. ..#..',
  オ: '...#. ##### ..##. .#.#. #..#. ...#. ..##.',
  ン: '..... #.... .#..# ....# ...#. ..#.. ##...',
}

function glyph(bitmap: string, x0: number, y0: number) {
  let d = ''
  bitmap.split(' ').forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') d += rect(x0 + rx, y0 + ry, 1, 1)
  })
  return d
}

function text3(str: string, x0: number, y0: number) {
  let d = ''
  for (let i = 0; i < str.length; i++) {
    const g = FONT3[str[i]]
    if (g) d += glyph(g, x0 + i * 4, y0)
  }
  return d
}

/* ------------------------------------------------------------------ stars */

function buildStars() {
  const rnd = mulberry32(1337)
  const g = { dim: '', a: '', b: '', cyan: '', pink: '', big: '' }
  for (let i = 0; i < 120; i++) {
    const x = Math.floor(rnd() * W)
    const y = Math.floor(rnd() ** 1.3 * STAR_H)
    const r = rnd()
    const k: keyof typeof g = r < 0.5 ? 'dim' : r < 0.7 ? 'a' : r < 0.84 ? 'b' : r < 0.93 ? 'cyan' : 'pink'
    g[k] += rect(x, y, 1, 1)
  }
  for (let i = 0; i < 7; i++) {
    const x = 2 + Math.floor(rnd() * (W - 4))
    const y = 2 + Math.floor(rnd() * STAR_H * 0.6)
    g.big += rect(x - 1, y, 3, 1) + rect(x, y - 1, 1, 3)
  }
  return g
}
const STARS = buildStars()

function Stars() {
  return (
    <svg
      className="gg-sky-abs"
      viewBox={`0 0 ${W} ${STAR_H}`}
      shapeRendering="crispEdges"
      style={{ ...strip(STAR_H), top: 0 }}
    >
      <P d={STARS.dim} fill={T.ink} a={0.28} />
      <P d={STARS.a} fill={T.ink} a={0.55} className="gg-sky-tw-a" />
      <P d={STARS.b} fill={T.ink} a={0.5} className="gg-sky-tw-b" />
      <P d={STARS.cyan} fill={T.cyan} a={0.45} className="gg-sky-tw-c" />
      <P d={STARS.pink} fill={T.pink} a={0.4} className="gg-sky-tw-a" />
      <P d={STARS.big} fill={T.ink} a={0.6} className="gg-sky-tw-c" />
    </svg>
  )
}

/* ------------------------------------------------------------------ skyline layers */

type WinColor = 'cyan' | 'yellow' | 'pink'
type Blink = 's' | 'a' | 'b'
const WIN_COLORS: WinColor[] = ['cyan', 'yellow', 'pink']
const BLINK_CLASS: Record<Blink, string | undefined> = { s: undefined, a: 'gg-sky-win-a', b: 'gg-sky-win-b' }

interface Tower {
  x: number
  w: number
  h: number
}
interface LayerSpec {
  seed: number
  minW: number
  maxW: number
  minH: number
  maxH: number
  lit: number // base chance a window cell is lit
  anchors?: Tower[] // fixed towers (billboard mounts)
  antennas?: boolean
  trims?: boolean
}
interface LayerArt {
  body: string
  win: Record<string, string> // key `${WinColor}-${Blink}`
  beacon: [string, string]
  trim: [string, string]
}

function buildLayer(spec: LayerSpec): LayerArt {
  const rnd = mulberry32(spec.seed)
  const int = (n: number) => Math.floor(rnd() * n)
  let body = ''
  const win: Record<string, string> = {}
  const beacon: [string, string] = ['', '']
  const trim: [string, string] = ['', '']

  const towers: Tower[] = []
  for (let x = -int(spec.maxW); x < W; ) {
    const w = spec.minW + int(spec.maxW - spec.minW + 1)
    // Towers get taller away from the stage centre, so the stage buildings read first.
    const edge = Math.min(1, Math.abs(x + w / 2 - CX) / 300)
    const cap = spec.maxH * (0.68 + 0.32 * edge)
    const h = Math.round(spec.minH + (cap - spec.minH) * rnd() ** 1.6)
    towers.push({ x, w, h })
    x += w + int(3) - 1
  }
  towers.push(...(spec.anchors ?? []))

  for (const t of towers) {
    const top = SKY_H - t.h
    body += rect(t.x, top, t.w, t.h)
    let roofY = top
    let roofX = t.x + (t.w >> 1)
    const crown = rnd()
    if (crown < 0.22 && t.w >= 8) {
      // setback crown
      const cw = Math.max(3, t.w >> 1)
      const ch = 3 + int(6)
      const cx = t.x + ((t.w - cw) >> 1)
      body += rect(cx, top - ch, cw, ch)
      roofY = top - ch
      roofX = cx + (cw >> 1)
    } else if (crown < 0.34 && t.w <= 18) {
      // stepped spire
      for (let sw = t.w - 2, sy = top; sw >= 2; sw -= 4) {
        sy -= 2
        body += rect(t.x + ((t.w - sw) >> 1), sy, sw, 2)
        roofY = sy
      }
    } else if (crown < 0.5 && t.w >= 6) {
      body += rect(t.x + 1 + int(t.w - 4), top - 2, 3, 2) // roof box
    }
    if (spec.antennas && t.h > spec.maxH * 0.5 && rnd() < 0.45) {
      const ah = 4 + int(9)
      body += rect(roofX, roofY - ah, 1, ah)
      if (rnd() < 0.75) beacon[int(2)] += rect(roofX, roofY - ah - 1, 1, 1)
    }
    if (spec.trims && rnd() < 0.2) trim[int(2)] += rect(t.x, top, t.w, 1)

    // Windows: 1x1 lit cells on a 2-3 px grid. Some towers stay dark, some are busy,
    // a few have one fully lit floor band.
    const lit = spec.lit * (0.2 + rnd() * 1.6)
    const main = WIN_COLORS[int(3)]
    const sx = rnd() < 0.5 ? 2 : 3
    const sy = rnd() < 0.7 ? 2 : 3
    const band = rnd() < 0.14 ? top + 2 + sy * int(Math.max(1, (t.h - 6) / sy)) : -1
    for (let yy = top + 2; yy < SKY_H - 2; yy += sy) {
      for (let xx = t.x + 1; xx < t.x + t.w - 1; xx += sx) {
        if (xx < 0 || xx >= W) continue
        if (yy !== band && rnd() >= lit) continue
        const c = rnd() < 0.7 ? main : WIN_COLORS[int(3)]
        const r = rnd()
        const b: Blink = r < 0.08 ? 'a' : r < 0.14 ? 'b' : 's'
        const k = `${c}-${b}`
        win[k] = (win[k] ?? '') + rect(xx, yy, 1, 1)
      }
    }
  }
  return { body, win, beacon, trim }
}

// Billboard mounts (strip coords). Stage buildings occupy 376..440, 488..536, 576..656.
const MOUNT_MAIN: Tower = { x: 320, w: 54, h: 62 } // left of Codex Tower
const MOUNT_SIGN: Tower = { x: 444, w: 16, h: 96 } // alley between Codex and Router
const MOUNT_CHART: Tower = { x: 658, w: 44, h: 46 } // right of Security Checkpoint

const FAR = buildLayer({ seed: 11, minW: 8, maxW: 22, minH: 34, maxH: 124, lit: 0.07, antennas: true })
const MID = buildLayer({
  seed: 29,
  minW: 10,
  maxW: 26,
  minH: 20,
  maxH: 86,
  lit: 0.1,
  antennas: true,
  anchors: [MOUNT_MAIN, MOUNT_SIGN, MOUNT_CHART],
})
const NEAR = buildLayer({ seed: 47, minW: 12, maxW: 34, minH: 8, maxH: 46, lit: 0.12, trims: true })

function Layer({ art, fill, a = 1, winA, under }: { art: LayerArt; fill: string; a?: number; winA: number; under?: boolean }) {
  return (
    <g>
      {under && <P d={art.body} fill={T.void} />}
      <P d={art.body} fill={fill} a={a} />
      {Object.entries(art.win).map(([k, d]) => {
        const [c, b] = k.split('-') as [WinColor, Blink]
        return <P key={k} d={d} fill={T[c]} a={winA} className={BLINK_CLASS[b]} />
      })}
      <P d={art.beacon[0]} fill={T.pink} a={0.75} className="gg-sky-beacon-a" />
      <P d={art.beacon[1]} fill={T.pink} a={0.75} className="gg-sky-beacon-b" />
      <P d={art.trim[0]} fill={T.pink} a={0.3} />
      <P d={art.trim[1]} fill={T.cyan} a={0.3} />
    </g>
  )
}

/** Stepped haze band at the foot of a layer (pixel "gradient"). */
function Fog({ steps, a }: { steps: number[]; a: number }) {
  return (
    <>
      {steps.map((h) => (
        <P key={h} d={rect(0, SKY_H - h, W, h)} fill={T.haze} a={a} />
      ))}
    </>
  )
}

function SkylineStrip() {
  return (
    <svg
      className="gg-sky-abs"
      viewBox={`0 0 ${W} ${SKY_H}`}
      shapeRendering="crispEdges"
      style={{ ...strip(SKY_H), bottom: 'var(--ground-bottom, 72px)' }}
    >
      <Layer art={FAR} fill={T.haze} a={0.62} winA={0.26} under />
      <Fog steps={[30, 18, 8]} a={0.05} />
      <Layer art={MID} fill={MID_BODY} winA={0.4} />
      <Fog steps={[16, 6]} a={0.05} />
      <Layer art={NEAR} fill={T.night} winA={0.5} />
    </svg>
  )
}

/* ------------------------------------------------------------------ billboards */

function Board({
  x,
  h,
  w,
  hgt,
  glow,
  holo,
  children,
}: {
  x: number
  h: number
  w: number
  hgt: number
  glow: string
  holo: 'a' | 'b' | 'c'
  children: ReactNode
}) {
  return (
    <svg
      className={`gg-sky-abs gg-sky-board gg-sky-holo-${holo}`}
      viewBox={`0 0 ${w} ${hgt}`}
      shapeRendering="crispEdges"
      style={{
        left: atX(x),
        bottom: atH(h),
        width: px(w),
        height: px(hgt),
        filter: `drop-shadow(0 0 ${px(2)} color-mix(in srgb, ${glow} 40%, transparent))`,
      }}
    >
      {children}
    </svg>
  )
}

const frame = (w: number, h: number) => rect(0, 0, w, 1) + rect(0, h - 1, w, 1) + rect(0, 1, 1, h - 2) + rect(w - 1, 1, 1, h - 2)
function scanlines(x: number, w: number, h: number) {
  let d = ''
  for (let y = 1; y < h - 1; y += 2) d += rect(x, y, w, 1)
  return d
}

// SLOP ANGELES marquee with an AGENTS ONLINE ticker.
const MAIN_W = 53
const MAIN_H = 17
const TICKER = 'AGENTS ONLINE 3/3 > ROUTER > CODEX > SECURITY > '
const TICK_W = TICKER.length * 4
const MAIN_ART = {
  frame: frame(MAIN_W, MAIN_H),
  title: text3('SLOP ANGELES', 3, 2),
  ticker: text3(TICKER, 2, 10) + text3(TICKER, 2 + TICK_W, 10),
  scan: scanlines(1, MAIN_W - 2, MAIN_H),
  legs: rect(5, MAIN_H, 1, 6) + rect(MAIN_W - 6, MAIN_H, 1, 6) + rect(5, MAIN_H + 3, MAIN_W - 10, 1),
}

function BoardMain() {
  const x = MOUNT_MAIN.x + ((MOUNT_MAIN.w - MAIN_W) >> 1)
  return (
    <Board x={x} h={MOUNT_MAIN.h} w={MAIN_W} hgt={MAIN_H + 6} glow={T.pink} holo="a">
      <defs>
        <clipPath id="gg-sky-ticker-clip">
          <rect x={2} y={10} width={MAIN_W - 4} height={5} />
        </clipPath>
      </defs>
      <P d={MAIN_ART.legs} fill={T.haze} />
      <P d={rect(0, 0, MAIN_W, MAIN_H)} fill={T.void} a={0.78} />
      <P d={MAIN_ART.frame} fill={T.pink} a={0.55} />
      <P d={MAIN_ART.title} fill={T.pink} a={0.9} className="gg-sky-title" />
      <P d={rect(2, 8, MAIN_W - 4, 1)} fill={T.pink} a={0.22} />
      <g clipPath="url(#gg-sky-ticker-clip)">
        <g
          className="gg-sky-ticker"
          style={
            {
              '--gg-sky-tick': TICK_W,
              animationDuration: `${TICK_W / 8}s`,
              animationTimingFunction: `steps(${TICK_W})`,
            } as CSSProperties
          }
        >
          <P d={MAIN_ART.ticker} fill={T.cyan} a={0.8} />
        </g>
      </g>
      <P d={MAIN_ART.scan} fill={T.void} a={0.3} />
      <g className="gg-sky-sweep" style={{ '--gg-sky-sweep': MAIN_H - 3, animationTimingFunction: `steps(${MAIN_H - 3})` } as CSSProperties}>
        <P d={rect(1, 1, MAIN_W - 2, 1)} fill={T.cyan} a={0.16} />
      </g>
    </Board>
  )
}

// Tiny K-line (candlestick) screen: tokens per second.
const CHART_W = 30
const CHART_H = 20
// [open, close, high, low] in 0..9, chart y = 17 - v
const CANDLES: [number, number, number, number][] = [
  [1, 3, 4, 0],
  [3, 2, 4, 1],
  [2, 5, 6, 2],
  [5, 4, 6, 3],
  [4, 7, 8, 4],
  [6, 9, 9, 5],
]
function buildChart() {
  const up = { body: '', wick: '' }
  const down = { body: '', wick: '' }
  let live = ''
  CANDLES.forEach(([o, c, hi, lo], i) => {
    const x = 3 + i * 4
    const side = c >= o ? up : down
    const yTop = 17 - Math.max(o, c)
    const bh = Math.max(1, Math.abs(o - c))
    side.wick += rect(x + 1, 17 - hi, 1, hi - lo + 1)
    if (i === CANDLES.length - 1) live = rect(x, yTop, 3, bh)
    else side.body += rect(x, yTop, 3, bh)
  })
  let price = ''
  for (let x = 2; x < CHART_W - 2; x += 2) price += rect(x, 17 - CANDLES[CANDLES.length - 1][1], 1, 1)
  return { up, down, live, price }
}
const CHART = buildChart()
const CHART_ART = {
  frame: frame(CHART_W, CHART_H),
  label: text3('TPS', 2, 2),
  scan: scanlines(1, CHART_W - 2, CHART_H),
  legs: rect(4, CHART_H, 1, 5) + rect(25, CHART_H, 1, 5),
}

function BoardChart() {
  const x = MOUNT_CHART.x + ((MOUNT_CHART.w - CHART_W) >> 1)
  return (
    <Board x={x} h={MOUNT_CHART.h} w={CHART_W} hgt={CHART_H + 5} glow={T.cyan} holo="b">
      <P d={CHART_ART.legs} fill={T.haze} />
      <P d={rect(0, 0, CHART_W, CHART_H)} fill={T.void} a={0.8} />
      <P d={CHART_ART.frame} fill={T.cyan} a={0.5} />
      <P d={CHART_ART.label} fill={T.ink} a={0.55} />
      <P d={rect(CHART_W - 4, 3, 1, 1)} fill={T.pink} a={0.9} className="gg-sky-beacon-a" />
      <P d={rect(2, 18, CHART_W - 4, 1)} fill={T.haze} />
      <P d={CHART.price} fill={T.cyan} a={0.25} />
      <P d={CHART.up.wick} fill={T.cyan} a={0.55} />
      <P d={CHART.down.wick} fill={T.pink} a={0.55} />
      <P d={CHART.up.body} fill={T.cyan} a={0.85} />
      <P d={CHART.down.body} fill={T.pink} a={0.85} />
      <P d={CHART.live} fill={T.cyan} a={0.9} className="gg-sky-candle" />
      <P d={CHART_ART.scan} fill={T.void} a={0.3} />
      <g className="gg-sky-sweep" style={{ '--gg-sky-sweep': CHART_H - 3, animationTimingFunction: `steps(${CHART_H - 3})` } as CSSProperties}>
        <P d={rect(1, 1, CHART_W - 2, 1)} fill={T.cyan} a={0.16} />
      </g>
    </Board>
  )
}

// Vertical katakana neon sign hanging off a tower in the alley. The middle glyph is "broken".
const SIGN_W = 12 // 3 px bracket + 9 px sign
const SIGN_H = 27
const SIGN_ART = {
  arms: rect(0, 4, 3, 1) + rect(0, 22, 3, 1),
  frame: rect(3, 0, 9, 1) + rect(3, SIGN_H - 1, 9, 1) + rect(3, 1, 1, SIGN_H - 2) + rect(11, 1, 1, SIGN_H - 2),
  ne: glyph(KANA['ネ'], 5, 2),
  o: glyph(KANA['オ'], 5, 10),
  n: glyph(KANA['ン'], 5, 18),
}

function SignNeon() {
  return (
    <Board x={MOUNT_SIGN.x + MOUNT_SIGN.w} h={48} w={SIGN_W} hgt={SIGN_H} glow={T.pink} holo="c">
      <P d={SIGN_ART.arms} fill={T.haze} />
      <P d={rect(3, 0, 9, SIGN_H)} fill={T.void} a={0.8} />
      <P d={SIGN_ART.frame} fill={T.cyan} a={0.4} />
      <P d={SIGN_ART.ne + SIGN_ART.n} fill={T.pink} a={0.9} />
      <P d={SIGN_ART.o} fill={T.pink} a={0.9} className="gg-sky-broken" />
    </Board>
  )
}

/* ------------------------------------------------------------------ flying cars */

const CARS = [
  { h: 124, dur: 46, delay: -9, dir: 'r' as const, trail: T.pink },
  { h: 100, dur: 64, delay: -41, dir: 'l' as const, trail: T.cyan },
]

function Cars() {
  return (
    <>
      {CARS.map((c) => (
        <div key={c.h} className="gg-sky-car-track" style={{ bottom: atH(c.h), height: px(5) }}>
          <div
            className={`gg-sky-car-run gg-sky-car-${c.dir}`}
            style={{ animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }}
          >
            <svg
              className="gg-sky-car"
              viewBox="0 0 26 5"
              shapeRendering="crispEdges"
              style={{
                width: px(26),
                height: px(5),
                ...(c.dir === 'r' ? { right: '100%' } : { left: '100%', transform: 'scaleX(-1)' }),
              }}
            >
              <g className="gg-sky-bob">
                <P d={rect(0, 2, 6, 1)} fill={c.trail} a={0.1} />
                <P d={rect(6, 2, 6, 1)} fill={c.trail} a={0.22} />
                <P d={rect(12, 2, 6, 1)} fill={c.trail} a={0.4} />
                <P d={rect(19, 1, 6, 2) + rect(20, 0, 3, 1)} fill={T.haze} />
                <P d={rect(21, 1, 2, 1)} fill={T.cyan} a={0.6} />
                <P d={rect(18, 2, 1, 1)} fill={c.trail} a={0.9} />
                <P d={rect(25, 1, 1, 2)} fill={T.ink} a={0.8} />
                <P d={rect(19, 3, 6, 1)} fill={c.trail} a={0.25} />
              </g>
            </svg>
          </div>
        </div>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ street */

function buildPuddles() {
  const rnd = mulberry32(808)
  let water = ''
  const glint: Record<string, string> = {}
  for (let i = 0; i < 14; i++) {
    const w = 8 + Math.floor(rnd() * 12)
    const x = Math.floor(rnd() * (W - w))
    const y = 7 + Math.floor(rnd() * 13)
    water += rect(x + 2, y, w - 4, 1) + rect(x, y + 1, w, 1) + rect(x + 2, y + 2, w - 4, 1)
    const n = 1 + Math.floor(rnd() * 2)
    for (let j = 0; j < n; j++) {
      const c = WIN_COLORS[Math.floor(rnd() * 3)]
      const k = `${c}-${rnd() < 0.5 ? 'a' : 'b'}`
      const gw = 2 + Math.floor(rnd() * 3)
      const gx = x + 2 + Math.floor(rnd() * Math.max(1, w - 4 - gw))
      glint[k] = (glint[k] ?? '') + rect(gx, y + 1, gw, 1)
    }
  }
  return { water, glint }
}
const PUDDLES = buildPuddles()

function Street() {
  return (
    <div className="gg-sky-street" style={{ height: 'var(--ground-bottom, 72px)' }}>
      <div className="gg-sky-walk" style={{ top: px(1), height: px(4) }} />
      <div className="gg-sky-gutter" style={{ top: px(5), height: px(1) }} />
      <div className="gg-sky-lane gg-sky-lane-l" style={{ top: px(11), height: px(1) }} />
      <div className="gg-sky-lane gg-sky-lane-r" style={{ top: px(18), height: px(1) }} />
      <svg
        className="gg-sky-abs"
        viewBox={`0 0 ${W} ${STREET_H}`}
        shapeRendering="crispEdges"
        style={{ ...strip(STREET_H), top: 0 }}
      >
        <P d={PUDDLES.water} fill={T.haze} a={0.26} />
        {Object.entries(PUDDLES.glint).map(([k, d]) => {
          const [c, b] = k.split('-') as [WinColor, 'a' | 'b']
          return <P key={k} d={d} fill={T[c]} a={0.4} className={`gg-sky-shim-${b}`} />
        })}
      </svg>
      <div className="gg-sky-curb" style={{ height: px(1) }} />
    </div>
  )
}

/* ------------------------------------------------------------------ root */

export function Skyline() {
  return (
    <div className="gg-sky-root pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      <Stars />
      <SkylineStrip />
      <Cars />
      <BoardMain />
      <SignNeon />
      <BoardChart />
      <Street />
    </div>
  )
}

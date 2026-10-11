// Pixel-art primitives for the city buildings. All numbers are LOGICAL px (stage is integer-scaled).
import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'

interface BlockProps {
  x: number
  y: number
  w: number
  h: number
  c?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

// One absolutely positioned pixel rectangle. Rendered as <span> because buildings live inside a <button>.
export function B({ x, y, w, h, c, className, style, children }: BlockProps) {
  return (
    <span
      className={className ? `gg-bld-b ${className}` : 'gg-bld-b'}
      style={{ left: x, top: y, width: w, height: h, background: c, ...style }}
    >
      {children}
    </span>
  )
}

// Pixel-font text at a tiny logical size. Rendered at 16px and scaled down so a browser minimum
// font size (e.g. 12px in some CJK locales) cannot inflate it. Advance width = 1em per glyph.
export function PixelText({ text, size, className }: { text: string; size: number; className?: string }) {
  return (
    <span className="gg-bld-txt" style={{ width: text.length * size, height: size }}>
      <span className={className ? `font-pixel ${className}` : 'font-pixel'} style={{ transform: `scale(${size / 16})` }}>
        {text}
      </span>
    </span>
  )
}

// Deterministic PRNG (mulberry32) so every reload draws the same city.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Cell {
  x: number
  y: number
  w: number
  alt: boolean
  flicker: boolean
  delay: number
}

// Lit windows as horizontal runs (a lit office floor), plus single flickering windows.
function buildCells(cols: number, rows: number, cw: number, ch: number, seed: number, lit: number, alt: number, flicker: number) {
  const r = rng(seed)
  const out: Cell[] = []
  for (let row = 0; row < rows; row++) {
    let run: Cell | null = null
    let prevLit = false
    for (let col = 0; col < cols; col++) {
      const p: number = prevLit ? Math.min(0.85, lit + 0.3) : lit * 0.7
      prevLit = r() < p
      if (!prevLit) {
        run = null
        continue
      }
      const isAlt = r() < alt
      if (r() < flicker) {
        out.push({ x: col * cw, y: row * ch, w: cw, alt: isAlt, flicker: true, delay: -Math.round(r() * 24) / 10 })
        run = null
        continue
      }
      if (run && run.alt === isAlt) {
        run.w += cw
      } else {
        run = { x: col * cw, y: row * ch, w: cw, alt: isAlt, flicker: false, delay: 0 }
        out.push(run)
      }
    }
  }
  return out
}

// "Terminal glyph" texture: 8-row tile of short 1px bars, repeated down the grid (+8 rows so a
// translateY(-8px) loop is seamless). Drawn as box-shadow pixels on a 1x1 element.
function glyphShadow(w: number, h: number, cw: number, ww: number, seed: number) {
  const r = rng(seed * 31 + 7)
  const tile: boolean[][] = []
  for (let y = 0; y < 8; y++) {
    const row = new Array<boolean>(w).fill(false)
    if (r() > 0.18) {
      let x = Math.floor(r() * 3)
      while (x < w) {
        const len = 1 + Math.floor(r() * 4)
        for (let i = 0; i < len && x + i < w; i++) row[x + i] = true
        x += len + 1 + Math.floor(r() * 3)
      }
    }
    tile.push(row)
  }
  // each window column gets its own vertical phase so the period-8 tile does not read as a grid
  const phase = Array.from({ length: Math.ceil(w / cw) }, () => Math.floor(r() * 8))
  const px: string[] = []
  for (let y = 0; y < h + 8; y++) {
    for (let x = 0; x < w; x++) {
      if (x % cw >= ww || (x === 0 && y === 0)) continue
      if (!tile[(y + phase[Math.floor(x / cw)]) % 8][x]) continue
      px.push(`${x}px ${y}px 0 0 var(--gg-bld-glyph)`)
    }
  }
  return px.join(',')
}

interface WindowGridProps {
  x: number
  y: number
  cols: number
  rows: number
  cw?: number // cell width (window + gap)
  ch?: number // cell height
  ww?: number // window width
  wh?: number // window height
  seed: number
  lit?: number // 0..1 share of lit windows
  alt?: number // 0..1 share of lit windows in the alt (pink) color
  flicker?: number // 0..1 share of lit windows that flicker when idle
}

// Window grid. Two nested masks cut the layers into windows; state colors come from CSS vars on .gg-bld.
export function WindowGrid({ x, y, cols, rows, cw = 4, ch = 4, ww = 2, wh = 2, seed, lit = 0.45, alt = 0.15, flicker = 0.3 }: WindowGridProps) {
  const w = cols * cw
  const h = rows * ch
  const cells = useMemo(() => buildCells(cols, rows, cw, ch, seed, lit, alt, flicker), [cols, rows, cw, ch, seed, lit, alt, flicker])
  const glyphs = useMemo(() => glyphShadow(w, h, cw, ww, seed), [w, h, cw, ww, seed])
  const style = {
    left: x,
    top: y,
    width: w,
    height: h,
    '--gg-bld-cw': `${cw}px`,
    '--gg-bld-ch': `${ch}px`,
    '--gg-bld-ww': `${ww}px`,
    '--gg-bld-wh': `${wh}px`,
  } as CSSProperties
  return (
    <span className="gg-bld-win" style={style}>
      <span className="gg-bld-win-rows">
        {cells.map((c) => (
          <span
            key={`${c.x}-${c.y}`}
            className={`gg-bld-w${c.alt ? ' gg-bld-w--alt' : ''}${c.flicker ? ' gg-bld-w--flk' : ''}`}
            style={{ left: c.x, top: c.y, width: c.w, height: ch, animationDelay: c.flicker ? `${c.delay}s` : undefined }}
          />
        ))}
        <span className="gg-bld-glyphs">
          <span className="gg-bld-glyph-px" style={{ boxShadow: glyphs }} />
        </span>
        <span className="gg-bld-tint" />
      </span>
    </span>
  )
}

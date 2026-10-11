// Hand-drawn 8×8 pixel icons for the build menu. Each lit pixel is one box-shadow (3px), built once at module load.
// A = the tile accent (CSS var --bm-accent), W = ink. Pixel (0,0) must stay empty: an outer box-shadow at 0,0 is clipped.
import type { CSSProperties } from 'react'

export type IconName = 'codex' | 'cursor' | 'claude' | 'deepseek' | 'groq' | 'bot' | 'trading'

const MAPS: Record<IconName, string[]> = {
  // tall tower with antenna and windows
  codex: ['...AA...', '...AA...', '..AAAA..', '..AWWA..', '..AAAA..', '.AWAAWA.', '.AAAAAA.', 'AAAAAAAA'],
  // editor window with a pointer inside
  cursor: ['.AAAAAA.', 'AWWWWWWA', 'A.A....A', 'A.AA...A', 'A.AAA..A', 'A.A.A..A', 'A....A.A', 'AAAAAAAA'],
  // chunky spark
  claude: ['...AA...', '.A.AA.A.', '..AAAA..', 'AAAWWAAA', 'AAAWWAAA', '..AAAA..', '.A.AA.A.', '...AA...'],
  // factory with two smoking chimneys
  deepseek: ['.W....W.', '.A....A.', '.AA.A.AA', 'AAAAAAAA', 'AAAAAAAA', 'AWWAAWWA', 'AAAAAAAA', 'AAAAAAAA'],
  // low hall ringed by a speed rail, chevrons pointing into the intake
  groq: ['........', '.AA.AA.A', 'AAAAAAAA', '.AWAAWA.', '.AAAAAA.', '.AWAAWA.', '.AAAAAA.', 'A.AAAA.A'],
  // robot head
  bot: ['...WW...', '...AA...', '.AAAAAA.', 'AAWAAWAA', 'AAAAAAAA', 'AAWWWWAA', '.AAAAAA.', '.A....A.'],
  // rising bars + arrow
  trading: ['.....WWW', '......WW', '.....W.W', '....W...', '...W..AA', 'AA....AA', 'AA.AA.AA', 'AA.AA.AA'],
}

const PX = 3

const SHADOWS = Object.fromEntries(
  Object.entries(MAPS).map(([name, rows]) => [
    name,
    rows
      .flatMap((row, y) =>
        [...row].flatMap((ch, x) =>
          ch === '.' ? [] : [`${x * PX}px ${y * PX}px 0 0 ${ch === 'W' ? 'var(--gg-ink)' : 'var(--bm-accent)'}`],
        ),
      )
      .join(', '),
  ]),
) as Record<IconName, string>

export function PixelIcon({ name, color }: { name: IconName; color: string }) {
  return (
    <span aria-hidden className="relative block size-6 shrink-0" style={{ '--bm-accent': color } as CSSProperties}>
      <span className="absolute top-0 left-0 block size-[3px]" style={{ boxShadow: SHADOWS[name] }} />
    </span>
  )
}

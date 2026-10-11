// Result mode: the task result card shown after the demo flow completes.
import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { TaskResult } from '@/types'
import { SectionTitle } from './parts'

const CHANGE = {
  added: { mark: '+', color: 'var(--gg-green)', label: 'ADDED' },
  modified: { mark: '~', color: 'var(--gg-cyan)', label: 'MODIFIED' },
  deleted: { mark: '−', color: 'var(--gg-red)', label: 'DELETED' },
} as const

export function ResultView({ command, result }: { command: string; result: TaskResult }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <DataCube />
        <div className="flex flex-col gap-2">
          <h2
            className="font-pixel text-[12px] leading-none text-gg-green"
            style={{ textShadow: '0 0 6px rgba(57, 255, 20, 0.45)' }}
          >
            TASK COMPLETE
          </h2>
          <p className="font-pixel text-[8px] leading-none text-gg-mute">ROUTER · CODEX · SECURITY</p>
        </div>
      </header>

      <section>
        <SectionTitle>COMMAND</SectionTitle>
        <div className="border-2 border-gg-haze bg-gg-void px-3 py-2 text-[18px] leading-[20px] break-words">
          <span className="text-gg-pink">&gt; </span>
          <span className="text-gg-cyan">{command}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[24px] leading-[24px] text-gg-ink">{result.title}</h3>
        <p className="text-[18px] leading-[20px] text-gg-mute">{result.summary}</p>
      </section>

      {result.files.length > 0 && (
        <section>
          <SectionTitle right={<span className="font-pixel text-[8px] leading-none text-gg-mute">{result.files.length}</span>}>
            FILES CHANGED
          </SectionTitle>
          <ul className="flex flex-col border-2 border-gg-haze bg-gg-void px-3 py-1">
            {result.files.map((f) => {
              const c = CHANGE[f.change]
              return (
                <li key={f.path} className="flex items-baseline gap-3 py-[2px] text-[18px] leading-[20px]" title={c.label}>
                  <span className="w-3 shrink-0 text-center" style={{ color: c.color }}>
                    {c.mark}
                  </span>
                  <span className="min-w-0 flex-1 break-all text-gg-ink">{f.path}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle>STATS</SectionTitle>
        <div className="grid grid-cols-3 border-2 border-gg-haze bg-gg-void">
          <Stat label="TOKENS" value={result.tokens} format={(v) => Math.round(v).toLocaleString('en-US')} />
          <Stat label="LATENCY" value={result.latencyMs / 1000} format={(v) => `${v.toFixed(1)}s`} border />
          <Stat label="COST" value={result.costUsd} format={(v) => `$${v.toFixed(v < 1 ? 3 : 2)}`} border />
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, format, border }: { label: string; value: number; format: (v: number) => string; border?: boolean }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (reduce) return
    const controls = animate(0, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], onUpdate: setShown })
    return () => controls.stop()
  }, [value, reduce])
  return (
    <div className={`flex flex-col gap-2 px-3 py-3 ${border ? 'border-l-2 border-gg-haze' : ''}`}>
      <span className="font-pixel text-[8px] leading-none text-gg-mute">{label}</span>
      <span className="text-[24px] leading-none text-gg-ink tabular-nums">{format(reduce ? value : shown)}</span>
    </div>
  )
}

// 12×12 isometric pixel cube. T = top face, L = left face, R = right face, D = data bit.
const CUBE = [
  '....TTTT....',
  '..TTTTTTTT..',
  'TTTTTTTTTTTT',
  'LLTTTTTTTTRR',
  'LLLLTTTTRRRR',
  'LLLLLLRRRRRR',
  'LDLDLLRRRRRR',
  'LLLLLLRRDRRR',
  'LDLLLLRRRRRR',
  'LLLLLLRRRDRR',
  '..LLLLRRRR..',
  '....LLRR....',
]

const CUBE_FILL: Record<string, string> = {
  T: 'var(--gg-green)',
  L: 'rgba(57, 255, 20, 0.55)',
  R: 'rgba(57, 255, 20, 0.3)',
  D: 'var(--gg-void)',
}

function DataCube() {
  return (
    <div className="relative size-12 shrink-0 border-2 border-gg-haze bg-gg-void" aria-hidden>
      <svg
        viewBox="0 0 12 12"
        width={24}
        height={24}
        shapeRendering="crispEdges"
        className="gg-sp-cube absolute top-1/2 left-1/2 -mt-3 -ml-3"
      >
        {CUBE.flatMap((row, y) =>
          [...row].map((ch, x) =>
            ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={CUBE_FILL[ch]} />,
          ),
        )}
      </svg>
      <span className="gg-sp-spark absolute top-1 left-1 size-1 bg-gg-green" />
      <span className="gg-sp-spark gg-sp-spark-2 absolute top-2 right-1 size-1 bg-gg-cyan" />
      <span className="gg-sp-spark gg-sp-spark-3 bottom-1 left-2 absolute size-1 bg-gg-green" />
    </div>
  )
}

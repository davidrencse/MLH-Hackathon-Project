// The session menu inside an office: pick where the work runs, then open a desk.
// Two groups: LOCAL (this machine, no key needed) and CONNECTED (ChatGPT / Claude / DeepSeek / Groq,
// which need a provider key — the tile says so and links to the keys page).
import { KeyRound, Play } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEFAULT_RUNTIME, RUNTIMES, RUNTIME_ORDER } from '@/constants'
import { useGrid } from '@/store/grid'
import { resolveKeyForProvider, useKeys } from '@/store/keys'
import type { Building, RuntimeId, SessionMode } from '@/types'

const MODE_LABEL: Record<SessionMode, string> = { local: 'ON THIS MACHINE', connected: 'CONNECTED PROVIDER' }

export function SessionMenu({ building }: { building: Building }) {
  const keys = useKeys((s) => s.keys)
  const [runtime, setRuntime] = useState<RuntimeId>(DEFAULT_RUNTIME[building.type] ?? 'local-cli')
  const [model, setModel] = useState(() => {
    const models = RUNTIMES[DEFAULT_RUNTIME[building.type] ?? 'local-cli'].models
    return models.includes(building.model) ? building.model : models[0]
  })
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const titleId = useId()
  const modelId = useId()

  const rt = RUNTIMES[runtime]
  // A connected runtime is only usable once a key for its provider exists.
  const hasKey = useMemo(
    () => (rt.provider ? resolveKeyForProvider({ keys }, rt.provider) !== null : true),
    [keys, rt.provider],
  )
  const blocked = rt.mode === 'connected' && !hasKey

  const pick = (id: RuntimeId) => {
    setRuntime(id)
    setModel(RUNTIMES[id].models[0])
  }

  const start = async () => {
    if (blocked || starting) return
    setStarting(true)
    try {
      await useGrid.getState().startSession(building.id, { title: title || `${rt.short} session`, runtime, model })
      setTitle('')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {(['local', 'connected'] as SessionMode[]).map((mode) => (
        <section key={mode}>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block size-2 shrink-0 bg-gg-pink" />
            <h4 className="font-pixel shrink-0 text-[8px] leading-none text-gg-mute">{MODE_LABEL[mode]}</h4>
            <span className="h-[2px] flex-1 bg-gg-haze" />
          </div>
          <ul className="flex flex-col gap-2">
            {RUNTIME_ORDER[mode].map((id) => {
              const entry = RUNTIMES[id]
              const on = runtime === id
              const needsKey = entry.provider !== null && resolveKeyForProvider({ keys }, entry.provider) === null
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(id)}
                    title={entry.hint}
                    className="gg-of-rt flex w-full flex-col gap-1 border-2 border-gg-haze bg-gg-void px-2 py-2 text-left hover:border-gg-ink"
                    style={{ '--gg-of-tone': entry.accent, '--gg-of-glow': `color-mix(in srgb, ${entry.accent} 45%, transparent)` } as React.CSSProperties}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-pixel text-[8px] leading-none" style={{ color: on ? entry.accent : 'var(--gg-ink)' }}>
                        {entry.label.toUpperCase()}
                      </span>
                      {needsKey ? (
                        <span className="font-pixel shrink-0 border-2 border-gg-yellow px-1 py-[2px] text-[8px] leading-none text-gg-yellow">
                          NO KEY
                        </span>
                      ) : (
                        <span className="font-pixel shrink-0 text-[8px] leading-none text-gg-mute">
                          {entry.mode === 'local' ? 'FREE' : 'BILLED'}
                        </span>
                      )}
                    </span>
                    <span className="text-[16px] leading-[18px] text-gg-mute">{entry.host}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {/* What the desk will work on */}
      <div className="flex flex-col gap-1">
        <label htmlFor={titleId} className="font-pixel text-[8px] leading-[12px] text-gg-mute">
          TASK
        </label>
        <input
          id={titleId}
          value={title}
          maxLength={64}
          placeholder="Fix failing auth test"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void start()
          }}
          className="gg-of-input h-10 w-full border-2 border-gg-haze bg-gg-void px-2 text-[18px] text-gg-ink placeholder:text-gg-mute/70 hover:border-gg-cyan"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={modelId} className="font-pixel text-[8px] leading-[12px] text-gg-mute">
          MODEL
        </label>
        <select
          id={modelId}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="gg-of-select h-10 w-full cursor-pointer truncate border-2 border-gg-haze bg-gg-void px-2 text-[18px] text-gg-ink hover:border-gg-cyan"
        >
          {rt.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {blocked ? (
        <Link
          to="/dashboard/keys"
          className="gg-of-btn font-pixel flex h-10 items-center justify-center gap-2 border-2 border-gg-yellow bg-gg-void px-3 text-[8px] leading-none text-gg-yellow uppercase hover:bg-gg-yellow hover:text-gg-void"
        >
          <KeyRound size={16} strokeWidth={2.5} />
          Add a {rt.label.split(' · ')[0]} key
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="gg-of-btn font-pixel flex h-10 items-center justify-center gap-2 border-2 border-gg-green bg-gg-green px-3 text-[8px] leading-none text-gg-void uppercase hover:bg-gg-void hover:text-gg-green"
        >
          <Play size={16} strokeWidth={2.5} />
          {starting ? 'Opening desk…' : `Start on ${rt.short}`}
        </button>
      )}

      <p className="text-[16px] leading-[18px] text-gg-mute">{rt.hint}</p>
    </div>
  )
}

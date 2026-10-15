// Building mode: header (rename for player builds), sessions or bot config, last 5 logs, agent config, demolish.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, DoorOpen, KeyRound, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StatusBadge } from '@/components/StatusBadge'
import { CATALOG, DEFAULT_BUILDINGS, PROVIDERS, STATUS_COLOR, botLabel, hasOfficePage } from '@/constants'
import { useBuildingLogs, useGrid } from '@/store/grid'
import { maskKey, resolveBuildingKey, useIsOffline, useKeys } from '@/store/keys'
import { useBuildingUsage } from '@/store/usageLedger'
import type { Building, BuildingId, BuildingStatus, BuildingType, LogLevel } from '@/types'
import { AgentAskSection } from './AgentAskSection'
import { BotSection } from './BotSection'
import { LibrarySection } from './LibrarySection'
import { WallStreetSection } from './WallStreetSection'
import { BTN } from './buttons'
import { BlurField, Field, SectionTitle } from './parts'
import { SessionsSection } from './SessionsSection'

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'var(--gg-ink)',
  ok: 'var(--gg-green)',
  warn: 'var(--gg-yellow)',
  error: 'var(--gg-red)',
}

const LEVEL_TAG: Record<LogLevel, string> = { info: 'INF', ok: 'OK ', warn: 'WRN', error: 'ERR' }

const SESSION_TYPES: BuildingType[] = ['codex', 'cursor', 'claude', 'deepseek', 'groq']

const pad = (v: number) => String(v).padStart(2, '0')
const hms = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// The building object comes from SidePanel (useGrid selector). Keeping it as a prop lets the panel
// finish its exit animation after a demolish without reading a deleted building.
export function BuildingView({ building }: { building: Building }) {
  const navigate = useNavigate()
  const { id, type } = building
  const offline = useIsOffline(id)
  const badge: BuildingStatus | 'offline' = offline && building.status === 'idle' ? 'offline' : building.status
  const playerBuilt = !DEFAULT_BUILDINGS.some((d) => d.id === id) && type !== 'quant' && type !== 'agent'
  const accent = building.bot?.color || building.repo?.accent || CATALOG[type].accent

  return (
    <div className="flex flex-col gap-6">
      <Header building={building} badge={badge} accent={accent} playerBuilt={playerBuilt} />
      {type === 'security' && (
        <button type="button" onClick={() => useGrid.getState().openOffice(id)} className={`${BTN.cyan} w-full justify-between`}>
          <span className="flex items-center gap-2"><DoorOpen size={16} strokeWidth={2.5} />Enter security office</span>
          <span>All sessions</span>
        </button>
      )}
      {SESSION_TYPES.includes(type) && (
        <>
          <button
            type="button"
            onClick={() => hasOfficePage(type) ? navigate(`/office/${encodeURIComponent(id)}`) : useGrid.getState().openOffice(id)}
            className={`${BTN.cyan} w-full justify-between`}
          >
            <span className="flex items-center gap-2">
              <DoorOpen size={16} strokeWidth={2.5} />
              Enter office
            </span>
            <span>{building.sessions.length} desks</span>
          </button>
          <SessionsSection sessions={building.sessions} />
        </>
      )}
      {type === 'agent' && <AgentAskSection building={building} />}
      {type === 'bot' && building.bot && <BotSection id={id} bot={building.bot} />}
      {type === 'library' && <LibrarySection />}
      {type === 'quant' && building.repo && <WallStreetSection repo={building.repo} />}
      <Logs id={id} working={building.status === 'working'} />
      <Usage id={id} />
      <AgentConfig id={id} type={type} fallbackModel={building.model} />
      {playerBuilt && <Demolish building={building} />}
    </div>
  )
}

// ---- Usage: what this building really spent, from the city's one usage ledger ----

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

/**
 * A building's own recorded usage. The ledger attributes API usage through the backend agent
 * that carries this building id, and a local CLI's transcripts through the building that runs
 * it — so Codex Tower shows what Codex CLI actually spent, and an Agent Row house shows its own
 * traffic once it has run anything.
 *
 * Nothing recorded yet is said plainly rather than shown as a zero, because the two read the same
 * on a tile and mean different things.
 */
function Usage({ id }: { id: BuildingId }) {
  const usage = useBuildingUsage(id)
  if (!usage) return null
  const cli = usage.kinds.includes('cli')
  return (
    <section>
      <SectionTitle right={<span className="font-pixel text-[8px] leading-none text-gg-mute">{cli ? 'CLI' : 'API'}</span>}>
        USAGE
      </SectionTitle>
      <div className="grid grid-cols-2 border-2 border-gg-haze bg-gg-void">
        <div className="flex flex-col gap-1 px-3 py-2">
          <span className="font-pixel text-[8px] leading-none text-gg-mute">TOKENS</span>
          <span className="text-[20px] leading-none text-gg-ink tabular-nums">{fmtTok(usage.tokens)}</span>
        </div>
        <div className="flex flex-col gap-1 border-l-2 border-gg-haze px-3 py-2">
          <span className="font-pixel text-[8px] leading-none text-gg-mute">REQUESTS</span>
          <span className="text-[20px] leading-none text-gg-ink tabular-nums">{usage.requests}</span>
        </div>
      </div>
      <p className="mt-2 text-[16px] leading-5 text-gg-mute">
        {usage.sources.join(' · ')}
        {usage.untokenedRequests ? ` · ${usage.untokenedRequests} without token counts` : ''}
        {cli ? ' · subscription, not metered' : ''}
      </p>
    </section>
  )
}

// ---- Header: thumb, name (inline rename for player builds), accent + type, status, role ----

function Header({
  building,
  badge,
  accent,
  playerBuilt,
}: {
  building: Building
  badge: BuildingStatus | 'offline'
  accent: string
  playerBuilt: boolean
}) {
  const [editing, setEditing] = useState(false)
  const typeLabel = (building.bot && botLabel(building.bot)) || CATALOG[building.type].label

  return (
    <header className="flex gap-4">
      <Thumb type={building.type} status={badge} accent={accent} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {editing ? (
          <BlurField
            autoFocus
            value={building.name}
            maxLength={24}
            ariaLabel="Building name"
            onCommit={(v) => v && useGrid.getState().renameBuilding(building.id, v)}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="flex items-start gap-2">
            <h2 className="font-pixel min-w-0 flex-1 text-[12px] leading-[16px] break-words text-gg-ink">{building.name}</h2>
            {playerBuilt && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Rename building"
                title="Rename"
                className="gg-sp-btn flex size-8 shrink-0 items-center justify-center border-2 border-gg-haze bg-gg-void text-gg-mute hover:border-gg-cyan hover:text-gg-cyan"
              >
                <Pencil size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-3 shrink-0"
            style={{ background: accent, boxShadow: `0 0 6px 0 color-mix(in srgb, ${accent} 60%, transparent)` }}
          />
          <span className="font-pixel text-[8px] leading-[12px]" style={{ color: accent }}>
            {typeLabel.toUpperCase()}
          </span>
        </div>
        <div>
          <StatusBadge status={badge} />
        </div>
        <p className="text-[18px] leading-[20px] text-gg-mute">{building.role}</p>
      </div>
    </header>
  )
}

// ---- Tiny CSS pixel building, windows lit in the status color, frame in the accent color ----

const THUMB: Record<BuildingType, { cols: number; rows: number; antenna: boolean }> = {
  quant: { cols: 4, rows: 6, antenna: true },
  agent: { cols: 3, rows: 2, antenna: true },
  codex: { cols: 4, rows: 4, antenna: false },
  cursor: { cols: 3, rows: 5, antenna: false },
  claude: { cols: 4, rows: 5, antenna: true },
  deepseek: { cols: 5, rows: 3, antenna: false },
  groq: { cols: 5, rows: 2, antenna: false },
  security: { cols: 6, rows: 3, antenna: false },
  bot: { cols: 2, rows: 3, antenna: true },
  library: { cols: 5, rows: 5, antenna: true },
}

function Thumb({ type, status, accent }: { type: BuildingType; status: BuildingStatus | 'offline'; accent: string }) {
  const { cols, rows, antenna } = THUMB[type]
  const color = STATUS_COLOR[status]
  const lit = (i: number) => (i * 7 + type.length) % 5 !== 0
  return (
    <div
      className="pixelated relative flex size-16 shrink-0 items-end justify-center border-2 bg-gg-void pb-1"
      style={{ borderColor: accent }}
      aria-hidden
    >
      <div className="flex flex-col items-center">
        {antenna && (
          <>
            <span className="block size-1" style={{ background: accent }} />
            <span className="block h-1 w-1 bg-gg-haze" />
          </>
        )}
        <div
          className="grid gap-1 border-2 border-gg-haze bg-gg-dusk p-1"
          style={{ gridTemplateColumns: `repeat(${cols}, 4px)` }}
        >
          {Array.from({ length: cols * rows }, (_, i) => (
            <span
              key={i}
              className={lit(i) ? 'gg-sp-win block size-1' : 'block size-1'}
              style={{
                background: lit(i) ? color : 'var(--gg-night)',
                animationDelay: `${(i % 4) * 0.3}s`,
              }}
            />
          ))}
        </div>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-1 bg-gg-haze" />
    </div>
  )
}

// ---- Last 5 logs ----

function Logs({ id, working }: { id: BuildingId; working: boolean }) {
  const logs = useBuildingLogs(id, 5)
  const reduce = useReducedMotion()
  return (
    <section>
      <SectionTitle
        right={
          working ? (
            <span className="font-pixel flex items-center gap-1 text-[8px] leading-none text-gg-green">
              <span className="gg-sp-live inline-block size-2 bg-gg-green" />
              LIVE
            </span>
          ) : null
        }
      >
        LAST 5 LOGS
      </SectionTitle>
      <div className="border-2 border-gg-haze bg-gg-void px-2 py-1">
        {logs.length === 0 ? (
          <p className="py-1 text-[18px] text-gg-mute">
            no activity yet<span className="gg-sp-cursor">_</span>
          </p>
        ) : (
          <ul className="flex flex-col">
            <AnimatePresence initial={false}>
              {logs.map((l) => (
                <motion.li
                  key={l.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, x: 12, backgroundColor: 'rgba(0, 240, 255, 0.18)' }}
                  animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(0, 240, 255, 0)' }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1], backgroundColor: { duration: 0.8 } }}
                  className="flex items-baseline gap-2 py-[2px] text-[18px] leading-[20px]"
                >
                  <span className="shrink-0 text-gg-mute tabular-nums">{hms(l.ts)}</span>
                  <span className="shrink-0 whitespace-pre" style={{ color: LEVEL_COLOR[l.level] }}>
                    {LEVEL_TAG[l.level]}
                  </span>
                  <span className="min-w-0 break-words" style={{ color: LEVEL_COLOR[l.level] }}>
                    {l.text}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  )
}

// ---- Agent config: which provider key + model this building uses ----

function AgentConfig({ id, type, fallbackModel }: { id: BuildingId; type: BuildingType; fallbackModel: string }) {
  const keys = useKeys((s) => s.keys)
  // Player-built buildings have no stored config yet: fall back to the building's default model.
  const model = useKeys((s) => s.buildingConfig[id]?.model) || fallbackModel
  const effectiveKey = useKeys((s) => resolveBuildingKey(s, id))
  const [savedAt, setSavedAt] = useState(0)
  const keyFieldId = useId()
  const modelFieldId = useId()

  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(0), 1400)
    return () => clearTimeout(t)
  }, [savedAt])

  if (keys.length === 0) {
    return (
      <section>
        <SectionTitle>AGENT CONFIG</SectionTitle>
        <div className="flex flex-col gap-3 border-2 border-gg-yellow bg-gg-void p-3" style={{ boxShadow: '0 0 8px 0 rgba(255, 212, 0, 0.25)' }}>
          <div className="flex items-center gap-2 text-gg-yellow">
            <TriangleAlert size={16} strokeWidth={2.5} className="shrink-0" />
            <span className="font-pixel text-[10px] leading-none">Add an API key first</span>
          </div>
          <p className="text-[18px] leading-[20px] text-gg-mute">
            This agent has no provider key, so it stays offline. Keys are stored only in this browser.
          </p>
          <Link to="/dashboard/keys" className={`${BTN.yellow} self-start`}>
            <KeyRound size={16} strokeWidth={2.5} />
            Add API key
          </Link>
        </div>
      </section>
    )
  }

  const provider = effectiveKey?.provider ?? 'custom'
  const providerModels = PROVIDERS[provider].models
  const catalogModel = CATALOG[type].model
  // Options: the key's provider models + this building type's default model (+ the current one if it is neither).
  const models = [...new Set([...providerModels, catalogModel, model].filter(Boolean))]

  const onKeyChange = (keyId: string) => {
    const next = keys.find((k) => k.id === keyId)
    if (!next) return
    const nextModels = PROVIDERS[next.provider].models
    // Switching provider: keep the model only if the new provider offers it (or it is the type default).
    const keep = nextModels.includes(model) || model === catalogModel
    useKeys.getState().setBuildingConfig(id, { keyId, model: keep ? model : nextModels[0] })
    setSavedAt(Date.now())
  }

  const onModelChange = (m: string) => {
    useKeys.getState().setBuildingConfig(id, { model: m })
    setSavedAt(Date.now())
  }

  return (
    <section>
      <SectionTitle
        right={
          savedAt ? (
            <span key={savedAt} className="gg-sp-saved font-pixel text-[8px] leading-none text-gg-green">
              SAVED
            </span>
          ) : null
        }
      >
        AGENT CONFIG
      </SectionTitle>
      <div className="flex flex-col gap-3">
        <Field label="API KEY" htmlFor={keyFieldId}>
          <PixelSelect id={keyFieldId} value={effectiveKey?.id ?? ''} onChange={onKeyChange}>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {`${k.name} · ${PROVIDERS[k.provider].label} · ${maskKey(k.key)}`}
              </option>
            ))}
          </PixelSelect>
        </Field>
        <Field label="MODEL" htmlFor={modelFieldId}>
          <PixelSelect id={modelFieldId} value={model} onChange={onModelChange}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
                {providerModels.includes(m) ? '' : m === catalogModel ? ' (default)' : ' (current)'}
              </option>
            ))}
          </PixelSelect>
        </Field>
      </div>
    </section>
  )
}

function PixelSelect({
  id,
  value,
  onChange,
  children,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="gg-sp-select h-10 w-full cursor-pointer truncate border-2 border-gg-haze bg-gg-void pr-9 pl-2 text-[18px] text-gg-ink hover:border-gg-cyan"
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2.5}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gg-cyan"
      />
    </div>
  )
}

// ---- Demolish (player-built only): two-step confirm, 50% refund ----

function Demolish({ building }: { building: Building }) {
  const [confirming, setConfirming] = useState(false)
  const refund = Math.floor(CATALOG[building.type].cost / 2)

  const demolish = () => {
    const s = useGrid.getState()
    s.removeBuilding(building.id) // also closes the panel (selected → null)
    s.pushLog('security', 'warn', `demolished ${building.name} on lot ${building.lot} · +${refund} BP refund`)
  }

  return (
    <section>
      <SectionTitle>PLAYER BUILDING</SectionTitle>
      {confirming ? (
        <div className="flex flex-col gap-3 border-2 border-gg-red bg-gg-void p-3" style={{ boxShadow: '0 0 8px 0 rgba(255, 51, 85, 0.25)' }}>
          <p className="text-[18px] leading-[20px] text-gg-ink">
            Demolish {building.name}? Lot {building.lot} becomes free. You get{' '}
            <span className="text-gg-green">+{refund} BP</span> (+50% refund).
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={demolish} className={`${BTN.red} flex-1`}>
              <Trash2 size={16} strokeWidth={2.5} />
              Confirm
            </button>
            <button type="button" autoFocus onClick={() => setConfirming(false)} className={`${BTN.ghost} flex-1`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${BTN.redOutline} w-full justify-between`}>
          <span className="flex items-center gap-2">
            <Trash2 size={16} strokeWidth={2.5} />
            Demolish
          </span>
          <span>+50% refund · +{refund} BP</span>
        </button>
      )}
    </section>
  )
}

// BOT: config of a bot building, placed with the NEW BOT dialog. Stored only; nothing is sent
// until the backend grows a bot runner.
import { useId } from 'react'
import { BOT_KINDS, botLabel } from '@/constants'
import { useGrid } from '@/store/grid'
import type { BotConfig, BuildingId } from '@/types'
import { BlurField, Field, SectionTitle } from './parts'

const SWATCHES = ['#ff2bd6', '#00f0ff', '#39ff14', '#ffd400', '#ff3355']

export function BotSection({ id, bot }: { id: BuildingId; bot: BotConfig }) {
  // Defensive: bots are created by the build menu in parallel; never crash the panel on a partial config.
  const kind = BOT_KINDS[bot.kind] ?? BOT_KINDS.custom
  const endpoint = bot.endpoint ?? ''
  const color = (bot.color ?? '').toLowerCase()
  const endpointId = useId()
  const scheduleId = useId()
  const notesId = useId()
  const update = (patch: Partial<BotConfig>) => useGrid.getState().updateBot(id, patch)
  const hasEndpoint = endpoint.trim() !== ''
  const line = hasEndpoint ? 'var(--gg-cyan)' : 'var(--gg-yellow)'

  return (
    <section>
      <SectionTitle
        right={
          <span className="font-pixel text-[8px] leading-none" style={{ color: kind.color }}>
            {botLabel(bot).toUpperCase()}
          </span>
        }
      >
        BOT
      </SectionTitle>
      <div className="flex flex-col gap-3">
        <p className="text-[18px] leading-[20px] text-gg-mute">{kind.description}</p>


        <Field label="ENDPOINT URL" htmlFor={endpointId}>
          <BlurField
            id={endpointId}
            type="url"
            value={endpoint}
            placeholder="https://your-backend/bot"
            onCommit={(endpoint) => update({ endpoint })}
          />
        </Field>

        <div
          className="flex items-start gap-2 border-2 px-2 py-2"
          style={{ borderColor: line, color: line, background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
          role="status"
        >
          <span className={`mt-[2px] inline-block size-2 shrink-0 ${hasEndpoint ? '' : 'gg-sp-live'}`} style={{ background: line }} />
          <span className="font-pixel text-[8px] leading-[12px]">
            {hasEndpoint ? 'ENDPOINT SET · not connected (backend pending)' : 'WAITING FOR BACKEND'}
          </span>
        </div>

        <Field label="SCHEDULE" htmlFor={scheduleId}>
          <BlurField id={scheduleId} value={bot.schedule ?? ''} placeholder="every 5m" onCommit={(schedule) => update({ schedule })} />
        </Field>

        <Field label="NOTES" htmlFor={notesId}>
          <BlurField
            id={notesId}
            multiline
            value={bot.notes ?? ''}
            placeholder="What should this bot do?"
            onCommit={(notes) => update({ notes })}
          />
        </Field>

        <div className="flex flex-col gap-1">
          <span className="font-pixel text-[8px] leading-[12px] text-gg-mute">COLOR</span>
          <div role="radiogroup" aria-label="Bot color" className="flex gap-3">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Color ${c}`}
                onClick={() => update({ color: c })}
                className="gg-sp-swatch size-6 border-2 border-gg-void"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {bot.kind === 'trading' && <TradingStatus />}
      </div>
    </section>
  )
}

/**
 * A trading bot's panel used to show a PnL sparkline, BUY/HOLD/SELL signals and an open-position
 * count, all generated from a hash of the building id. It was labelled PAPER / MOCK, and it was
 * still a chart of numbers nobody had measured, in the same panel as the bot's real
 * configuration. There is no bot runner behind this yet, so the panel says that instead.
 */
function TradingStatus() {
  return (
    <div className="flex flex-col gap-2 border-2 border-dashed border-gg-haze bg-gg-void p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-pixel text-[8px] leading-none text-gg-mute">TRADING</span>
        <span className="font-pixel border-2 border-gg-grey px-1 py-[3px] text-[8px] leading-none text-gg-grey">NOT RUNNING</span>
      </div>
      <p className="text-[18px] leading-[20px] text-gg-mute">
        No trades, no positions, no PnL: this bot's schedule is stored here, and the backend has
        no bot runner to execute it. Nothing is reported until it does.
      </p>
    </div>
  )
}

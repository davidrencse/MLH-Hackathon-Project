// Agent Row houses (Grok, Dots, Muse) are the player's own assistants, so the panel lets you
// actually talk to one. The reply streams through the same tasks API every other building uses,
// which is the point: the backend records usage against this house's agent, so what a personal
// agent spends lands in the city's usage ledger (CREDITS) like any other agent's work.
import { Send, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useGrid } from '@/store/grid'
import { useBuildingUsage } from '@/store/usageLedger'
import type { Building } from '@/types'
import { BTN } from './buttons'
import { SectionTitle } from './parts'

/** Modest ceiling: a house reply is a chat answer, not a coding session. */
const PARAMS = { temperature: 0.7, maxTokens: 1024 }

export function AgentAskSection({ building }: { building: Building }) {
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const usage = useBuildingUsage(building.id)

  // A reply still streaming when the panel closes would write into a dead component.
  useEffect(() => () => abort.current?.abort(), [])

  const ask = async () => {
    const text = prompt.trim()
    if (!text || running) return
    const ctrl = new AbortController()
    abort.current = ctrl
    setRunning(true)
    setReply('')
    setError(null)
    try {
      await useGrid.getState().runPlayground(building.id, text, PARAMS, (chunk) => setReply((r) => r + chunk), ctrl.signal)
      setPrompt('')
    } catch (e) {
      setError(ctrl.signal.aborted ? 'Stopped.' : e instanceof Error ? e.message : 'The request failed.')
    } finally {
      abort.current = null
      setRunning(false)
    }
  }

  return (
    <section>
      <SectionTitle
        right={
          <span className="font-pixel text-[8px] leading-none text-gg-mute">
            {usage ? `${usage.requests} ASKED` : 'NEW'}
          </span>
        }
      >
        ASK {building.short}
      </SectionTitle>
      <textarea
        value={prompt}
        rows={2}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. Esc must not reach SidePanel's close handler.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void ask()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        placeholder={`Ask ${building.name}…`}
        aria-label={`Ask ${building.name}`}
        spellCheck={false}
        className="gg-sp-input min-h-16 w-full resize-y border-2 border-gg-haze bg-gg-void px-2 py-1 text-[18px] leading-[20px] text-gg-ink placeholder:text-gg-mute/70 hover:border-gg-cyan"
      />
      <div className="mt-2 flex items-center gap-2">
        {running ? (
          <button type="button" onClick={() => abort.current?.abort()} className={`${BTN.redOutline} flex-1`}>
            <Square size={16} strokeWidth={2.5} />
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => void ask()} disabled={!prompt.trim()} className={`${BTN.cyan} flex-1 disabled:opacity-40`}>
            <Send size={16} strokeWidth={2.5} />
            Send
          </button>
        )}
      </div>
      {(reply || running || error) && (
        <div className="mt-3 max-h-48 overflow-y-auto border-2 border-gg-haze bg-gg-void px-2 py-2 text-[18px] leading-[22px] whitespace-pre-wrap text-gg-ink">
          {reply || (running ? 'Thinking…' : '')}
          {error && <span className="text-gg-red">{error}</span>}
        </div>
      )}
      <p className="mt-2 text-[16px] leading-5 text-gg-mute">
        Runs on this house's agent, so its tokens count toward the city's CREDITS.
      </p>
    </section>
  )
}

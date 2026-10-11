// Small pieces shared by the building view, the bot section and the result view.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="inline-block size-2 shrink-0 bg-gg-pink" />
      <h3 className="font-pixel shrink-0 text-[8px] leading-none text-gg-mute">{children}</h3>
      <span className="h-[2px] flex-1 bg-gg-haze" />
      {right}
    </div>
  )
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-pixel text-[8px] leading-[12px] text-gg-mute">
        {label}
      </label>
      {children}
    </div>
  )
}

const INPUT_CLASS =
  'gg-sp-input w-full border-2 border-gg-haze bg-gg-void px-2 text-[18px] text-gg-ink placeholder:text-gg-mute/70 hover:border-gg-cyan'

// Text field with a local draft. Commits (trimmed) on blur or Enter. Esc reverts and does not close the panel.
export function BlurField({
  id,
  value,
  onCommit,
  onDone,
  placeholder,
  multiline = false,
  autoFocus = false,
  maxLength,
  ariaLabel,
  type = 'text',
}: {
  id?: string
  value: string
  onCommit: (v: string) => void
  onDone?: () => void
  placeholder?: string
  multiline?: boolean
  autoFocus?: boolean
  maxLength?: number
  ariaLabel?: string
  type?: 'text' | 'url'
}) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    // The store value changed from outside: take it.
    setSynced(value)
    setDraft(value)
  }
  const cancelled = useRef(false)

  const onBlur = () => {
    if (cancelled.current) {
      cancelled.current = false
      setDraft(value)
    } else {
      const next = draft.trim()
      setDraft(next)
      if (next !== value) onCommit(next)
    }
    onDone?.()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault() // SidePanel ignores Esc when defaultPrevented
      cancelled.current = true
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  if (multiline) {
    return (
      <textarea
        id={id}
        value={draft}
        rows={2}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={`${INPUT_CLASS} min-h-16 resize-y py-1 leading-[20px]`}
      />
    )
  }
  return (
    <input
      id={id}
      type={type}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${INPUT_CLASS} h-10`}
    />
  )
}

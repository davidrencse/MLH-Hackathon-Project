// "NEW BOT" dialog. Collects a BotConfig and hands it to the store as a build mode; the ground places it on a lot.
// No network: the endpoint is only stored for the backend team.
import { useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BOT_KINDS, CATALOG } from '@/constants'
import { useGrid } from '@/store/grid'
import type { BotKind } from '@/types'

const SWATCHES = [
  { name: 'Pink', hex: '#ff2bd6' },
  { name: 'Cyan', hex: '#00f0ff' },
  { name: 'Green', hex: '#39ff14' },
  { name: 'Yellow', hex: '#ffd400' },
  { name: 'Orange', hex: '#ff9d4d' },
  { name: 'Blue', hex: '#4d7cff' },
]

const KINDS = Object.keys(BOT_KINDS) as BotKind[]
const COST = CATALOG.bot.cost
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const FOCUS_WITHIN =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gg-cyan has-[:focus-visible]:outline-solid'

// kind = null → closed. The form remounts on every open, so its state starts fresh.
export function NewBotDialog({ kind, onClose }: { kind: BotKind | null; onClose: () => void }) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]">
        <BotForm initialKind={kind ?? 'custom'} onDone={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function BotForm({ initialKind, onDone }: { initialKind: BotKind; onDone: () => void }) {
  const credits = useGrid((s) => s.credits)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<BotKind>(initialKind)
  const [endpoint, setEndpoint] = useState('')
  const [schedule, setSchedule] = useState('every 5m')
  const [color, setColor] = useState(BOT_KINDS[initialKind].color)
  const [notes, setNotes] = useState('')
  const [tried, setTried] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  const nameMissing = name.trim() === ''
  const canAfford = credits >= COST

  const pickKind = (k: BotKind) => {
    setKind(k)
    setColor(BOT_KINDS[k].color)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (nameMissing) {
      setTried(true)
      nameRef.current?.focus()
      return
    }
    if (!canAfford) return
    useGrid.getState().setBuildMode({
      type: 'bot',
      name: name.trim(),
      bot: { kind, endpoint: endpoint.trim(), schedule: schedule.trim(), notes: notes.trim(), color },
    })
    onDone()
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-[12px]" style={{ color }}>
          NEW BOT
        </DialogTitle>
        <DialogDescription>Set it up, then click a glowing lot to place it.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={`${uid}-name`}>
          Name <span className="text-gg-pink">*</span>
        </Label>
        <Input
          ref={nameRef}
          id={`${uid}-name`}
          value={name}
          maxLength={24}
          autoComplete="off"
          placeholder="alpha-trader"
          aria-required="true"
          aria-invalid={tried && nameMissing ? true : undefined}
          aria-describedby={tried && nameMissing ? `${uid}-name-err` : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {tried && nameMissing && (
          <p id={`${uid}-name-err`} className="text-base leading-none text-gg-red">
            Name is required.
          </p>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 font-pixel text-[8px] leading-none text-gg-mute">KIND</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const meta = BOT_KINDS[k]
            const on = kind === k
            return (
              <label
                key={k}
                className={`flex cursor-pointer flex-col gap-1.5 border-2 p-2 ${FOCUS_WITHIN} ${
                  on ? 'bg-gg-dusk' : 'border-gg-haze bg-gg-void hover:border-gg-mute'
                }`}
                style={on ? ({ borderColor: meta.color } as CSSProperties) : undefined}
              >
                <input
                  type="radio"
                  name={`${uid}-kind`}
                  value={k}
                  checked={on}
                  onChange={() => pickKind(k)}
                  className="sr-only"
                />
                <span className="font-pixel text-[8px] leading-none" style={{ color: meta.color }}>
                  {meta.label.toUpperCase()}
                </span>
                <span className="text-base leading-tight text-gg-mute">{meta.description}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor={`${uid}-endpoint`}>Backend endpoint URL</Label>
        <Input
          id={`${uid}-endpoint`}
          type="url"
          inputMode="url"
          value={endpoint}
          autoComplete="off"
          spellCheck={false}
          placeholder={`https://your-backend.dev/bots/${slug(name) || '<name>'}`}
          aria-describedby={`${uid}-endpoint-note`}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <p id={`${uid}-endpoint-note`} className="text-base leading-tight text-gg-mute">
          Optional. Your backend teammate connects this later. Nothing is sent now.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${uid}-schedule`}>Schedule</Label>
        <Input
          id={`${uid}-schedule`}
          value={schedule}
          maxLength={32}
          autoComplete="off"
          placeholder="every 5m"
          onChange={(e) => setSchedule(e.target.value)}
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 font-pixel text-[8px] leading-none text-gg-mute">COLOR</legend>
        <div className="flex flex-wrap gap-3">
          {SWATCHES.map((s) => {
            const on = color === s.hex
            return (
              <label
                key={s.hex}
                title={s.name}
                className={`block size-7 cursor-pointer border-2 border-gg-void ${FOCUS_WITHIN}`}
                style={{
                  background: s.hex,
                  boxShadow: on ? '0 0 0 2px var(--gg-ink), 3px 3px 0 2px rgba(0,0,0,0.6)' : '2px 2px 0 0 rgba(0,0,0,0.6)',
                }}
              >
                <input
                  type="radio"
                  name={`${uid}-color`}
                  value={s.hex}
                  checked={on}
                  onChange={() => setColor(s.hex)}
                  aria-label={s.name}
                  className="sr-only"
                />
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor={`${uid}-notes`}>Notes</Label>
        <Textarea
          id={`${uid}-notes`}
          value={notes}
          rows={2}
          maxLength={280}
          placeholder="What should this bot do?"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!canAfford} title={canAfford ? undefined : 'Not enough build points'}>
          Place bot · {COST} BP
        </Button>
      </DialogFooter>
    </form>
  )
}

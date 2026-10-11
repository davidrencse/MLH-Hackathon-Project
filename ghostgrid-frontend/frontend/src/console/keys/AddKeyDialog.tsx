// "ADD API KEY" dialog. Saves a provider key to the keys store (localStorage only).
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { toast } from 'sonner'
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
import { PROVIDERS } from '@/constants'
import { maskKey, useKeys } from '@/store/keys'
import type { Provider } from '@/types'
import { isHttpUrl } from './format'
import { Field, PixelSelect } from './primitives'

const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[]

const KEY_PLACEHOLDER: Record<Provider, string> = {
  deepseek: 'sk-...',
  groq: 'gsk_...',
  openai: 'sk-proj-...',
  anthropic: 'sk-ant-...',
  gemini: 'AIza...',
  custom: 'your-api-key',
}

export function AddKeyDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* The form unmounts when the dialog closes, so every open starts fresh. */}
        <AddKeyForm onDone={(id) => (onAdded?.(id), onOpenChange(false))} />
      </DialogContent>
    </Dialog>
  )
}

function AddKeyForm({ onDone }: { onDone: (id: string) => void }) {
  const navigate = useNavigate()
  const [provider, setProvider] = useState<Provider>('deepseek')
  const [name, setName] = useState(`${PROVIDERS.deepseek.label} key`)
  const [nameEdited, setNameEdited] = useState(false)
  const [baseUrl, setBaseUrl] = useState(PROVIDERS.deepseek.baseUrl)
  const [urlEdited, setUrlEdited] = useState(false)
  const [secret, setSecret] = useState('')
  const [reveal, setReveal] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [blurred, setBlurred] = useState<Record<string, boolean>>({})
  // Checked on submit only, so the just-saved key does not flash "already added" while the dialog closes.
  const [dupKey, setDupKey] = useState<string | null>(null)

  const trimmedKey = secret.trim()
  const trimmedUrl = baseUrl.trim()
  const errors = {
    name: !name.trim() ? 'Name is required.' : name.trim().length > 40 ? 'Name must be 40 characters or less.' : null,
    baseUrl:
      provider === 'custom' && !trimmedUrl
        ? 'Base URL is required for a Custom provider.'
        : trimmedUrl && !isHttpUrl(trimmedUrl)
          ? 'Base URL must start with http:// or https://'
          : null,
    key: !trimmedKey
      ? 'API key is required.'
      : /\s/.test(trimmedKey)
        ? 'API key must not contain spaces.'
        : trimmedKey.length < 8
          ? 'API key looks too short (min 8 characters).'
          : dupKey !== null && dupKey === trimmedKey
            ? 'This key is already added.'
            : null,
  }
  const show = (f: keyof typeof errors) => (submitted || blurred[f] ? errors[f] : null)
  const blur = (f: keyof typeof errors) => () => setBlurred((b) => ({ ...b, [f]: true }))

  function changeProvider(p: Provider) {
    setProvider(p)
    if (!nameEdited) setName(`${PROVIDERS[p].label} key`)
    if (!urlEdited) setBaseUrl(PROVIDERS[p].baseUrl)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (errors.name || errors.baseUrl || errors.key) return
    if (useKeys.getState().keys.some((k) => k.key === trimmedKey)) {
      setDupKey(trimmedKey)
      return
    }
    const wasEmpty = useKeys.getState().keys.length === 0
    const added = useKeys.getState().addKey({
      name: name.trim(),
      provider,
      baseUrl: trimmedUrl || PROVIDERS[provider].baseUrl,
      key: trimmedKey,
    })
    toast.success('Key added', {
      description: wasEmpty
        ? `${added.name} · ${maskKey(added.key)} · The city is coming online.`
        : `${added.name} · ${maskKey(added.key)}`,
      action: wasEmpty ? { label: 'View city', onClick: () => navigate('/') } : undefined,
    })
    onDone(added.id)
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader className="pr-8">
        <DialogTitle>Add API key</DialogTitle>
        <DialogDescription>Buildings call this provider with your key. It stays in this browser.</DialogDescription>
      </DialogHeader>

      <Field label="Provider" htmlFor="gg-keys-provider">
        <PixelSelect
          id="gg-keys-provider"
          value={provider}
          onChange={(e) => changeProvider(e.target.value as Provider)}
        >
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {PROVIDERS[p].label}
            </option>
          ))}
        </PixelSelect>
      </Field>

      <Field label="Name" htmlFor="gg-keys-name" error={show('name')}>
        <Input
          id="gg-keys-name"
          value={name}
          maxLength={60}
          onChange={(e) => (setName(e.target.value), setNameEdited(true))}
          onBlur={blur('name')}
          aria-invalid={!!show('name')}
          autoComplete="off"
        />
      </Field>

      <Field
        label={provider === 'custom' ? 'Base URL (required)' : 'Base URL'}
        htmlFor="gg-keys-url"
        error={show('baseUrl')}
        hint={provider === 'custom' ? 'Any OpenAI-compatible endpoint.' : `Default: ${PROVIDERS[provider].baseUrl}`}
      >
        <Input
          id="gg-keys-url"
          value={baseUrl}
          placeholder="https://your-endpoint.example/v1"
          onChange={(e) => (setBaseUrl(e.target.value), setUrlEdited(true))}
          onBlur={blur('baseUrl')}
          aria-invalid={!!show('baseUrl')}
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>

      <Field label="API key" htmlFor="gg-keys-secret" error={show('key')}>
        <div className="relative">
          <Input
            id="gg-keys-secret"
            type={reveal ? 'text' : 'password'}
            value={secret}
            placeholder={KEY_PLACEHOLDER[provider]}
            onChange={(e) => setSecret(e.target.value)}
            onBlur={blur('key')}
            aria-invalid={!!show('key')}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
            aria-pressed={reveal}
            className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2 text-gg-mute"
          >
            {reveal ? <EyeOff size={16} strokeWidth={2.5} /> : <Eye size={16} strokeWidth={2.5} />}
          </Button>
        </div>
      </Field>

      <p className="flex items-center gap-2 text-base leading-none text-gg-mute">
        <Lock size={16} strokeWidth={2.5} className="shrink-0 text-gg-yellow" />
        Only the last 4 characters are shown after saving.
      </p>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit">Save key</Button>
      </DialogFooter>
    </form>
  )
}

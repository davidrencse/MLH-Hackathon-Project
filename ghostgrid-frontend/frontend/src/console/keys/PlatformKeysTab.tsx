// "Slop Angeles Keys" tab: platform keys issued by our (mock) API. Full secret is shown once on create.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Copy, Plus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { PlatformKey } from '@/types'
import { fmtDate, timeAgo } from './format'
import { Chip, ConfirmDialog, Field, PixelLoader } from './primitives'

export function PlatformKeysTab() {
  const [keys, setKeys] = useState<PlatformKey[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<PlatformKey | null>(null)

  useEffect(() => {
    let alive = true
    api.listPlatformKeys().then((k) => alive && setKeys(k))
    return () => {
      alive = false
    }
  }, [])

  async function revoke() {
    if (!revokeTarget) return
    await api.revokePlatformKey(revokeTarget.id)
    setKeys((ks) => ks && ks.map((k) => (k.id === revokeTarget.id ? { ...k, revoked: true } : k)))
    toast.success('Key revoked', { description: `${revokeTarget.name} · ${revokeTarget.masked}` })
  }

  const active = keys?.filter((k) => !k.revoked).length ?? 0

  return (
    <div className="grid gap-6">
      <p className="text-lg leading-tight text-gg-mute">
        Use these keys to call the Slop Angeles API from your own scripts. Send them as{' '}
        <code className="font-mono bg-gg-night px-1.5 text-gg-cyan">Authorization: Bearer gg-…</code>
      </p>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-pixel flex items-center gap-3 text-[10px] leading-none text-gg-ink">
            Slop Angeles keys
            <span className="border-2 border-gg-haze px-1.5 py-1 text-[8px] text-gg-mute">{active} active</span>
          </h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={2.5} />
            Create key
          </Button>
        </div>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys === null ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-gg-cyan">
                    <span className="inline-flex items-center gap-3">
                      <PixelLoader />
                      Loading keys
                    </span>
                  </TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-gg-mute">
                    No Slop Angeles keys yet. Create one to call the API.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => (
                  <TableRow
                    key={k.id}
                    className={`${k.revoked ? 'text-gg-mute' : ''} ${k.id === flashId ? 'gg-keys-row-new' : ''}`}
                  >
                    <TableCell className={`pl-4 ${k.revoked ? 'line-through decoration-2' : 'text-gg-ink'}`}>
                      {k.name}
                    </TableCell>
                    <TableCell>
                      <code className={`font-mono text-xl tracking-wider ${k.revoked ? 'text-gg-grey' : 'text-gg-cyan'}`}>
                        {k.masked}
                      </code>
                    </TableCell>
                    <TableCell className="text-gg-mute">{fmtDate(k.createdAt)}</TableCell>
                    <TableCell className="text-gg-mute">{timeAgo(k.lastUsed)}</TableCell>
                    <TableCell>
                      {k.revoked ? (
                        <Chip color="var(--gg-grey)">Revoked</Chip>
                      ) : (
                        <Chip color="var(--gg-green)">Active</Chip>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {!k.revoked && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => (setRevokeTarget(k), setRevokeOpen(true))}
                          aria-label={`Revoke ${k.name}`}
                          className="hover:border-gg-red hover:text-gg-red"
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(k) => {
          setKeys((ks) => [k, ...(ks ?? []).filter((x) => x.id !== k.id)])
          setFlashId(k.id)
        }}
      />

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke key?"
        confirmLabel="Revoke"
        onConfirm={revoke}
        description={
          revokeTarget && (
            <>
              <span className="text-gg-ink">{revokeTarget.name}</span> ({revokeTarget.masked}) stops working right away.
              Scripts using it will get 401. This cannot be undone.
            </>
          )
        }
      />
    </div>
  )
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (k: PlatformKey) => void
}) {
  const [secret, setSecret] = useState<string | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // While the secret is on screen, a stray click outside must not lose it.
      disablePointerDismissal={secret !== null}
      onOpenChangeComplete={(o) => !o && setSecret(null)}
    >
      <DialogContent className="sm:max-w-lg">
        {secret === null ? (
          <CreateForm
            onCreated={(k, s) => {
              onCreated(k)
              setSecret(s)
            }}
          />
        ) : (
          <SecretView secret={secret} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ onCreated }: { onCreated: (k: PlatformKey, secret: string) => void }) {
  const [name, setName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const error = !name.trim() ? 'Name is required.' : name.trim().length > 40 ? 'Name must be 40 characters or less.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (error || busy) return
    setBusy(true)
    try {
      const { key, secret } = await api.createPlatformKey(name.trim())
      toast.success('Key created', { description: `${key.name} · ${key.masked}` })
      onCreated(key, secret)
    } catch {
      toast.error('Could not create key. Try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader className="pr-8">
        <DialogTitle>Create Slop Angeles key</DialogTitle>
        <DialogDescription>Give it a name you will recognize later, like the machine or app that uses it.</DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor="gg-keys-pk-name" error={submitted ? error : null}>
        <Input
          id="gg-keys-pk-name"
          value={name}
          placeholder="e.g. demo-laptop"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={submitted && !!error}
          autoComplete="off"
          autoFocus
        />
      </Field>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Cancel</DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <PixelLoader />}
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}

function SecretView({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLElement>(null)

  // Fallback when the async clipboard API is blocked: select the code box and use execCommand.
  // The selection stays, so the user can still press Cmd+C if this fails too.
  function selectAndCopy(): boolean {
    const el = codeRef.current
    const sel = window.getSelection()
    if (!el || !sel) return false
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }

  async function copy() {
    let ok = false
    try {
      await navigator.clipboard.writeText(secret)
      ok = true
    } catch {
      ok = selectAndCopy()
    }
    if (ok) {
      setCopied(true)
      toast.success('Copied to clipboard')
    } else {
      toast.error('Copy failed. The key is selected: press Cmd+C.')
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader className="pr-8">
        <DialogTitle className="text-gg-green">Key created</DialogTitle>
        <DialogDescription>This is your new Slop Angeles secret key.</DialogDescription>
      </DialogHeader>

      <div className="flex items-stretch gap-2">
        <code
          ref={codeRef}
          aria-label="Secret key"
          className="gg-keys-secret font-mono min-w-0 flex-1 bg-gg-void px-3 py-2 text-xl leading-tight break-all text-gg-green"
        >
          {secret}
        </code>
        <Button
          variant={copied ? 'secondary' : 'default'}
          onClick={copy}
          className="h-auto min-w-24"
          aria-label="Copy secret key"
        >
          {copied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2.5} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="flex items-start gap-3 border-2 border-gg-yellow/60 bg-gg-yellow/10 px-3 py-2 text-lg leading-tight text-gg-yellow">
        <TriangleAlert size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" />
        Copy it now. You won't be able to see it again.
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant={copied ? 'default' : 'outline'} />}>
          {copied ? 'Done' : "I've saved it"}
        </DialogClose>
      </DialogFooter>
    </div>
  )
}

// "Provider Keys" tab: localStorage notice, key table (test / delete), empty state, building assignments.
import { useState } from 'react'
import { Lock, Plus, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PROVIDERS } from '@/constants'
import { maskKey, resolveBuildingKey, useKeys } from '@/store/keys'
import type { ProviderKey } from '@/types'
import { AddKeyDialog } from './AddKeyDialog'
import { BuildingAssignments } from './BuildingAssignments'
import { buildingName, buildingShort, fmtDate, hostOf, KEY_BUILDINGS } from './format'
import { ConfirmDialog, PixelKey, PixelLoader } from './primitives'

type TestState = { phase: 'running' } | { phase: 'done'; ok: boolean; latencyMs: number }

export function ProviderKeysTab() {
  const keys = useKeys((s) => s.keys)
  const buildingConfig = useKeys((s) => s.buildingConfig)
  const [addOpen, setAddOpen] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [delOpen, setDelOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<ProviderKey | null>(null)

  const usedBy = (keyId: string) =>
    KEY_BUILDINGS.filter((b) => resolveBuildingKey({ keys, buildingConfig }, b)?.id === keyId)

  async function runTest(k: ProviderKey) {
    setTests((t) => ({ ...t, [k.id]: { phase: 'running' } }))
    try {
      const r = await api.testConnection(k)
      setTests((t) => ({ ...t, [k.id]: { phase: 'done', ok: r.ok, latencyMs: r.latencyMs } }))
    } catch {
      setTests((t) => ({ ...t, [k.id]: { phase: 'done', ok: false, latencyMs: 0 } }))
    }
  }

  function askDelete(k: ProviderKey) {
    setDelTarget(k)
    setDelOpen(true)
  }

  function confirmDelete() {
    if (!delTarget) return
    useKeys.getState().removeKey(delTarget.id)
    toast.success('Key deleted', { description: `${delTarget.name} · ${maskKey(delTarget.key)}` })
  }

  const delUsers = delTarget ? usedBy(delTarget.id) : []
  const remaining = delTarget ? keys.filter((k) => k.id !== delTarget.id) : keys

  return (
    <div className="grid gap-6">
      {/* Notice */}
      <div
        role="note"
        className="flex items-stretch border-2 border-gg-yellow/60 bg-gg-yellow/5 shadow-[4px_4px_0_0_rgba(0,0,0,0.5)]"
      >
        <span aria-hidden className="gg-keys-hazard w-2 shrink-0" />
        <div className="flex items-center gap-3 px-4 py-3">
          <Lock size={16} strokeWidth={2.5} className="shrink-0 text-gg-yellow" />
          <p className="text-lg leading-tight text-gg-ink">
            Keys are stored only in this browser (localStorage).{' '}
            <span className="text-gg-yellow">Demo only — do not use production keys.</span>
          </p>
        </div>
      </div>

      {/* Keys table or empty state */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-pixel flex items-center gap-3 text-[10px] leading-none text-gg-ink">
            Provider keys
            <span className="border-2 border-gg-haze px-1.5 py-1 text-[8px] text-gg-mute">{keys.length}</span>
          </h2>
          {keys.length > 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} strokeWidth={2.5} />
              Add API key
            </Button>
          )}
        </div>

        {keys.length === 0 ? (
          <Card className="items-center gap-6 px-6 py-12 text-center">
            <PixelKey />
            <div className="grid gap-2">
              <p className="font-pixel text-[12px] leading-normal text-gg-grey">City offline</p>
              <p className="text-xl leading-tight text-gg-mute">
                No keys yet. Add one to bring the city online.
                <span className="gg-keys-cursor ml-1 inline-block h-4 w-2 translate-y-0.5 bg-gg-pink" />
              </p>
            </div>
            <Button size="lg" onClick={() => setAddOpen(true)}>
              <Plus size={16} strokeWidth={2.5} />
              Add API key
            </Button>
          </Card>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => {
                  const users = usedBy(k.id)
                  const t = tests[k.id]
                  return (
                    <TableRow key={k.id} className={k.id === flashId ? 'gg-keys-row-new' : ''}>
                      <TableCell className="pl-4">
                        <div className="leading-none text-gg-ink">{k.name}</div>
                        <div className="mt-1 text-base leading-none text-gg-mute">{hostOf(k.baseUrl)}</div>
                      </TableCell>
                      <TableCell>{PROVIDERS[k.provider]?.label ?? k.provider}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xl tracking-wider text-gg-cyan">{maskKey(k.key)}</code>
                      </TableCell>
                      <TableCell className="text-gg-mute">{fmtDate(k.createdAt)}</TableCell>
                      <TableCell>
                        {users.length === 0 ? (
                          <span className="text-gg-mute">—</span>
                        ) : (
                          <div className="flex max-w-[232px] min-w-[120px] flex-wrap gap-1">
                            {users.map((b) => (
                              <span
                                key={b}
                                title={buildingName(b)}
                                className="font-pixel border-2 border-gg-cyan/50 px-1.5 py-1 text-[8px] leading-none text-gg-cyan"
                              >
                                {buildingShort(b)}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-3">
                          <TestResult state={t} />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runTest(k)}
                            disabled={t?.phase === 'running'}
                            aria-label={`Test ${k.name}`}
                          >
                            <Zap size={16} strokeWidth={2.5} />
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => askDelete(k)}
                            aria-label={`Delete ${k.name}`}
                            className="hover:border-gg-red hover:text-gg-red"
                          >
                            <Trash2 size={16} strokeWidth={2.5} />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-4 border-t-2 border-gg-haze bg-gg-void/40 px-4 py-2 text-base text-gg-mute">
              <span>
                {keys.length} {keys.length === 1 ? 'key' : 'keys'} · first key is the default for every building
              </span>
              <code className="font-mono whitespace-nowrap max-md:hidden">localStorage["ghostgrid-keys"]</code>
            </div>
          </Card>
        )}
      </section>

      <BuildingAssignments />

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} onAdded={setFlashId} />

      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        title="Delete key?"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        description={
          delTarget && (
            <>
              <span className="text-gg-ink">{delTarget.name}</span> ({maskKey(delTarget.key)}) will be removed from this
              browser.{' '}
              {delUsers.length > 0 &&
                `${delUsers.length === KEY_BUILDINGS.length ? 'Every building' : delUsers.map(buildingShort).join(', ')} will ${
                  remaining.length > 0 ? `switch to ${remaining[0].name}` : 'go offline'
                }.`}
            </>
          )
        }
      />
    </div>
  )
}

function TestResult({ state }: { state: TestState | undefined }) {
  if (!state) return null
  if (state.phase === 'running')
    return (
      <span className="flex items-center gap-2 text-lg leading-none text-gg-cyan">
        <PixelLoader />
        testing
      </span>
    )
  return state.ok ? (
    <span className="flex items-center gap-2 text-lg leading-none text-gg-green" role="status">
      <span className="block size-2 bg-gg-green" />
      200 OK · {state.latencyMs}ms
    </span>
  ) : (
    <span className="flex items-center gap-2 text-lg leading-none text-gg-red" role="status">
      <span className="block size-2 bg-gg-red" />
      401 Unauthorized
    </span>
  )
}

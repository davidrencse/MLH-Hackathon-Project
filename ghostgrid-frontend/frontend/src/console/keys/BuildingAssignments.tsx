// "Building assignments" card: which provider key + model each building uses. Changes apply to the city live.
import { TriangleAlert } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BUILDINGS, PROVIDERS, STATUS_COLOR } from '@/constants'
import { useGrid } from '@/store/grid'
import { maskKey, resolveBuildingKey, useKeys } from '@/store/keys'
import type { BuildingId } from '@/types'
import { buildingName, buildingShort, KEY_BUILDINGS } from './format'
import { PixelSelect } from './primitives'

export function BuildingAssignments() {
  return (
    <Card className="py-0">
      <CardHeader className="border-b pt-4">
        <CardTitle>Building assignments</CardTitle>
        <CardDescription>Each building uses one key and one model. Changes reach the city instantly.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_160px] gap-4 border-b-2 border-gg-haze px-4 py-3 md:grid">
          {['Building', 'Key', 'Model', 'Status'].map((h) => (
            <span
              key={h}
              className={`font-pixel text-[8px] leading-none text-gg-mute uppercase ${h === 'Status' ? 'justify-self-end' : ''}`}
            >
              {h}
            </span>
          ))}
        </div>
        {KEY_BUILDINGS.map((b) => (
          <AssignmentRow key={b} id={b} />
        ))}
      </CardContent>
    </Card>
  )
}

function AssignmentRow({ id }: { id: BuildingId }) {
  const keys = useKeys((s) => s.keys)
  const buildingConfig = useKeys((s) => s.buildingConfig)
  const config = buildingConfig[id] ?? { keyId: null, model: BUILDINGS[id]?.model ?? '' }
  const gridStatus = useGrid((s) => s.buildings[id]?.status ?? 'idle')

  const resolved = resolveBuildingKey({ keys, buildingConfig }, id)
  const status = resolved ? gridStatus : 'offline'
  const provider = resolved?.provider ?? null
  const models = provider ? PROVIDERS[provider].models : []
  const mismatch = provider !== null && !models.includes(config.model)
  const keyValue = keys.some((k) => k.id === config.keyId) ? (config.keyId as string) : ''

  function changeKey(keyId: string) {
    const nextKeyId = keyId || null
    const next = resolveBuildingKey({ keys, buildingConfig: { ...buildingConfig, [id]: { ...config, keyId: nextKeyId } } }, id)
    const nextModels = next ? PROVIDERS[next.provider].models : []
    const model = next && !nextModels.includes(config.model) ? nextModels[0] : config.model
    useKeys.getState().setBuildingConfig(id, { keyId: nextKeyId, model })
  }

  const accent = STATUS_COLOR[status]

  return (
    <div className="grid grid-cols-2 items-start gap-3 border-b-2 border-gg-haze/50 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_160px] md:gap-4">
      <div className="flex min-h-8 min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="block size-3 shrink-0"
          style={{ background: accent, boxShadow: `inset -2px -2px 0 0 rgba(0,0,0,.35)` }}
        />
        <div className="min-w-0">
          <div className="font-pixel text-[10px] leading-none text-gg-ink">{buildingShort(id)}</div>
          <div className="mt-1.5 truncate text-base leading-none text-gg-mute">{buildingName(id)}</div>
        </div>
      </div>

      <div className="flex min-h-8 items-center justify-self-end md:order-last">
        <StatusBadge status={status} />
      </div>

      <div className="min-w-0">
        <PixelSelect
          aria-label={`${buildingName(id)} key`}
          value={keyValue}
          disabled={keys.length === 0}
          onChange={(e) => changeKey(e.target.value)}
        >
          {keys.length === 0 ? (
            <option value="">No keys — add one above</option>
          ) : (
            <>
              <option value="">First key (default)</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} · {maskKey(k.key)}
                </option>
              ))}
            </>
          )}
        </PixelSelect>
        {resolved && keyValue === '' && (
          <div className="mt-1 truncate text-base leading-none text-gg-mute">→ {resolved.name}</div>
        )}
      </div>

      <div className="min-w-0">
        <PixelSelect
          aria-label={`${buildingName(id)} model`}
          value={config.model}
          disabled={!provider}
          onChange={(e) => useKeys.getState().setBuildingConfig(id, { model: e.target.value })}
        >
          {(!provider || mismatch) && <option value={config.model}>{config.model}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </PixelSelect>
        {mismatch && provider && (
          <div className="mt-1 flex items-center gap-1.5 text-base leading-none text-gg-yellow">
            <TriangleAlert size={16} strokeWidth={2.5} className="shrink-0" />
            <span className="truncate">Not a {PROVIDERS[provider].label} model. Pick one.</span>
          </div>
        )}
      </div>

    </div>
  )
}

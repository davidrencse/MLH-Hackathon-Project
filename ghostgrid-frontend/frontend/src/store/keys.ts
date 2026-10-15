// Provider API keys + per-building key/model choice.
// Persisted to localStorage (demo only: keys never leave this browser).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILDINGS } from '../constants.ts'
import type { BuildingConfig, BuildingId, ProviderKey } from '../types'

interface KeysState {
  keys: ProviderKey[]
  buildingConfig: Record<BuildingId, BuildingConfig>
  addKey: (k: Omit<ProviderKey, 'id' | 'createdAt'>) => ProviderKey
  removeKey: (id: string) => void
  setBuildingConfig: (buildingId: BuildingId, patch: Partial<BuildingConfig>) => void
}

export const useKeys = create<KeysState>()(
  persist(
    (set) => ({
      keys: [],
      buildingConfig: Object.fromEntries(
        Object.values(BUILDINGS).map((b) => [b.id, { keyId: null, model: b.model }]),
      ) as Record<BuildingId, BuildingConfig>,
      addKey: (k) => {
        const key: ProviderKey = { ...k, id: `key_${Date.now().toString(36)}`, createdAt: Date.now() }
        set((s) => ({ keys: [...s.keys, key] }))
        return key
      },
      removeKey: (id) =>
        set((s) => ({
          keys: s.keys.filter((k) => k.id !== id),
          buildingConfig: Object.fromEntries(
            Object.entries(s.buildingConfig).map(([b, c]) => [b, c.keyId === id ? { ...c, keyId: null } : c]),
          ) as Record<BuildingId, BuildingConfig>,
        })),
      setBuildingConfig: (buildingId, patch) =>
        set((s) => ({
          buildingConfig: {
            ...s.buildingConfig,
            [buildingId]: { ...(s.buildingConfig[buildingId] ?? { keyId: null, model: BUILDINGS[buildingId]?.model ?? 'custom-model' }), ...patch },
          },
        })),
    }),
    { name: 'ghostgrid-keys' },
  ),
)

// The key a building uses: its explicit choice, else the first key added. null = building is "offline" (grey).
export function resolveBuildingKey(state: Pick<KeysState, 'keys' | 'buildingConfig'>, buildingId: BuildingId): ProviderKey | null {
  const chosen = state.buildingConfig[buildingId]?.keyId
  return state.keys.find((k) => k.id === chosen) ?? state.keys[0] ?? null
}

// The key to use for a given provider: the first one added for it. null = no key for it.
export function resolveKeyForProvider(
  state: Pick<KeysState, 'keys'>,
  provider: ProviderKey['provider'],
): ProviderKey | null {
  return state.keys.find((k) => k.provider === provider) ?? null
}

// React hook: true when the building has no usable key.
export function useIsOffline(buildingId: BuildingId): boolean {
  return useKeys((s) => resolveBuildingKey(s, buildingId) === null)
}

export const maskKey = (key: string) => `••••${key.slice(-4)}`

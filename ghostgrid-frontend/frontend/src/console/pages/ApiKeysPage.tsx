// API Keys: provider keys (localStorage, per-building assignment) and Ghost Grid platform keys (mock API).
import { Ghost, KeyRound } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { resolveBuildingKey, useKeys } from '@/store/keys'
import { KEY_BUILDINGS } from '../keys/format'
import { PlatformKeysTab } from '../keys/PlatformKeysTab'
import { ProviderKeysTab } from '../keys/ProviderKeysTab'
import { PageHeader } from '../PageHeader'

export function ApiKeysPage() {
  return (
    <div>
      <PageHeader
        title="API Keys"
        description="Connect model providers. Each building uses one key and model."
        actions={<CityOnline />}
      />
      <Tabs defaultValue="provider" className="gap-6">
        <TabsList>
          <TabsTrigger value="provider" className="px-4">
            <KeyRound size={16} strokeWidth={2.5} />
            Provider Keys
          </TabsTrigger>
          <TabsTrigger value="platform" className="px-4">
            <Ghost size={16} strokeWidth={2.5} />
            Ghost Grid Keys
          </TabsTrigger>
        </TabsList>
        <TabsContent value="provider">
          <ProviderKeysTab />
        </TabsContent>
        <TabsContent value="platform">
          <PlatformKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// "2/3 ONLINE": how many buildings have a usable key. Selector returns a number, so no re-render loop.
function CityOnline() {
  const online = useKeys((s) => KEY_BUILDINGS.filter((b) => resolveBuildingKey(s, b) !== null).length)
  const total = KEY_BUILDINGS.length
  const color = online === 0 ? 'var(--gg-grey)' : online === total ? 'var(--gg-green)' : 'var(--gg-yellow)'
  return (
    <div className="flex shrink-0 items-center gap-3 border-2 px-3 py-2" style={{ borderColor: color }}>
      <span className="flex gap-1" aria-hidden>
        {KEY_BUILDINGS.map((b, i) => (
          <span key={b} className="block size-2" style={{ background: i < online ? color : 'var(--gg-haze)' }} />
        ))}
      </span>
      <span className="font-pixel text-[8px] leading-none whitespace-nowrap uppercase" style={{ color }}>
        {online}/{total} online
      </span>
    </div>
  )
}

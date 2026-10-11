// Dashboard landing: game-style "CITY STATS" screen (resources, traffic, budget, citizens, news).
import { PageHeader } from '@/console/PageHeader'
import { BudgetPanel } from '@/console/overview/BudgetPanel'
import { CitizensPanel } from '@/console/overview/CitizensPanel'
import { CityNews } from '@/console/overview/CityNews'
import { ResourceTiles } from '@/console/overview/ResourceTiles'
import { TrafficPanel } from '@/console/overview/TrafficPanel'

export function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="CITY STATS" description="Live numbers from your agent city. Game credits and real money are kept apart." />
      <ResourceTiles />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <TrafficPanel />
        <BudgetPanel />
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <CitizensPanel />
        <CityNews />
      </div>
    </div>
  )
}

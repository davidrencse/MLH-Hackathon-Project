// REPOSITORY: the Wall Street panel. Each tower in the district is one open-source quant
// trading project; the data comes from the backend's GET /api/v1/wallstreet, which reads public
// GitHub metadata. Nothing here clones, downloads or runs the project — the only action is a
// link out to GitHub.
import { ExternalLink, GitFork, RefreshCw, Star, TriangleAlert } from 'lucide-react'
import { useGrid } from '@/store/grid'
import type { QuantRepo } from '@/types'
import { BTN } from './buttons'
import { SectionTitle } from './parts'

const SOURCE_LABEL: Record<QuantRepo['status'], { text: string; color: string }> = {
  live: { text: 'LIVE FROM GITHUB', color: 'var(--gg-green)' },
  cached: { text: 'CACHED', color: 'var(--gg-cyan)' },
  static: { text: 'BUNDLED ROSTER', color: 'var(--gg-yellow)' },
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)

function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return '—'
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-2 border-gg-haze bg-gg-void/60 px-2 py-1">
      <span className="font-pixel text-[8px] leading-none text-gg-mute">{label}</span>
      <span className="flex items-center gap-1 text-[18px] leading-[20px] text-gg-ink">
        {children}
        {value}
      </span>
    </div>
  )
}

export function WallStreetSection({ repo }: { repo: QuantRepo }) {
  const loading = useGrid((s) => s.wallStreetStatus.loading)
  const refresh = () => void useGrid.getState().loadWallStreet({ refresh: true })
  const badge = SOURCE_LABEL[repo.status] ?? SOURCE_LABEL.static
  const stats = repo.stats

  return (
    <section>
      <SectionTitle
        right={
          <span className="font-pixel text-[8px] leading-none" style={{ color: badge.color }}>
            {badge.text}
          </span>
        }
      >
        REPOSITORY
      </SectionTitle>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-pixel text-[8px] leading-none" style={{ color: repo.accent }}>
            {repo.ticker} · {repo.asset.toUpperCase()}
          </span>
          <span className="text-[18px] leading-[20px] text-gg-ink">
            {repo.repo.owner}/{repo.repo.name}
          </span>
        </div>

        <p className="text-[18px] leading-[20px] text-gg-mute">{stats?.description || repo.strategy}</p>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="STARS" value={stats ? compact(stats.stars) : '—'}>
            <Star size={13} strokeWidth={2.5} className="text-gg-yellow" />
          </Stat>
          <Stat label="FORKS" value={stats ? compact(stats.forks) : '—'}>
            <GitFork size={13} strokeWidth={2.5} className="text-gg-cyan" />
          </Stat>
          <Stat label="LANGUAGE" value={stats?.language ?? '—'} />
          <Stat label="LAST PUSH" value={ago(stats?.pushedAt)} />
          <Stat label="OPEN ISSUES" value={stats ? compact(stats.openIssues) : '—'} />
          <Stat label="LICENSE" value={stats?.license ?? '—'} />
        </div>

        {!!stats?.topics.length && (
          <div className="flex flex-wrap gap-1">
            {stats.topics.slice(0, 6).map((topic) => (
              <span key={topic} className="border-2 border-gg-haze px-1 text-[16px] leading-[18px] text-gg-mute">
                {topic}
              </span>
            ))}
          </div>
        )}

        {repo.error && (
          <p className="flex items-start gap-2 text-[18px] leading-[20px] text-gg-yellow">
            <TriangleAlert size={14} strokeWidth={2.5} className="mt-[3px] shrink-0" />
            {repo.error}
          </p>
        )}

        <div className="flex gap-2">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BTN.cyan} flex-1 justify-between`}
          >
            <span>Open repository</span>
            <ExternalLink size={14} strokeWidth={2.5} />
          </a>
          <button type="button" onClick={refresh} className={BTN.ghost} aria-label="Refresh repository data" disabled={loading}>
            <RefreshCw size={14} strokeWidth={2.5} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>
    </section>
  )
}

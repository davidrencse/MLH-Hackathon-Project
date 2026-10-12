// Title row used by every console page.
import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="gg-page-header mb-6 flex items-end justify-between gap-4 border-b-2 border-gg-haze pb-4">
      <div>
        <h1 className="font-pixel text-base text-gg-ink">{title}</h1>
        {description && <p className="mt-2 text-lg text-gg-mute">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

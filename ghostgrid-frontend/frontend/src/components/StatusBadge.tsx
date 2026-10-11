// Shared status pill. Same colors in city and console (see DESIGN.md).
import { STATUS_COLOR, STATUS_LABEL } from '../constants'
import type { BuildingStatus } from '../types'

export function StatusBadge({ status, className = '' }: { status: BuildingStatus | 'offline'; className?: string }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className={`font-pixel inline-flex items-center gap-2 border-2 px-2 py-1 text-[8px] leading-none ${className}`}
      style={{ color, borderColor: color, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
    >
      <span className="inline-block size-2" style={{ background: color }} />
      {STATUS_LABEL[status]}
    </span>
  )
}

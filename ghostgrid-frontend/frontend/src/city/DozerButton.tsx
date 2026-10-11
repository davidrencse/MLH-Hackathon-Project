import { useEffect } from 'react'
import { useDozer } from '../city3d/dozer'

// Bulldozer tool: toggle on, then click any building (except the Router) to demolish it. Esc to exit.
export function DozerButton() {
  const on = useDozer((s) => s.on)
  const toggle = useDozer((s) => s.toggle)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && useDozer.getState().set(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <button
      onClick={toggle}
      title="Bulldozer: click a building to demolish (Esc to exit)"
      style={{
        position: 'absolute', right: 16, top: 84, zIndex: 40, font: "11px 'Press Start 2P', monospace",
        padding: '10px 12px', border: '2px solid #000', boxShadow: on ? '0 0 0 #000' : '4px 4px 0 #000',
        transform: on ? 'translate(4px,4px)' : 'none', cursor: 'pointer',
        background: on ? '#ff004d' : '#ffec27', color: '#111',
      }}
    >
      🚜 {on ? 'DOZER ON · ESC' : 'BULLDOZE'}
    </button>
  )
}

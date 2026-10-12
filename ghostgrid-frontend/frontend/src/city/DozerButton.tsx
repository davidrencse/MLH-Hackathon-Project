import { useEffect } from 'react'
import { useDozer } from '../city3d/dozer'
import { usePlots } from '../city3d/OuterDistricts'

// Bulldozer tool: toggle on, then click any building (except the Router) to demolish it. Esc to exit.
export function DozerButton() {
  const on = useDozer((s) => s.on)
  const toggle = useDozer((s) => s.toggle)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && useDozer.getState().set(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const opened = usePlots((s) => s.open.length)
  return (
    <>
    {opened > 0 && <button className="gg-reset-plots" onClick={() => usePlots.getState().reset()} title="Re-lock all outer plots" style={{ position: 'absolute', right: 16, top: 134, zIndex: 40, font: "9px 'Press Start 2P', monospace", padding: '8px 10px', border: '2px solid #000', boxShadow: '3px 3px 0 #000', background: '#c2c3c7', color: '#111', cursor: 'pointer' }}>↺ RESET PLOTS ({opened}/8)</button>}
    <button
      className="gg-dozer-button"
      aria-pressed={on}
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
    </>
  )
}

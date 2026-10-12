import { Link } from 'react-router-dom'
import { Building2, RotateCcw, RotateCw, Minus, Plus, Scan, X, ChevronRight } from 'lucide-react'
import { useBuildingList, useGrid } from '@/store/grid'
import { CATALOG } from '@/constants'
import { hasWebGL } from '@/city2d/webgl'

export type CityCameraAction = 'left' | 'right' | 'in' | 'out' | 'reset'
export function cityCameraAction(action: CityCameraAction) {
  window.dispatchEvent(new CustomEvent('gg:camera', { detail: action }))
}

export function MobileCityControls({ directory, onToggle, onClose }: { directory: boolean; onToggle: () => void; onClose: () => void }) {
  const buildings = useBuildingList().filter((b) => b.type !== 'router')
  const webgl = hasWebGL()
  const panel = useGrid((s) => s.panel)
  const office = useGrid((s) => s.office)
  return <div className="gg-mobile-city-controls" hidden={panel !== null || office !== null}>
    {directory && <section id="mobile-building-directory" className="gg-mobile-directory" aria-label="City buildings">
      <header><h2>YOUR BUILDINGS</h2><button type="button" aria-label="Close building directory" onClick={onClose}><X size={20} /></button></header>
      <div className="gg-mobile-directory-list">{buildings.map((b) => <div key={b.id}>
        <button type="button" onClick={() => { useGrid.getState().selectBuilding(b.id); onClose() }}><span className="gg-building-pip" style={{ background: b.bot?.color ?? CATALOG[b.type].accent }} /><span>{b.name}<small>{b.status.replaceAll('_', ' ')}</small></span><ChevronRight size={18} /></button>
        {['codex', 'claude'].includes(b.type) && <Link to={`/office/${b.id}`}>Office</Link>}
      </div>)}</div>
    </section>}
    <div className="gg-mobile-city-toolbar">
      <button type="button" className="gg-directory-toggle" aria-label="Open building directory" aria-expanded={directory} aria-controls="mobile-building-directory" onClick={onToggle}><Building2 size={20} /><span>Buildings</span></button>
      {webgl && <div className="gg-camera-controls" aria-label="City camera">
        <button type="button" aria-label="Rotate city left" onClick={() => cityCameraAction('left')}><RotateCcw size={18} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => cityCameraAction('out')}><Minus size={18} /></button>
        <button type="button" aria-label="Reset city view" onClick={() => cityCameraAction('reset')}><Scan size={18} /></button>
        <button type="button" aria-label="Zoom in" onClick={() => cityCameraAction('in')}><Plus size={18} /></button>
        <button type="button" aria-label="Rotate city right" onClick={() => cityCameraAction('right')}><RotateCw size={18} /></button>
      </div>}
    </div>
    <p className="gg-mobile-city-hint">{webgl ? 'Drag to explore · pinch to zoom · tap a building' : 'Tap a building or browse the directory'}</p>
  </div>
}

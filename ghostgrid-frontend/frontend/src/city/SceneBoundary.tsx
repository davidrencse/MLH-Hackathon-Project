// Keeps one broken module from taking the whole city with it.
//
// The scene is two lazy chunks (city3d/CityCanvas, city2d/City2D). <Suspense> covers the wait
// but not the failure: a chunk that 404s after a redeploy, a WebGL context the driver refuses,
// or one throwing component inside the canvas unmounts everything above it and leaves a blank
// page — React's own advice in that console message is to add this.
//
// A failure here is not fatal, because the city has a second renderer: WebGL falls back to the
// DOM city. Only when that fails too does the player get a message, and it says what to do.
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Rendered instead of `children` after the first failure. */
  fallback: ReactNode
  /** Named in the log line, so the console says which renderer died. */
  label: string
}

export class SceneBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[ghostgrid] ${this.props.label} failed, falling back:`, error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * One HUD panel, isolated.
 *
 * The scene had a boundary and the HUD did not, which is backwards: the canvas has a second
 * renderer to fall back to, while the HUD is where unvalidated backend data is rendered and
 * where several agents edit at once. A throw in a side panel took the whole application —
 * twice, per AGENTS.md — so each panel now fails alone and says which one it was.
 */
export function PanelBoundary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SceneBoundary
      label={label}
      fallback={
        <div role="alert" className="pointer-events-none absolute bottom-3 left-3 z-50 border-2 border-gg-red bg-gg-void/90 px-3 py-2 font-mono text-sm text-gg-red">
          <span className="font-pixel block text-[8px] leading-none">PANEL DOWN</span>
          {label} stopped. The console has the error; the rest of the city is unaffected.
        </div>
      }
    >
      {children}
    </SceneBoundary>
  )
}

/** The end of the line: both renderers are down, so say so instead of showing a void. */
export function SceneDown() {
  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center font-mono text-gg-mute"
    >
      <span className="font-pixel text-[10px] leading-none text-gg-red">CITY RENDERER DOWN</span>
      <p className="max-w-md text-lg">
        The 3D city and its 2D fallback both failed to start. The console has the error. Reloading
        usually fixes it after an update; the dashboard works either way.
      </p>
      <a
        href="/dashboard"
        className="font-pixel border-2 border-gg-cyan px-3 py-2 text-[8px] leading-none text-gg-cyan hover:bg-gg-cyan hover:text-gg-void"
      >
        OPEN DASHBOARD
      </a>
    </div>
  )
}

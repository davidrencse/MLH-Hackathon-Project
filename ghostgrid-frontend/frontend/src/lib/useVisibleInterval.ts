import { useEffect } from 'react'

/**
 * setInterval that only runs while the tab is visible.
 *
 * Browsers keep firing intervals in a hidden tab (throttled, not stopped), so a clock or a
 * poll nobody can see still costs React renders and fetches. This stops on hide, fires once
 * on show so the UI is never stale, and restarts the timer.
 *
 * `ms <= 0` disables the timer entirely.
 */
export function useVisibleInterval(callback: () => void, ms: number) {
  useEffect(() => {
    if (ms <= 0) return
    let id = 0
    const stop = () => { window.clearInterval(id); id = 0 }
    const sync = () => {
      if (document.hidden) { stop(); return }
      if (id) return
      callback()
      id = window.setInterval(callback, ms)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { stop(); document.removeEventListener('visibilitychange', sync) }
    // The caller keeps `callback` stable (useCallback or a setState updater), so re-running on
    // every render is not a concern here.
  }, [callback, ms])
}

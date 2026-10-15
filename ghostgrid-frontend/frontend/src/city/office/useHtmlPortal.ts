// Why: drei's <Html> mounts its own React root. Without a `portal` target it picks one from
// R3F's event state, and when R3F connects (or reconnects) its event handlers that target
// changes — so the root is torn down and rebuilt mid-render. React reports that as:
//
//   Attempted to synchronously unmount a root while React was already rendering.
//
// Handing <Html> a target that never changes identity avoids the teardown entirely.
// city3d/ground/LeasePads.tsx solved this the same way; this is that fix, shared, because the
// office draws five labels this way and each one was re-creating a root.
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';

/** A stable portal target for <Html>: the canvas' own parent element. Use inside a Canvas. */
export function useHtmlPortal() {
  const gl = useThree((state) => state.gl);
  return useMemo(() => ({ current: gl.domElement.parentElement as HTMLElement }), [gl]);
}

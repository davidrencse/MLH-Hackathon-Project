// Codex Tower — 64x112 logical px. Office tower, three bays of dense windows, rooftop helipad
// (drone dock), signal mast, neon "CODEX" sign. Lit edge faces the Router Spire (right).
import { B, PixelText, WindowGrid } from './parts'

const N = 'var(--gg-night)'
const D = 'var(--gg-dusk)'
const H = 'var(--gg-haze)'
const V = 'var(--gg-void)'

export function CodexTower() {
  return (
    <>
      {/* roof: water tank, helipad, signal mast */}
      <B x={6} y={-7} w={8} h={5} c={D} className="gg-bld-edge-r" />
      <B x={7} y={-2} w={1} h={2} c={H} />
      <B x={12} y={-2} w={1} h={2} c={H} />
      <B x={22} y={-2} w={20} h={2} c={D} />
      <B x={22} y={-2} w={1} h={1} className="gg-bld-neon-c" />
      <B x={41} y={-2} w={1} h={1} className="gg-bld-neon-c" />
      <B x={55} y={-12} w={1} h={12} c={H} />
      <B x={53} y={-8} w={5} h={1} c={H} />
      <B x={54} y={-15} w={3} h={3} className="gg-bld-beacon gg-bld-signal" />

      {/* body */}
      <B x={0} y={0} w={64} h={112} c={N} className="gg-bld-edge-r" />
      <B x={0} y={0} w={64} h={1} className="gg-bld-neon-c" />
      <B x={0} y={1} w={64} h={2} c={D} />

      {/* neon sign */}
      <B x={12} y={5} w={40} h={10} className="gg-bld-hsign">
        <PixelText text="CODEX" size={6} className="gg-bld-hsign-txt" />
      </B>

      {/* three bays of windows split by pilasters */}
      <WindowGrid x={4} y={19} cols={4} rows={20} cw={4} ch={4} ww={3} wh={2} seed={21} />
      <B x={20} y={18} w={3} h={83} c={D} />
      <WindowGrid x={24} y={19} cols={4} rows={20} cw={4} ch={4} ww={3} wh={2} seed={22} lit={0.55} />
      <B x={40} y={18} w={3} h={83} c={D} />
      <WindowGrid x={44} y={19} cols={4} rows={20} cw={4} ch={4} ww={3} wh={2} seed={23} />
      <B x={4} y={58} w={56} h={1} c={D} />

      {/* facade AC units for silhouette */}
      <B x={64} y={42} w={2} h={3} c={D} />
      <B x={64} y={72} w={2} h={3} c={D} />
      <B x={-2} y={56} w={2} h={3} c={D} />

      {/* lobby */}
      <B x={2} y={101} w={60} h={1} className="gg-bld-neon-p" />
      <B x={5} y={104} w={54} h={8} className="gg-bld-lobby" />
      <B x={28} y={105} w={8} h={7} c={V} />
    </>
  )
}

// Router Spire — 48x152 logical px. Tapered tower, antenna mast (tip at local y -12, under the halo),
// cyan neon strips, a protruding vertical "ROUTER" sign, pink accents.
import { B, WindowGrid } from './parts'

const N = 'var(--gg-night)'
const D = 'var(--gg-dusk)'
const H = 'var(--gg-haze)'
const V = 'var(--gg-void)'

export function RouterSpire() {
  return (
    <>
      {/* antenna mast + crossbars + beacon (tip ~ stage y 28) */}
      <B x={23} y={-10} w={2} h={10} c={H} />
      <B x={21} y={-6} w={6} h={1} c={H} />
      <B x={22} y={-3} w={4} h={1} c={H} />
      <B x={23} y={-12} w={2} h={2} className="gg-bld-beacon" />

      {/* crown */}
      <B x={19} y={0} w={10} h={8} c={D} className="gg-bld-edge-l" />
      <B x={19} y={0} w={10} h={1} className="gg-bld-neon-p" />

      {/* top tier with the router "eye" */}
      <B x={14} y={8} w={20} h={22} c={N} className="gg-bld-edge-l" />
      <B x={14} y={8} w={20} h={1} className="gg-bld-neon-c" />
      <B x={17} y={13} w={14} h={3} c={V} />
      <B x={18} y={14} w={12} h={1} className="gg-bld-eye" />
      <WindowGrid x={17} y={19} cols={4} rows={2} seed={11} lit={0.6} alt={0} />

      {/* middle tier */}
      <B x={8} y={30} w={32} h={42} c={N} className="gg-bld-edge-l" />
      <B x={8} y={30} w={32} h={1} className="gg-bld-neon-c" />
      <B x={10} y={32} w={1} h={38} className="gg-bld-neon-c gg-bld-flow" />
      <B x={37} y={32} w={1} h={38} className="gg-bld-neon-c gg-bld-flow" />
      <WindowGrid x={13} y={34} cols={6} rows={9} seed={12} />

      {/* lower tier */}
      <B x={4} y={72} w={40} h={56} c={N} className="gg-bld-edge-l" />
      <B x={4} y={72} w={40} h={1} className="gg-bld-neon-c" />
      <B x={6} y={74} w={1} h={52} className="gg-bld-neon-c gg-bld-flow" />
      <B x={41} y={74} w={1} h={52} className="gg-bld-neon-c gg-bld-flow" />
      <WindowGrid x={9} y={76} cols={8} rows={12} seed={13} />

      {/* protruding vertical ROUTER sign on brackets */}
      <B x={44} y={82} w={2} h={1} c={H} />
      <B x={44} y={114} w={2} h={1} c={H} />
      <B x={46} y={78} w={11} h={41} className="gg-bld-vsign">
      </B>

      {/* podium */}
      <B x={0} y={128} w={48} h={24} c={D} className="gg-bld-edge-l" />
      <B x={0} y={128} w={48} h={1} className="gg-bld-neon-p" />
      <B x={4} y={133} w={10} h={2} className="gg-bld-slit" />
      <B x={34} y={133} w={10} h={2} className="gg-bld-slit" />
      <B x={2} y={140} w={2} h={2} className="gg-bld-neon-p" />
      <B x={44} y={140} w={2} h={2} className="gg-bld-neon-p" />
      {/* entrance */}
      <B x={17} y={137} w={14} h={15} c={V} className="gg-bld-door" />
      <B x={19} y={140} w={10} h={1} className="gg-bld-neon-c" />
    </>
  )
}

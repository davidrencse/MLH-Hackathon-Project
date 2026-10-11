// Security Checkpoint — 80x68 logical px. Crenellated bastion, watchtower with beacon, gate with
// warning lights, striped boom barrier (raised only while working), "SEC" sign. Lit edge faces the spire (left).
import { B, PixelText, WindowGrid } from './parts'

const N = 'var(--gg-night)'
const D = 'var(--gg-dusk)'
const H = 'var(--gg-haze)'

const MERLONS = [4, 12, 20, 28, 36, 44, 52]

export function SecurityCheckpoint() {
  return (
    <>
      {/* watchtower */}
      <B x={65} y={-18} w={2} h={2} className="gg-bld-beacon" />
      <B x={57} y={-16} w={18} h={2} c={H} />
      <B x={58} y={-14} w={16} h={10} c={D} className="gg-bld-edge-l" />
      <WindowGrid x={60} y={-12} cols={4} rows={1} cw={3} ch={4} ww={2} wh={3} seed={31} lit={0.9} alt={0} flicker={0.5} />
      <B x={62} y={-4} w={8} h={14} c={N} className="gg-bld-edge-l" />
      <B x={64} y={-1} w={4} h={1} c={H} />
      <B x={64} y={3} w={4} h={1} c={H} />

      {/* crenellations */}
      {MERLONS.map((x) => (
        <B key={x} x={x} y={6} w={4} h={4} c={N} />
      ))}

      {/* bastion walls + buttresses */}
      <B x={4} y={10} w={72} h={58} c={N} className="gg-bld-edge-l" />
      <B x={5} y={12} w={70} h={55} className="gg-bld-masonry" />
      <B x={2} y={26} w={2} h={42} c={D} />
      <B x={0} y={34} w={2} h={34} c={D} className="gg-bld-edge-l" />
      <B x={76} y={26} w={2} h={42} c={D} />
      <B x={78} y={34} w={2} h={34} c={D} />
      <B x={4} y={10} w={72} h={2} className="gg-bld-hazard" />

      {/* slit windows */}
      <WindowGrid x={8} y={17} cols={4} rows={2} cw={5} ch={5} ww={4} wh={1} seed={32} lit={0.6} alt={0} />
      <WindowGrid x={53} y={17} cols={4} rows={2} cw={5} ch={5} ww={4} wh={1} seed={33} lit={0.6} alt={0} />

      {/* SEC sign */}
      <B x={29} y={17} w={23} h={11} className="gg-bld-hsign gg-bld-hsign--pink">
        <PixelText text="SEC" size={5} className="gg-bld-hsign-txt" />
      </B>

      {/* gate */}
      <B x={26} y={32} w={28} h={2} c={H} />
      <B x={26} y={34} w={2} h={34} c={D} />
      <B x={52} y={34} w={2} h={34} c={D} />
      <B x={28} y={34} w={24} h={34} className="gg-bld-grate" />
      <B x={28} y={66} w={24} h={1} className="gg-bld-gatefloor" />

      {/* warning lights */}
      <B x={22} y={36} w={3} h={3} className="gg-bld-warn" />
      <B x={55} y={36} w={3} h={3} className="gg-bld-warn gg-bld-warn--b" />

      {/* jersey barrier + curb */}
      <B x={60} y={62} w={12} h={6} c={D} className="gg-bld-edge-l" />
      <B x={60} y={62} w={12} h={1} className="gg-bld-hazard" />
      <B x={0} y={67} w={80} h={1} c={H} />

      {/* boom barrier: post + striped arm (pivot at the post) */}
      <B x={17} y={53} w={4} h={15} c={D} className="gg-bld-edge-l" />
      <B x={17} y={52} w={4} h={1} className="gg-bld-neon-y" />
      <B x={21} y={55} w={38} h={2} className="gg-bld-arm">
        <B x={37} y={0} w={1} h={2} className="gg-bld-arm-tip" />
      </B>
    </>
  )
}

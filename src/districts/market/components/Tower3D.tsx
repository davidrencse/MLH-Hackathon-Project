// Market Tower in CSS 3D. Modes:
//   exterior – closed tower, slow swing; click anywhere to enter
//   tower    – camera moves in, facades slide off, floors spread apart (cutaway with robots)
//   focus    – camera dives into one floor right before the interior view opens
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMarket } from '../state/useMarketDistrict';
import { FLOORS, type FloorDef } from '../buildings';
import type { BuildingId, CityBlock } from '../types';
import { Robot } from './Robot';
import { FloorMetric } from './floorInfo';

const W = 300; // tower width
const D = 200; // tower depth
const FH = 92; // floor height
const LH = 70; // lobby height
const RH = 34; // roof block height
const GAP = 30; // floor separation in cutaway

interface FaceProps {
  w: number;
  h: number;
  t: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}
function Face({ w, h, t, className = '', style, children }: FaceProps) {
  return (
    <div className={`mk-face ${className}`} style={{ width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2, transform: t, ...style }}>
      {children}
    </div>
  );
}

/** Standard transforms for the 6 faces of a w×h×d box centred on its anchor. */
const box = (w: number, h: number, d: number) => ({
  front: `translateZ(${d / 2}px)`,
  back: `rotateY(180deg) translateZ(${d / 2}px)`,
  right: `rotateY(90deg) translateZ(${w / 2}px)`,
  left: `rotateY(-90deg) translateZ(${w / 2}px)`,
  top: `rotateX(90deg) translateZ(${h / 2}px)`,
  bottom: `rotateX(-90deg) translateZ(${h / 2}px)`,
});

export function Tower3D({ cityBlocks = [] }: { cityBlocks?: CityBlock[] }) {
  const { view, setView, openBuilding, setOpenBuilding, statuses } = useMarket();
  const [fit, setFit] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  // Scale the whole scene to the available space.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setFit(Math.max(0.42, Math.min(1.15, width / 700, height / 780)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = view !== 'exterior';
  const focus = view === 'floor' ? openBuilding : null;
  const gap = open ? GAP : 0;

  // Vertical layout (top → bottom), centred on the anchor.
  const total = RH + FLOORS.length * FH + (FLOORS.length + 1) * gap + LH;
  const top0 = -total / 2;
  const floorTop = (i: number) => top0 + RH + gap + i * (FH + gap);
  const lobbyTop = top0 + RH + gap + FLOORS.length * (FH + gap);

  let cam: { s: number; rx: number; ry: number; y: number };
  if (focus) {
    const i = FLOORS.findIndex((f) => f.id === focus);
    cam = { s: fit * 2.2, rx: -7, ry: -14, y: -(floorTop(i) + FH / 2) };
  } else if (open) {
    cam = { s: fit * 0.92, rx: -11, ry: -24, y: -34 };
  } else {
    cam = { s: fit * 0.58, rx: -17, ry: -32, y: 90 }; // city overview
  }

  // Camera dive and the interior fade-in run together (interior is pre-mounted), so there is no hand-off pause.
  const enterFloor = (id: BuildingId) => {
    if (view === 'tower') setOpenBuilding(id);
  };

  const camStyle = {
    transform: `scale3d(${cam.s}, ${cam.s}, ${cam.s}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) translateY(${cam.y}px)`,
    ['--ry-inv' as any]: `${-cam.ry}deg`,
  } as CSSProperties;

  const enterTower = () => view === 'exterior' && setView('tower');

  return (
    <div ref={stageRef} className={`mk-tw mk-tw--${focus ? 'focus' : open ? 'open' : 'closed'}`}>
      <div className="mk-tw__swing">
        <div className="mk-tw__cam" style={camStyle}>
          <City blocks={cityBlocks} groundY={total / 2} />
          <div className={`mk-tower ${view === 'exterior' ? 'is-enterable' : ''}`} onClick={enterTower}>
            <Face w={46} h={900} t={`translate3d(0, ${top0 - 470}px, 0)`} className="mk-face--beam" />
            <Face w={46} h={900} t={`translate3d(0, ${top0 - 470}px, 0) rotateY(90deg)`} className="mk-face--beam" />
            <div className="mk-tw__marker" style={{ transform: `translate3d(-50%, ${top0 - 190}px, 0) rotateY(var(--ry-inv))` }}>
              <span>MARKET TOWER</span>
              <i>▼</i>
            </div>
            <Roof top={top0} />
            {FLOORS.map((f, i) => (
              <Floor
                key={f.id}
                def={f}
                y={floorTop(i) + FH / 2}
                open={open}
                dim={!!focus && focus !== f.id}
                status={statuses[f.id]}
                onEnter={() => enterFloor(f.id)}
                clickable={view === 'tower'}
              />
            ))}
            <Lobby y={lobbyTop + LH / 2} open={open} />
          </div>
        </div>
      </div>
      {view === 'exterior' && (
        <button className="mk-btn mk-btn--primary mk-tw__cta" onClick={enterTower}>
          ▶ ENTER MARKET TOWER
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- city ---

const ROAD_Z = 330; // road in front of the tower
const ROAD_X = 340; // roads either side
const GROUND = 2600;

/** Decorative city around the tower. Not interactive; fades out when the tower opens. */
function City({ blocks, groundY }: { blocks: CityBlock[]; groundY: number }) {
  return (
    <div className="mk-city">
      <Face w={GROUND} h={GROUND} t={`translate3d(0, ${groundY + 1}px, 0) rotateX(90deg)`} className="mk-face--ground" />
      <Face w={GROUND} h={90} t={`translate3d(0, ${groundY}px, ${ROAD_Z}px) rotateX(90deg)`} className="mk-face--road">
        <Cars seed={0} />
      </Face>
      {[-ROAD_X, ROAD_X].map((x, i) => (
        <Face key={x} w={GROUND} h={80} t={`translate3d(${x}px, ${groundY}px, 0) rotateY(90deg) rotateX(90deg)`} className="mk-face--road">
          <Cars seed={i + 1} />
        </Face>
      ))}
      {blocks.map((b, i) => (
        <CityBuilding key={i} b={b} groundY={groundY} />
      ))}
    </div>
  );
}

const CAR_COLORS = ['#29f0ff', '#ff4fd8', '#ffb84f', '#3dff9a'];
function Cars({ seed }: { seed: number }) {
  return (
    <>
      {[0, 1, 2].map((k) => (
        <i
          key={k}
          className={`mk-car ${k % 2 ? 'mk-car--rev' : ''}`}
          style={{ ['--car' as any]: CAR_COLORS[(seed + k) % 4], animationDelay: `${-(seed * 2.3 + k * 3.1)}s`, animationDuration: `${7 + ((seed + k) % 3) * 2}s` }}
        />
      ))}
    </>
  );
}

function CityBuilding({ b, groundY }: { b: CityBlock; groundY: number }) {
  const f = box(b.w, b.h, b.d);
  return (
    <div className="mk-fl mk-cb" style={{ transform: `translate3d(${b.x}px, ${groundY - b.h / 2}px, ${b.z}px)`, ['--neon' as any]: b.color }}>
      <Face w={b.w} h={b.h} t={f.front} className="mk-face--city">
        {b.sign && <span className="mk-cb__sign">{b.sign}</span>}
      </Face>
      <Face w={b.d} h={b.h} t={f.right} className="mk-face--city mk-face--city-side" />
      <Face w={b.d} h={b.h} t={f.left} className="mk-face--city mk-face--city-side" />
      <Face w={b.w} h={b.h} t={f.back} className="mk-face--city" />
      <Face w={b.w} h={b.d} t={f.top} className="mk-face--city-top" />
      {b.roof === 'antenna' && (
        <>
          <Face w={4} h={70} t={`translate3d(${b.w / 4}px, ${-b.h / 2 - 35}px, 0)`} className="mk-face--antenna" />
          <Face w={8} h={8} t={`translate3d(${b.w / 4}px, ${-b.h / 2 - 72}px, 0)`} className="mk-face--beacon" />
        </>
      )}
      {b.roof === 'billboard' && (
        <Face w={b.w * 0.9} h={46} t={`translate3d(0, ${-b.h / 2 - 32}px, ${b.d / 4}px)`} className="mk-face--billboard">
          {b.billboard}
        </Face>
      )}
    </div>
  );
}

function Floor({
  def,
  y,
  open,
  dim,
  status,
  onEnter,
  clickable,
}: {
  def: FloorDef;
  y: number;
  open: boolean;
  dim: boolean;
  status: import('../types').BuildingStatus;
  onEnter: () => void;
  clickable: boolean;
}) {
  const f = box(W, FH, D);
  // In cutaway the camera-facing walls slide outward and fade.
  const shellFront = open ? `translateZ(${D / 2 + 140}px)` : f.front;
  const shellRight = open ? `rotateY(90deg) translateZ(${W / 2 + 140}px)` : f.right;
  return (
    <div
      className={`mk-fl mk-st--${status.toLowerCase()} ${dim ? 'is-dim' : ''} ${clickable ? 'is-clickable' : ''}`}
      style={{ transform: `translateY(${y}px)`, ['--neon' as any]: def.neon }}
      onClick={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        onEnter();
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      aria-label={clickable ? `${def.label} ${def.name}` : undefined}
      onKeyDown={(e) => clickable && e.key === 'Enter' && onEnter()}
    >
      {/* interior (seen in cutaway) */}
      <Face w={W} h={D} t={`rotateX(90deg) translateZ(${-FH / 2}px)`} className="mk-face--slab" />
      <Face w={W} h={FH} t={`translateZ(${-D / 2 + 1}px)`} className="mk-face--wall">
        <div className="mk-wall__screens">
          <i />
          <i />
          <i />
        </div>
        <div className="mk-wall__label">
          {def.label} · {def.name.toUpperCase()}
        </div>
      </Face>
      <Face w={D} h={FH} t={`rotateY(90deg) translateZ(${-W / 2 + 1}px)`} className="mk-face--wall mk-face--wall-side" />
      <Face w={70} h={26} t={`translate3d(48px, ${FH / 2 - 13}px, 20px)`} className="mk-face--desk" />
      <div className="mk-fl__bot" style={{ transform: `translate3d(-60px, ${FH / 2 - 60}px, 30px) rotateY(var(--ry-inv))` }}>
        <Robot variant={def.bot} color={def.neon} status={status} size={48} />
      </div>

      {/* shell */}
      <Face w={W} h={FH} t={shellFront} className="mk-face--shell mk-face--front">
        <span className="mk-shell__no">{def.label}</span>
      </Face>
      <Face w={D} h={FH} t={shellRight} className="mk-face--shell mk-face--side" />
      <Face w={W} h={FH} t={f.back} className="mk-face--shell mk-face--back" />
      <Face w={D} h={FH} t={f.left} className="mk-face--shell mk-face--side mk-face--back" />
      <Face w={W} h={6} t={`translate3d(0, ${FH / 2 - 3}px, ${D / 2 + 1}px)`} className="mk-face--lip" />

      {/* callout (cutaway only) */}
      <div className="mk-fl__callout" style={{ transform: `translate3d(${W / 2 + 26}px, -50%, ${D / 2}px) rotateY(var(--ry-inv))` }}>
        <div className="mk-fl__callout-head">
          <b>{def.label}</b> {def.name}
        </div>
        <div className="mk-fl__callout-metric">
          <FloorMetric id={def.id} />
        </div>
        <div className="mk-fl__callout-foot">
          <span className={`mk-status mk-status--${status.toLowerCase()}`}>{status}</span>
          <span className="mk-dim">{def.robot} · ENTER ▶</span>
        </div>
      </div>
    </div>
  );
}

function Roof({ top }: { top: number }) {
  const w = W - 70;
  const d = D - 60;
  const f = box(w, RH, d);
  return (
    <div className="mk-fl mk-roof" style={{ transform: `translateY(${top + RH / 2}px)` }}>
      <Face w={w} h={RH} t={f.front} className="mk-face--roof">
        <span className="mk-roof__sign">MARKET TOWER</span>
      </Face>
      <Face w={d} h={RH} t={f.right} className="mk-face--roof" />
      <Face w={d} h={RH} t={f.left} className="mk-face--roof" />
      <Face w={w} h={RH} t={f.back} className="mk-face--roof" />
      <Face w={w} h={d} t={f.top} className="mk-face--roof-top" />
      <Face w={4} h={90} t={`translate3d(${w / 2 - 30}px, ${-RH / 2 - 45}px, 0)`} className="mk-face--antenna" />
      <Face w={10} h={10} t={`translate3d(${w / 2 - 30}px, ${-RH / 2 - 92}px, 0)`} className="mk-face--beacon" />
    </div>
  );
}

function Lobby({ y, open }: { y: number; open: boolean }) {
  const f = box(W, LH, D);
  return (
    <div className="mk-fl mk-lobby" style={{ transform: `translateY(${y}px)` }}>
      <Face w={W} h={LH} t={f.front} className="mk-face--lobby">
        <div className="mk-lobby__sign">MARKET DISTRICT · LOBBY</div>
        <div className="mk-lobby__door" />
      </Face>
      <Face w={D} h={LH} t={f.right} className="mk-face--lobby mk-face--lobby-side" />
      <Face w={D} h={LH} t={f.left} className="mk-face--lobby mk-face--lobby-side" />
      <Face w={W} h={LH} t={f.back} className="mk-face--lobby" />
      <Face w={W} h={D} t={f.top} className="mk-face--slab" />
      {/* plaza */}
      <Face w={W * 2.6} h={D * 2.6} t={`rotateX(90deg) translateZ(${-LH / 2}px)`} className={`mk-face--plaza ${open ? 'is-open' : ''}`} />
    </div>
  );
}

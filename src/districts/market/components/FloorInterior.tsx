// Inside the tower: elevator bar + an elevator shaft holding every floor stacked top → bottom.
// Switching floors slides the whole shaft, so going up the old floor drops away below and
// the new one comes down from above (and the reverse going down), passing floors in between.
import { useEffect, useRef, useState } from 'react';
import { useMarket } from '../state/useMarketDistrict';
import { FLOORS, type FloorDef } from '../buildings';
import type { BuildingId } from '../types';
import { Robot } from './Robot';
import { FloorMetric, ROBOT_IDLE_LINES } from './floorInfo';
import { ExchangePanel } from './ExchangePanel';
import { SignalPanel } from './SignalPanel';
import { PaperTradingPanel } from './PaperTradingPanel';
import { RiskPanel } from './RiskPanel';
import { BacktestPanel } from './BacktestPanel';
import { EventLog } from './EventLog';

const PANELS: Record<BuildingId, () => JSX.Element> = {
  exchange: ExchangePanel,
  signal: SignalPanel,
  trading: PaperTradingPanel,
  risk: RiskPanel,
  backtest: BacktestPanel,
};

/** Ride time: a base for doors/accel plus a bit per floor travelled. */
const rideMs = (floors: number) => 420 + floors * 260;

type Ride = { dir: 'up' | 'down'; ms: number } | null;

export function FloorInterior({ active }: { active: boolean }) {
  const { openBuilding, setOpenBuilding, setView, statuses } = useMarket();
  const target = Math.max(0, FLOORS.findIndex((f) => f.id === openBuilding)); // 0 until a floor is first opened
  const [ride, setRide] = useState<Ride>(null);
  const [display, setDisplay] = useState(target); // floor index shown on the elevator display
  const [arrived, setArrived] = useState(false);
  const prev = useRef(target);
  const timers = useRef<number[]>([]);
  // Ride duration must be on the track in the same commit as the new position, or the move would jump.
  // Only ride between floors while inside; entering from the tower jumps straight to the floor.
  const [lastTarget, setLastTarget] = useState(target);
  const [lastActive, setLastActive] = useState(active);
  const [trackMs, setTrackMs] = useState(0);
  if (lastTarget !== target || lastActive !== active) {
    setLastTarget(target);
    setLastActive(active);
    setTrackMs(active && lastActive && lastTarget !== target ? rideMs(Math.abs(target - lastTarget)) : 0);
  }
  const riding = trackMs > 0; // set in the same render as the new target

  const trackRef = useRef<HTMLDivElement>(null);
  const ridingRef = useRef(riding);
  ridingRef.current = riding;
  const raf = useRef(0);

  // Follow the track's real position each frame: drives the floor display and detects arrival,
  // so the display never runs ahead of what is on screen.
  useEffect(() => {
    const from = prev.current;
    if (from === target) return;
    prev.current = target;
    if (!ridingRef.current) {
      setDisplay(target);
      return;
    }
    cancelAnimationFrame(raf.current);
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setRide({ dir: target < from ? 'up' : 'down', ms: rideMs(Math.abs(target - from)) }); // lower index = higher floor
    setArrived(false);

    const arrive = () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(window.clearTimeout);
      setDisplay(target);
      setRide(null);
      setArrived(true);
      timers.current = [window.setTimeout(() => setArrived(false), 700)];
    };
    const tick = () => {
      const el = trackRef.current;
      const h = el?.parentElement?.clientHeight;
      if (!el || !h) return arrive();
      const pos = -new DOMMatrix(getComputedStyle(el).transform).m42 / h; // in floors
      setDisplay(Math.round(pos));
      if (Math.abs(pos - target) < 0.005) return arrive();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    timers.current.push(window.setTimeout(arrive, rideMs(Math.abs(target - from)) + 1500)); // safety net
  }, [target]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(window.clearTimeout);
    },
    [],
  );

  const def = FLOORS[target];
  const shown = FLOORS[display] ?? def;

  return (
    <section
      className={`mk-floor ${active ? 'is-active' : ''}`}
      style={{ ['--neon' as any]: def.neon }}
      aria-label={`${def.label} ${def.name}`}
      aria-hidden={!active}
      {...(!active ? { inert: '' } : {})}
    >
      <header className="mk-floor__bar">
        <button className="mk-btn mk-btn--ghost" onClick={() => setOpenBuilding(null)}>◀ ALL FLOORS</button>
        <div className="mk-elevator" role="group" aria-label="Elevator">
          <div
            className={`mk-elevator__display ${ride ? 'is-moving' : ''} ${arrived ? 'is-arrived' : ''}`}
            style={{ ['--neon' as any]: shown.neon }}
            aria-live="polite"
          >
            <span className="mk-elevator__arrow">{ride ? (ride.dir === 'up' ? '▲' : '▼') : '■'}</span>
            <span>{shown.label}</span>
          </div>
          {FLOORS.map((f) => (
            <button
              key={f.id}
              className={`mk-elevator__btn ${f.id === def.id ? (ride ? 'is-called' : 'is-here') : ''} mk-st--${statuses[f.id].toLowerCase()}`}
              style={{ ['--neon' as any]: f.neon }}
              onClick={() => setOpenBuilding(f.id)}
              title={f.name}
              aria-current={f.id === def.id && !ride ? 'true' : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button className="mk-btn mk-btn--ghost" onClick={() => setView('exterior')}>⌂ CITY</button>
      </header>

      <div className={`mk-shaft ${ride ? `is-riding is-riding--${ride.dir}` : ''}`}>
        <div
          ref={trackRef}
          className="mk-shaft__track"
          style={{
            transform: `translate3d(0, ${-target * 100}%, 0)`,
            transition: trackMs ? `transform ${trackMs}ms cubic-bezier(.65, 0, .35, 1)` : 'none',
          }}
        >
          {FLOORS.map((f, i) => {
            const here = i === target;
            return (
              <div
                key={f.id}
                className="mk-shaft__floor"
                style={{ ['--neon' as any]: f.neon }}
                aria-hidden={!here}
                {...(!here && !ride ? { inert: '' } : {})}
              >
                <FloorRoom def={f} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** One floor of the shaft: robot room on the left, feature console on the right. */
function FloorRoom({ def }: { def: FloorDef }) {
  const { statuses, events, reloadMarket, runSignal, selected } = useMarket();
  const [poked, setPoked] = useState(false);
  const status = statuses[def.id];
  const last = events.find((e) => e.building === def.id);
  const Panel = PANELS[def.id];

  // Clicking the robot runs the floor's safe primary task, or just says hello.
  const onRobot = () => {
    setPoked(true);
    if (def.id === 'exchange') reloadMarket();
    if (def.id === 'signal') runSignal(selected);
  };
  const robotHint =
    def.id === 'exchange' ? 'Click me to refresh the feed.' : def.id === 'signal' ? `Click me to analyze ${selected}.` : 'Use the console on the right.';
  const speech = poked && def.id !== 'exchange' && def.id !== 'signal' ? robotHint : last ? last.message : `${ROBOT_IDLE_LINES[def.id]} ${robotHint}`;

  return (
    <div className="mk-floor__body">
      <div className="mk-shaft__slab">
        <span>{def.label}</span>
        <span>{def.name.toUpperCase()}</span>
        <span>{def.label}</span>
      </div>
      <div className="mk-room">
        <div className="mk-room__floor" />
        <div className="mk-room__title">
          <span className="mk-room__lvl">{def.label}</span>
          <div>
            <div className="mk-room__name">{def.name}</div>
            <div className="mk-dim">{def.subtitle} · {def.role}</div>
          </div>
        </div>
        <div className="mk-room__screen">
          <div className="mk-dim">LIVE STATUS</div>
          <div className="mk-room__metric">
            <FloorMetric id={def.id} />
          </div>
          <span className={`mk-status mk-status--${status.toLowerCase()}`}>{status}</span>
        </div>
        <div className="mk-room__actor">
          <div className="mk-speech">
            <b>{def.robot}:</b> {speech}
          </div>
          <button className="mk-room__bot" onClick={onRobot} aria-label={`Talk to robot ${def.robot}`}>
            <Robot variant={def.bot} color={def.neon} status={status} size={120} />
          </button>
          <div className="mk-room__bot-name">{def.robot} · OPERATOR</div>
        </div>
      </div>

      <div className="mk-console">
        <div className="mk-console__head">
          <span>{def.label} CONSOLE</span>
          <span className={`mk-status mk-status--${status.toLowerCase()}`}>{status}</span>
        </div>
        <div className="mk-console__body">
          <Panel />
          <EventLog building={def.id} />
        </div>
      </div>
    </div>
  );
}

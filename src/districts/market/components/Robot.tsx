import type { BuildingStatus } from '../types';

export type RobotVariant = 'trader' | 'scientist' | 'worker' | 'guard' | 'archivist';

interface Props {
  variant: RobotVariant;
  color: string;
  status: BuildingStatus;
  /** Rendered width in px; height follows the 32×40 sprite ratio. */
  size?: number;
  className?: string;
}

// Shared palette. Shared class names (__body, __eye, __arm--l/r, __bulb, __core) drive the status animations in tower.css.
const DARK = '#1b1238';
const MID = '#2a1b52';
const LIGHT = '#3a2a66';
const COAT = '#d9d0ff';
const VOID = '#05030c';
const N = 'var(--bot)';

/** Pixel robot operator. Each floor has its own variant; animation follows the floor's task status. */
export function Robot({ variant, color, status, size = 48, className = '' }: Props) {
  return (
    <svg
      className={`mk-bot mk-bot--${variant} mk-bot--${status.toLowerCase()} ${className}`}
      style={{ ['--bot' as any]: color, width: size, height: (size * 40) / 32 }}
      viewBox="0 0 32 40"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <g className="mk-bot__body">{SPRITES[variant]}</g>
    </svg>
  );
}

/** QX-5 · Quant Exchange — monitor-headed trader with headphones and a live chart for a face. */
const trader = (
  <>
    <rect x="5" y="2" width="22" height="2" fill={MID} />
    <rect x="3" y="5" width="4" height="9" fill={N} />
    <rect x="25" y="5" width="4" height="9" fill={N} />
    <rect x="6" y="4" width="20" height="14" fill={DARK} stroke={N} strokeWidth="1" />
    <rect x="8" y="6" width="16" height="10" fill={VOID} />
    <g className="mk-bot__eye">
      <rect x="9" y="13" width="2" height="1" />
      <rect x="11" y="11" width="2" height="1" />
      <rect x="13" y="12" width="2" height="1" />
      <rect x="15" y="9" width="2" height="1" />
      <rect x="17" y="10" width="2" height="1" />
      <rect x="19" y="7" width="2" height="1" />
      <rect x="21" y="8" width="2" height="1" />
    </g>
    <rect className="mk-bot__bulb" x="22" y="16" width="2" height="1" />
    <rect x="14" y="18" width="4" height="2" fill={LIGHT} />
    <rect x="8" y="20" width="16" height="10" fill={DARK} stroke={N} strokeWidth="1" />
    <rect x="12" y="20" width="8" height="2" fill={COAT} />
    <rect className="mk-bot__core" x="15" y="22" width="2" height="6" />
    <g className="mk-bot__arm mk-bot__arm--l">
      <rect x="4" y="21" width="4" height="8" fill={MID} />
      <rect x="4" y="28" width="4" height="2" fill={N} />
    </g>
    <g className="mk-bot__arm mk-bot__arm--r">
      <rect x="24" y="21" width="4" height="8" fill={MID} />
      <rect x="24" y="28" width="4" height="2" fill={N} />
    </g>
    <rect x="11" y="30" width="3" height="7" fill={MID} />
    <rect x="18" y="30" width="3" height="7" fill={MID} />
    <rect x="10" y="37" width="5" height="3" fill={N} />
    <rect x="17" y="37" width="5" height="3" fill={N} />
  </>
);

/** SIG-4 · Signal Lab — glass-dome scientist with a glowing brain, cyclops eye, lab coat and a flask. */
const scientist = (
  <>
    <rect x="11" y="0" width="10" height="2" fill={MID} />
    <rect className="mk-bot__bulb" x="15" y="0" width="2" height="1" />
    <rect x="15" y="2" width="2" height="2" fill={LIGHT} />
    <rect x="11" y="4" width="10" height="2" fill={N} />
    <rect x="9" y="5" width="14" height="2" fill={N} />
    <rect x="8" y="6" width="16" height="11" fill={N} />
    <rect x="11" y="5" width="10" height="1" fill="#0a1a2e" />
    <rect x="9" y="6" width="14" height="10" fill="#0a1a2e" />
    <rect className="mk-bot__core" x="12" y="7" width="8" height="3" />
    <rect x="13" y="11" width="6" height="4" fill={VOID} />
    <rect className="mk-bot__eye" x="15" y="12" width="2" height="2" />
    <rect x="10" y="17" width="12" height="2" fill={LIGHT} />
    <rect x="7" y="19" width="18" height="12" fill={COAT} stroke={N} strokeWidth="1" />
    <rect x="15" y="19" width="2" height="12" fill={DARK} />
    <rect x="19" y="23" width="3" height="2" fill={N} />
    <g className="mk-bot__arm mk-bot__arm--l">
      <rect x="3" y="19" width="4" height="9" fill={COAT} />
      <rect x="3" y="27" width="4" height="2" fill={N} />
    </g>
    <g className="mk-bot__arm mk-bot__arm--r">
      <rect x="25" y="19" width="4" height="9" fill={COAT} />
      <rect x="25" y="27" width="4" height="2" fill={N} />
      <rect x="26" y="29" width="3" height="1" fill={LIGHT} />
      <rect className="mk-bot__core" x="25" y="30" width="5" height="3" />
    </g>
    <rect x="11" y="31" width="3" height="6" fill={MID} />
    <rect x="18" y="31" width="3" height="6" fill={MID} />
    <rect x="10" y="37" width="5" height="3" fill={LIGHT} />
    <rect x="17" y="37" width="5" height="3" fill={LIGHT} />
  </>
);

/** PT-3 · Paper Trading Hub — boxy desk clerk with a cap, clipboard and tank treads. */
const worker = (
  <>
    <rect x="7" y="3" width="18" height="4" fill={N} />
    <rect className="mk-bot__bulb" x="15" y="2" width="2" height="1" />
    <rect x="4" y="7" width="16" height="2" fill={N} opacity=".7" />
    <rect x="7" y="8" width="18" height="10" fill={DARK} stroke={N} strokeWidth="1" />
    <rect className="mk-bot__eye" x="10" y="11" width="3" height="3" />
    <rect className="mk-bot__eye" x="19" y="11" width="3" height="3" />
    <rect x="13" y="15" width="6" height="1" fill={N} opacity=".6" />
    <rect x="4" y="19" width="24" height="11" fill={DARK} stroke={N} strokeWidth="1" />
    <rect className="mk-bot__core" x="7" y="22" width="4" height="4" />
    <rect x="15" y="21" width="2" height="1" fill={N} opacity=".5" />
    <rect x="15" y="24" width="2" height="1" fill={N} opacity=".5" />
    <rect x="15" y="27" width="2" height="1" fill={N} opacity=".5" />
    <g className="mk-bot__arm mk-bot__arm--l">
      <rect x="1" y="19" width="3" height="9" fill={MID} />
      <rect x="1" y="27" width="3" height="2" fill={N} />
    </g>
    <g className="mk-bot__arm mk-bot__arm--r">
      <rect x="28" y="19" width="3" height="9" fill={MID} />
      <rect x="25" y="23" width="6" height="8" fill={COAT} />
      <rect x="26" y="25" width="4" height="1" fill={DARK} />
      <rect x="26" y="27" width="4" height="1" fill={DARK} />
      <rect x="26" y="29" width="3" height="1" fill={DARK} />
    </g>
    <rect x="6" y="30" width="20" height="1" fill={LIGHT} />
    <rect x="6" y="31" width="20" height="8" fill={MID} stroke={N} strokeWidth="1" />
    <rect x="8" y="33" width="3" height="4" fill={DARK} />
    <rect x="14" y="33" width="3" height="4" fill={DARK} />
    <rect x="20" y="33" width="3" height="4" fill={DARK} />
  </>
);

/** RSK-2 · Risk Office — armored guard with a siren, visor slit and shield. */
const guard = (
  <>
    <rect className="mk-bot__bulb" x="14" y="0" width="4" height="3" />
    <rect x="13" y="3" width="6" height="1" fill={LIGHT} />
    <rect x="6" y="4" width="20" height="14" fill={DARK} stroke={N} strokeWidth="1" />
    <rect x="5" y="8" width="22" height="2" fill={MID} />
    <rect x="9" y="11" width="14" height="2" fill={VOID} />
    <rect className="mk-bot__eye" x="11" y="11" width="3" height="2" />
    <rect className="mk-bot__eye" x="18" y="11" width="3" height="2" />
    <rect x="10" y="15" width="12" height="2" fill={MID} />
    <rect x="5" y="19" width="22" height="12" fill={DARK} stroke={N} strokeWidth="1" />
    <rect x="9" y="21" width="14" height="7" fill={MID} />
    <rect className="mk-bot__core" x="14" y="22" width="4" height="4" />
    <g className="mk-bot__arm mk-bot__arm--l">
      <rect x="2" y="18" width="6" height="4" fill={N} />
      <rect x="2" y="22" width="4" height="7" fill={MID} />
      <rect x="0" y="23" width="6" height="11" fill={DARK} stroke={N} strokeWidth="1" />
      <rect x="2" y="25" width="2" height="7" fill={N} />
    </g>
    <g className="mk-bot__arm mk-bot__arm--r">
      <rect x="24" y="18" width="6" height="4" fill={N} />
      <rect x="26" y="22" width="4" height="8" fill={MID} />
      <rect x="26" y="30" width="4" height="2" fill={N} />
    </g>
    <rect x="8" y="31" width="6" height="6" fill={MID} />
    <rect x="18" y="31" width="6" height="6" fill={MID} />
    <rect x="7" y="37" width="8" height="3" fill={N} />
    <rect x="17" y="37" width="8" height="3" fill={N} />
  </>
);

/** BT-1 · Backtest Vault — hovering archive orb with a big lens, a data cassette and a thruster. */
const archivist = (
  <>
    <rect x="15" y="3" width="2" height="2" fill={LIGHT} />
    <rect className="mk-bot__bulb" x="14" y="1" width="4" height="2" />
    <rect x="11" y="4" width="10" height="1" fill={N} />
    <rect x="8" y="5" width="16" height="1" fill={N} />
    <rect x="6" y="6" width="20" height="2" fill={N} />
    <rect x="5" y="8" width="22" height="14" fill={N} />
    <rect x="6" y="22" width="20" height="2" fill={N} />
    <rect x="8" y="24" width="16" height="1" fill={N} />
    <rect x="11" y="25" width="10" height="1" fill={N} />
    <rect x="12" y="5" width="8" height="1" fill={DARK} />
    <rect x="9" y="6" width="14" height="1" fill={DARK} />
    <rect x="7" y="7" width="18" height="1" fill={DARK} />
    <rect x="6" y="8" width="20" height="14" fill={DARK} />
    <rect x="7" y="22" width="18" height="1" fill={DARK} />
    <rect x="9" y="23" width="14" height="1" fill={DARK} />
    <rect x="12" y="24" width="8" height="1" fill={DARK} />
    <rect x="10" y="9" width="12" height="10" fill={MID} />
    <rect x="12" y="11" width="8" height="6" fill={VOID} />
    <rect x="16" y="12" width="1" height="2" fill={N} opacity=".6" />
    <rect className="mk-bot__eye" x="15" y="13" width="2" height="2" />
    <rect x="9" y="20" width="14" height="1" fill={N} opacity=".5" />
    <g className="mk-bot__arm mk-bot__arm--l">
      <rect x="2" y="13" width="3" height="6" fill={MID} />
      <rect x="1" y="18" width="3" height="2" fill={N} />
    </g>
    <g className="mk-bot__arm mk-bot__arm--r">
      <rect x="27" y="13" width="3" height="6" fill={MID} />
      <rect x="25" y="19" width="7" height="4" fill={COAT} />
      <rect x="26" y="20" width="1" height="2" fill={DARK} />
      <rect x="30" y="20" width="1" height="2" fill={DARK} />
    </g>
    <rect x="13" y="26" width="6" height="2" fill={MID} />
    <rect className="mk-bot__core mk-bot__flame" x="14" y="28" width="4" height="4" />
    <rect className="mk-bot__core mk-bot__flame" x="15" y="32" width="2" height="3" />
  </>
);

const SPRITES: Record<RobotVariant, JSX.Element> = { trader, scientist, worker, guard, archivist };

import { useMemo, useState } from 'react';
import type { PricePoint } from '../types';
import { fmtPrice } from '../services/money';
import { sma } from '../services/signalService';

interface Props {
  points: PricePoint[];
  color?: string;
  /** Overlay SMA lines, e.g. [12, 48]. */
  smaWindows?: number[];
  height?: number;
  valueFormat?: (v: number) => string;
}

const W = 600;
const PAD = { l: 8, r: 64, t: 12, b: 22 };
const SMA_COLORS = ['#ff4fd8', '#ffd84f'];

export function PriceChart({ points, color = '#29f0ff', smaWindows = [], height = 220, valueFormat = fmtPrice }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.price);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`;
    const smas = smaWindows.map((w) => {
      let d = '';
      for (let i = w - 1; i < vals.length; i++) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(sma(vals, w, i)).toFixed(1)}`;
      return { w, d };
    });
    return { min, max, x, y, line, area, smas };
  }, [points, smaWindows, H]);

  if (!geo) return <div className="mk-chart mk-chart--empty">NO DATA</div>;
  const up = points[points.length - 1].price >= points[0].price;
  const stroke = color === 'auto' ? (up ? 'var(--mk-up)' : 'var(--mk-down)') : color;
  const gid = `g${Math.round(points[0].t % 1e6)}${stroke.length}`;
  const hp = hover != null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="mk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Price chart">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const yy = PAD.t + f * (H - PAD.t - PAD.b);
          const v = geo.max - f * (geo.max - geo.min);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} className="mk-chart__grid" />
              <text x={W - PAD.r + 6} y={yy + 4} className="mk-chart__axis">{valueFormat(v)}</text>
            </g>
          );
        })}
        <path d={geo.area} fill={`url(#${gid})`} />
        {geo.smas.map((s, i) => (
          <path key={s.w} d={s.d} fill="none" stroke={SMA_COLORS[i % 2]} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85" />
        ))}
        <path d={geo.line} fill="none" stroke={stroke} strokeWidth="2" className="mk-chart__line" />
        <text x={PAD.l} y={H - 6} className="mk-chart__axis">{fmtTime(points[0].t)}</text>
        <text x={W - PAD.r} y={H - 6} className="mk-chart__axis" textAnchor="end">{fmtTime(points[points.length - 1].t)}</text>
        {hp && (
          <g>
            <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={PAD.t} y2={H - PAD.b} className="mk-chart__cross" />
            <circle cx={geo.x(hover!)} cy={geo.y(hp.price)} r="4" fill={stroke} />
          </g>
        )}
      </svg>
      <div className="mk-chart__legend">
        {hp ? (
          <span>{fmtTime(hp.t)} · <b>{valueFormat(hp.price)}</b></span>
        ) : (
          <span>Hover chart for values</span>
        )}
        {smaWindows.map((w, i) => (
          <span key={w} style={{ color: SMA_COLORS[i % 2] }}>— SMA{w}</span>
        ))}
      </div>
    </div>
  );
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

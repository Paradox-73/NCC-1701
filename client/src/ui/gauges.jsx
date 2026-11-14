import { useEffect, useRef } from 'react';
import { CHANNEL_BY_KEY } from '@ncc/shared/schema.js';
import { reducedMotion } from '../lib/chartTheme.js';
import { alarmOf, limitsOf } from '../lib/limits.js';
import { onFrame } from '../lib/raf.js';
import { cx } from './controls.jsx';
import { Num, decOf, fmt, useTween } from './Readout.jsx';
import { THEME } from './theme.js';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const levelColor = (l) => (l === 'crit' ? THEME.crit : l === 'warn' ? THEME.warn : null);
const RAD = Math.PI / 180;

// The warn and critical limits of a channel that fall strictly inside [lo, hi], as [value, 'w' | 'c'].
function limitTicks(k, lo, hi) {
  const lim = limitsOf(k);
  const out = [];
  for (const side of ['high', 'low']) if (lim?.[side]) for (const [v, c] of [[lim[side].warn, 'w'], [lim[side].critical, 'c']]) if (v > lo && v < hi) out.push([v, c]);
  return out;
}

const polar = (x, y, r, deg) => [x + r * Math.sin(deg * RAD), y - r * Math.cos(deg * RAD)];
const arcPath = (x, y, r, a0, a1) => {
  const [x0, y0] = polar(x, y, r, a0), [x1, y1] = polar(x, y, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/**
 * A 240° arc with a needle that eases to each value (warp factor, crystal efficiency). With a channel `k` its warn
 * and critical zones are dashed round the outside and the arc takes their colour past a limit. The number sits under
 * the arc with `below`, otherwise inside its opening.
 */
export function ArcGauge({ value, k, min, max, ticks = [], label, unit, dec, numClass = 'arc__num', tickDec = 0, below = false }) {
  const m = CHANNEL_BY_KEY[k];
  const lo = min ?? m?.min ?? 0, hi = max ?? m?.max ?? 100;
  const level = alarmOf(k, value);
  const ang = (x) => -120 + clamp((x - lo) / (hi - lo)) * 240;
  const needle = useRef(null), fill = useRef(null);
  const R = 84, X = 100, Y = 100, L = (Math.PI * R * 240) / 180;
  useTween(value ?? lo, 600, (x) => {
    needle.current?.setAttribute('transform', `rotate(${ang(x)} ${X} ${Y})`);
    fill.current?.setAttribute('stroke-dashoffset', String(L * (1 - clamp((x - lo) / (hi - lo)))));
  });
  const lim = limitsOf(k);
  const zones = [];
  if (lim?.high) zones.push([lim.high.warn, lim.high.critical, THEME.warn], [lim.high.critical, hi, THEME.crit]);
  if (lim?.low) zones.push([lim.low.warn, lim.low.critical, THEME.warn], [lo, lim.low.critical, THEME.crit]);
  const u = unit ?? m?.unit;
  return (
    <div className={cx('arc', below && 'arc--below')} data-level={level ?? undefined}>
      <svg className="arc__dial" viewBox={below ? '0 0 200 150' : '0 0 200 168'} role="img"
        aria-label={`${label ?? m?.label ?? 'Gauge'}: ${value == null ? 'no reading' : fmt(value, dec ?? decOf(k))} ${u ?? ''}`}>
        <path d={arcPath(X, Y, R, -120, 120)} fill="none" stroke="#ffffff12" strokeWidth="10" strokeLinecap="round" />
        <path ref={fill} d={arcPath(X, Y, R, -120, 120)} fill="none" stroke={levelColor(level) ?? THEME.chart1} strokeOpacity="0.85" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${L} ${L}`} strokeDashoffset={L} />
        {zones.map(([a, b, col]) => {
          const x0 = Math.min(a, b), x1 = Math.max(a, b);
          if (x1 <= lo || x0 >= hi) return null;
          return <path key={`${a}${col}`} d={arcPath(X, Y, R + 11, ang(Math.max(lo, x0)), ang(Math.min(hi, x1)))} fill="none" stroke={col} strokeWidth="3" strokeDasharray="3 2" />;
        })}
        {ticks.map((t) => {
          const [x0, y0] = polar(X, Y, R - 9, ang(t)), [x1, y1] = polar(X, Y, R - 16, ang(t)), [tx, ty] = polar(X, Y, R - 27, ang(t));
          return (
            <g key={t}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={THEME.mute} strokeWidth="1.5" />
              <text x={tx} y={ty + 3.5} textAnchor="middle" fontSize="10" fill={THEME.mute}>{fmt(t, tickDec)}</text>
            </g>
          );
        })}
        <g ref={needle} transform={`rotate(-120 ${X} ${Y})`}>
          <path d={`M${X - 3} ${Y} L${X} ${Y - R + 4} L${X + 3} ${Y} Z`} fill={THEME.ink} />
        </g>
        <circle cx={X} cy={Y} r="7" fill={THEME.raised} stroke={THEME.bulkhead} />
      </svg>
      <div className="arc__read">
        <Num value={value} dec={dec ?? decOf(k)} className={numClass} level={level} />
        {u ? <span className="unit">{u}</span> : null}
      </div>
    </div>
  );
}

/** Vertical segmented bar with the channel's limit ticks (nacelle output, phaser banks, sensor arrays). */
export function BarGauge({ value, k, label, min, max, unit, dec, segs = 16, h = 120, showValue = true }) {
  const m = CHANNEL_BY_KEY[k];
  const lo = min ?? m?.min ?? 0, hi = max ?? m?.max ?? 100;
  const level = alarmOf(k, value);
  const on = value == null ? 0 : Math.round(clamp((value - lo) / (hi - lo)) * segs);
  const u = unit ?? m?.unit;
  return (
    <div className="bar" data-level={level ?? undefined} role="meter" aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={value ?? undefined}
      aria-label={`${label ?? m?.label}${value == null ? ', no reading' : `, ${fmt(value, dec ?? decOf(k))} ${u ?? ''}`}`}>
      {showValue && <span className="bar__val"><Num value={value} dec={dec ?? decOf(k)} /><span className="unit">{u}</span></span>}
      <div className="bar__col" style={{ height: h }}>
        {Array.from({ length: segs }, (_, i) => <i key={i} className={cx('bar__seg', i < on && 'on')} />)}
        {limitTicks(k, lo, hi).map(([v, c]) => <b key={`${c}${v}`} className={`bar__tick ${c}`} style={{ bottom: `${((v - lo) / (hi - lo)) * 100}%` }} />)}
      </div>
      {label && <span className="bar__lab">{label}</span>}
    </div>
  );
}

/** A thin horizontal bar from `min` to `max` (impulse, generator load, battery). */
export function HBar({ value, k, min = 0, max = 100, label }) {
  const level = alarmOf(k, value);
  return (
    <div className="hbar" data-level={level ?? undefined} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value ?? undefined} aria-label={label}>
      <i style={{ width: `${value == null ? 0 : clamp((value - min) / (max - min)) * 100}%` }} />
    </div>
  );
}

/**
 * Round sensor scope: a sweep turns once every 4 s and blips brighten as it passes, then fade.
 * contacts: [{ bearing (deg, 0 = ahead), range (0 centre to 1 rim), cloaked? }]. Canvas, on the shared loop.
 */
export function SweepScope({ contacts = [], className, label = 'Sensor scope' }) {
  const host = useRef(null);
  const canvas = useRef(null);
  const data = useRef(contacts);
  data.current = contacts;
  useEffect(() => {
    const el = canvas.current;
    const box = host.current; // held here: the ref is already null when a last resize lands during unmount
    const ctx = el.getContext('2d');
    let size = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = box.clientWidth;
      el.width = el.height = Math.max(1, Math.round(size * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    const still = reducedMotion();
    let lastStill = -1e9;
    const draw = (t) => {
      if (!size || document.hidden) return;
      if (still) { if (t - lastStill < 2000) return; lastStill = t; }
      const r = size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(r, r);
      // rings and cross
      ctx.strokeStyle = '#58c4ff2e';
      ctx.lineWidth = 1;
      for (const f of [0.33, 0.66, 0.97]) { ctx.beginPath(); ctx.arc(0, 0, r * f, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      // sweep: one turn per 4 s, 0 = ahead (up)
      const a = still ? -Math.PI / 2 + 1 : ((t / 4000) % 1) * Math.PI * 2 - Math.PI / 2;
      const trail = ctx.createConicGradient(a - 1.4, 0, 0);
      trail.addColorStop(0, '#58c4ff00');
      trail.addColorStop(0.22, '#58c4ff40');
      trail.addColorStop(0.2228, '#58c4ff00');
      ctx.fillStyle = trail;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * 0.97, a - 1.4, a); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9fdcff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97); ctx.stroke();
      // blips: bright right after the sweep passes their bearing
      for (const c of data.current) {
        const b = (c.bearing - 90) * RAD;
        const since = (((a - b) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); // radians since the sweep passed
        let glow = still ? 0.8 : Math.exp(-since * 0.9);
        if (c.cloaked) glow *= Math.random() < 0.45 ? 0 : 0.35; // faint and broken
        const x = Math.cos(b) * r * 0.97 * clamp(c.range, 0, 1);
        const y = Math.sin(b) * r * 0.97 * clamp(c.range, 0, 1);
        ctx.fillStyle = `rgba(255, 214, 120, ${0.15 + 0.85 * glow})`;
        ctx.shadowColor = '#ffd36a';
        ctx.shadowBlur = 8 * glow;
        ctx.beginPath(); ctx.arc(x, y, 2.5 + 2 * glow, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      // own ship at the centre
      ctx.fillStyle = '#e8f4ff';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    const off = onFrame(draw);
    return () => { off(); ro.disconnect(); };
  }, []);
  return (
    <div ref={host} className={cx('scope', className)} role="img" aria-label={`${label}: ${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}>
      <canvas ref={canvas} />
    </div>
  );
}

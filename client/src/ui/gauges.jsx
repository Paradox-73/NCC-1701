import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/chartTheme.js';
import { onFrame } from '../lib/raf.js';
import { cx } from './controls.jsx';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const RAD = Math.PI / 180;
const CX = 100, CY = 100, R = 78;
const pt = (a, r = R) => [CX + r * Math.cos(a * RAD), CY + r * Math.sin(a * RAD)];
const arcPath = (a0, a1, r = R) => {
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/**
 * A 240 degree arc with a needle that eases to each new value (warp factor 0-9, reactor output).
 * ticks: values that get a tick and a number. band: the normal band [lo, hi], drawn under the arc.
 */
export function ArcGauge({ value, min = 0, max = 9, ticks, band, status = 'ok', label, className, children }) {
  const needle = useRef(null);
  const fill = useRef(null);
  const st = useRef({ shown: clamp(value, min, max), off: null });
  const angle = (v) => 150 + (240 * (clamp(v, min, max) - min)) / (max - min || 1);
  const draw = (v) => {
    const a = angle(v);
    needle.current?.setAttribute('transform', `rotate(${a.toFixed(2)} ${CX} ${CY})`);
    fill.current?.setAttribute('d', a - 150 < 0.5 ? '' : arcPath(150, a));
  };
  useEffect(() => {
    const s = st.current;
    const to = clamp(value, min, max);
    s.off?.();
    if (reducedMotion()) { s.shown = to; draw(to); return undefined; }
    const from = s.shown;
    const t0 = performance.now();
    s.off = onFrame((t) => {
      const k = Math.min(1, (t - t0) / 700);
      s.shown = from + (to - from) * (1 - (1 - k) ** 3);
      draw(s.shown);
      if (k >= 1) { s.off(); s.off = null; }
    });
    return () => { s.off?.(); s.off = null; };
  }, [value, min, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const tickList = ticks ?? Array.from({ length: Math.round(max - min) + 1 }, (_, i) => min + i);
  return (
    <svg className={cx('arc', className)} viewBox="0 0 200 172" data-status={status} role="img" aria-label={`${label ?? 'Gauge'}: ${value == null ? 'no signal' : value}`}>
      <path className="track" d={arcPath(150, 390)} strokeWidth="10" />
      {band && <path className="band" d={arcPath(angle(band[0]), angle(band[1]), R + 9)} strokeWidth="3" />}
      <path ref={fill} className="fill" d="" strokeWidth="10" />
      {tickList.map((v) => {
        const a = angle(v);
        const [x0, y0] = pt(a, R - 12);
        const [x1, y1] = pt(a, R - 20);
        const [lx, ly] = pt(a, R - 31);
        return (
          <g key={v}>
            <line className="tick major" x1={x0} y1={y0} x2={x1} y2={y1} />
            <text className="ticklabel" x={lx} y={ly}>{v}</text>
          </g>
        );
      })}
      <line ref={needle} className="needle" x1={CX} y1={CY} x2={CX + R - 8} y2={CY} transform={`rotate(${angle(st.current.shown)} ${CX} ${CY})`} />
      <circle className="hub" cx={CX} cy={CY} r="6" />
      {children}
    </svg>
  );
}

/**
 * Vertical segmented bar with limit ticks (nacelle output, shield quadrants, deck oxygen).
 * warn / crit: limit values drawn as dashed ticks.
 */
export function BarGauge({ value, min = 0, max = 100, segments = 16, warn, crit, status = 'ok', label, dec = 0, unit = '' }) {
  const k = value == null ? 0 : (clamp(value, min, max) - min) / (max - min || 1);
  const on = Math.round(k * segments);
  const at = (v) => `${(((clamp(v, min, max) - min) / (max - min || 1)) * 100).toFixed(1)}%`;
  return (
    <div className="bar" data-status={status} role="img" aria-label={`${label}: ${value == null ? 'no signal' : `${value.toFixed(dec)} ${unit}`}`}>
      <div className="bar__track">
        {Array.from({ length: segments }, (_, i) => <span key={i} className={cx('bar__seg', i < on && 'on')} />)}
        {warn != null && <span className="bar__limit" style={{ bottom: at(warn) }} />}
        {crit != null && <span className="bar__limit crit" style={{ bottom: at(crit) }} />}
      </div>
      <span className="bar__value">{value == null ? '—' : value.toFixed(dec)}</span>
      {label && <span className="bar__label">{label}</span>}
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
    const ctx = el.getContext('2d');
    let size = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = host.current.clientWidth;
      el.width = el.height = Math.max(1, Math.round(size * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host.current);
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

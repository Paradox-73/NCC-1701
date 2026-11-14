import { isValidElement, useEffect, useLayoutEffect, useRef } from 'react';
import { CHANNEL_BY_KEY } from '@ncc/shared/schema.js';
import { reducedMotion } from '../lib/chartTheme.js';
import { onFrame } from '../lib/raf.js';
import { LevelChip, cx } from './controls.jsx';
import { Icon } from './icons.jsx';

const formats = new Map();
/** A number with `dec` decimals in en-US grouping, or a dash when there is none. */
export function fmt(v, dec = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  let f = formats.get(dec);
  if (!f) formats.set(dec, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })));
  return f.format(v);
}
/** The decimals a channel's readings carry, from its scale in the registry. */
export const decOf = (key) => { const s = CHANNEL_BY_KEY[key]?.scale ?? 1; return s >= 100 ? 2 : s >= 10 ? 1 : 0; };

/** Eases from the last value to `v` over `ms` on the shared animation loop, calling apply(x) every frame. Reduced motion jumps. */
export function useTween(v, ms, apply) {
  const cur = useRef(null);
  const ap = useRef(apply);
  ap.current = apply;
  useLayoutEffect(() => {
    const from = cur.current;
    if (!Number.isFinite(v) || !Number.isFinite(from) || from === v || reducedMotion()) { cur.current = v; ap.current(v); return undefined; }
    const t0 = performance.now();
    const off = onFrame((t) => {
      const k = Math.min(1, (t - t0) / ms);
      const x = from + (v - from) * (1 - (1 - k) ** 3);
      cur.current = x;
      ap.current(x);
      if (k === 1) off();
    });
    return off;
  }, [v, ms]);
}

/**
 * A number that ticks to each new value in 240 ms. React never renders the digits, so a tick costs no re-render.
 * level: warn | crit colours it (and a word must stand next to it).
 */
export function Num({ value, dec = 0, ms = 240, className, level }) {
  const ref = useRef(null);
  useTween(value, ms, (x) => { if (ref.current) ref.current.textContent = fmt(x, dec); });
  return <span ref={ref} className={cx('num', className)} data-level={level === 'warn' || level === 'crit' ? level : undefined} />;
}

/**
 * A 60 s sparkline with the normal band. data: [xs, ys] (as Ring.window returns) or a plain array of ys.
 * domain: [min, max] of the y axis (defaults to the data plus the band).
 */
export function Sparkline({ data, band, domain, status, className }) {
  const ys = !data ? [] : Array.isArray(data[0]) || ArrayBuffer.isView(data[0]) ? data[1] : data;
  const n = ys?.length ?? 0;
  let lo = domain?.[0];
  let hi = domain?.[1];
  if (lo == null || hi == null) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { if (ys[i] < mn) mn = ys[i]; if (ys[i] > mx) mx = ys[i]; }
    if (band) { mn = Math.min(mn, band[0]); mx = Math.max(mx, band[1]); }
    const pad = (mx - mn) * 0.15 || 1;
    lo = lo ?? mn - pad;
    hi = hi ?? mx + pad;
  }
  const W = 120, H = 28;
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H;
  // at most 90 points: one per few hundred ms of the minute is plenty at this size
  const step = Math.max(1, Math.floor(n / 90));
  let d = '';
  for (let i = 0; i < n; i += step) d += `${d ? 'L' : 'M'}${((i / Math.max(1, n - 1)) * W).toFixed(1)} ${y(ys[i]).toFixed(1)}`;
  if (n > 1 && (n - 1) % step) d += `L${W} ${y(ys[n - 1]).toFixed(1)}`;
  const bandY = band && [Math.max(0, Math.min(H, y(band[1]))), Math.max(0, Math.min(H, y(band[0])))];
  return (
    <svg className={cx('spark', className)} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-status={status} aria-hidden="true">
      {bandY && <rect className="band" x="0" y={bandY[0]} width={W} height={Math.max(0, bandY[1] - bandY[0])} />}
      {d && <path className="line" d={d} />}
    </svg>
  );
}

/**
 * Label, big ticking number, unit, change arrow, the level word and a sparkline. status: ok | warn | crit | off; past
 * a limit the number takes the colour and a word (YELLOW, RED) stands next to it, so colour never carries meaning
 * alone. spark: data for the SVG sparkline, or an element drawn in its place. size: sm | lg.
 */
export function Readout({ label, title, value, unit, dec = 0, status = 'ok', trend, spark, band, domain, size, className }) {
  const ref = useRef(null);
  const prev = useRef(status);
  useEffect(() => {
    // crossing into a limit flashes the reading once
    if (prev.current !== status && (status === 'warn' || status === 'crit') && ref.current) {
      ref.current.classList.remove('is-crossed'); void ref.current.offsetWidth; ref.current.classList.add('is-crossed');
    }
    prev.current = status;
  }, [status]);
  return (
    <div ref={ref} className={cx('readout', size && `readout--${size}`, className)} data-status={status}>
      <span className="readout__label" title={title}>{label}</span>
      <span className="readout__value">
        <Num className="readout__num" value={status === 'off' ? null : value} dec={dec} />
        {unit && <span className="readout__unit">{unit}</span>}
        {trend ? <Icon name={trend > 0 ? 'up' : 'down'} className="readout__trend" title={trend > 0 ? 'Rising' : 'Falling'} /> : null}
      </span>
      <span className="readout__word"><LevelChip level={status} /></span>
      {spark && <div className="readout__spark">{isValidElement(spark) ? spark : <Sparkline data={spark} band={band} domain={domain} status={status} />}</div>}
    </div>
  );
}

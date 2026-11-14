import { useEffect, useLayoutEffect, useRef } from 'react';
import { reducedMotion } from '../lib/chartTheme.js';
import { LEVEL_WORD } from '../lib/limits.js';
import { onFrame } from '../lib/raf.js';
import { cx } from './controls.jsx';
import { Icon } from './icons.jsx';

const fmt = (v, dec) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const ease = (t) => 1 - (1 - t) ** 3;

/**
 * A number that ticks to each new value in 240 ms, on the shared animation loop. React never renders the digits,
 * so a tick costs no re-render. Reduced motion jumps straight to the value.
 */
export function Num({ value, dec = 0, ms = 240, className }) {
  const el = useRef(null);
  const st = useRef({ shown: value, from: value, to: value, t0: 0, off: null });
  useLayoutEffect(() => { if (el.current) el.current.textContent = fmt(st.current.shown, dec); }, [dec]);
  useEffect(() => {
    const s = st.current;
    const valid = value != null && !Number.isNaN(value);
    const prevValid = s.shown != null && !Number.isNaN(s.shown);
    if (!valid || !prevValid || reducedMotion() || Math.abs(value - s.shown) < 10 ** -dec / 2) {
      s.shown = value;
      if (el.current) el.current.textContent = fmt(value, dec);
      return undefined;
    }
    s.from = s.shown;
    s.to = value;
    s.t0 = performance.now();
    s.off?.();
    s.off = onFrame((t) => {
      const k = Math.min(1, (t - s.t0) / ms);
      s.shown = s.from + (s.to - s.from) * ease(k);
      if (el.current) el.current.textContent = fmt(s.shown, dec);
      if (k >= 1) { s.off(); s.off = null; }
    });
    return undefined;
  }, [value, dec, ms]);
  useEffect(() => () => st.current.off?.(), []);
  return <span ref={el} className={cx('num', className)} />;
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
 * Label, big ticking number, unit, change arrow and sparkline. status: ok | warn | crit | off; past a limit the
 * number takes the colour and a word (YELLOW, RED) stands next to it, so colour never carries meaning alone.
 */
export function Readout({ label, value, unit, dec = 0, status = 'ok', trend, spark, band, domain, size, className }) {
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
      <span className="readout__label">{label}</span>
      <span className="readout__value">
        <Num className="readout__num" value={status === 'off' ? null : value} dec={dec} />
        {unit && <span className="readout__unit">{unit}</span>}
        {trend ? <Icon name={trend > 0 ? 'up' : 'down'} className="readout__trend" /> : null}
      </span>
      {LEVEL_WORD[status] ? <span className="readout__word">{LEVEL_WORD[status]}</span> : <span />}
      {spark && <div style={{ gridColumn: '1 / -1' }}><Sparkline data={spark} band={band} domain={domain} status={status} /></div>}
    </div>
  );
}

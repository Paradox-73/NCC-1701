// What the stations add to the bridge design system (client/src/ui): readouts that read a channel straight from the
// store's ring buffers, the canvas sparkline and canvas loop they draw with, and the canvas colours. Every component
// with a look of its own (LitButton, Jewel, Monitor, ConsoleStrip, Station, gauges, chips) comes from ../../ui.
import { useEffect, useRef } from 'react';
import { reducedMotion } from '../../lib/chartTheme.js';
import { onFrame } from '../../lib/raf.js';
import { LevelChip, Num, Readout as Reading, THEME, Trace, decOf } from '../../ui/index.js';
import { levelOf, meta, read, readAgo } from './data.js';
import './stations.css';

// canvas colours: the design tokens (ui/theme.js)
export const C = { ...THEME, amber: THEME.lit.amber };
export const levelColor = (l) => (l === 'crit' ? C.crit : l === 'warn' ? C.warn : null);
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export { decOf, fmt } from '../../ui/index.js';

/** uPlot y-range for a channel: the data's range, but never narrower than 5 % of the channel's span. */
export const calmRange = (key) => {
  const m = meta(key);
  const min = m ? (m.max - m.min) * 0.05 : 0;
  return (u, lo, hi) => {
    if (lo == null) return [0, 1];
    const mid = (lo + hi) / 2, half = Math.max((hi - lo) * 0.6, min / 2, 1e-6);
    return [mid - half, mid + half];
  };
};

/** Calls draw(ctx, w, h, t) in the shared frame loop at most every `every` ms, on a canvas sized to its box. */
export function useCanvas(draw, deps = [], every = 33) {
  const ref = useRef(null);
  const d = useRef(draw);
  d.current = draw;
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    let last = 0;
    return onFrame((t) => {
      if (t - last < (reducedMotion() ? Math.max(every, 1000) : every)) return;
      last = t;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      d.current(ctx, w, h, t);
    });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** A channel's value with its unit, coloured past a limit and then always followed by the level's word. */
export function Val({ src, k, v, dec, unit }) {
  const m = meta(k);
  const x = v !== undefined ? v : read(src, k);
  const level = levelOf(k, x);
  return (
    <>
      <Num value={x} dec={dec ?? decOf(k)} level={level} />
      {(unit ?? m?.unit) ? <span className="unit">{unit ?? m.unit}</span> : null}
      {level && <> <LevelChip level={level} /></>}
    </>
  );
}

/** The kit's Readout for one channel of a source: label, ticking number, unit, the change over 5 s and a canvas sparkline. */
export function Readout({ src, k, label, unit, dec, size, spark = true, ms = 60000, value, sparkH = 30 }) {
  const m = meta(k);
  const v = value !== undefined ? value : read(src, k);
  const ago = readAgo(src, k, 5000);
  const span = m ? (m.max - m.min) * 0.004 : 0;
  const trend = v == null || ago == null || Math.abs(v - ago) <= span ? 0 : Math.sign(v - ago);
  return (
    <Reading label={label ?? m?.label ?? k} title={m?.label} value={v} unit={unit ?? m?.unit} dec={dec ?? decOf(k)} size={size}
      status={v == null ? 'off' : levelOf(k, v) ?? 'ok'} trend={trend} spark={spark && <Spark src={src} k={k} ms={ms} h={sparkH} />} />
  );
}

/** A channel's last `ms` as a small chart: the kit's Trace (client/src/ui), `h` px tall. */
export const Spark = ({ src, k, ms = 60000, h = 30 }) => <Trace src={src} k={k} ms={ms} className="st-spark" style={{ height: h }} />;

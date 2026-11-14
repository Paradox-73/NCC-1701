import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { chartColors, chartFont, reducedMotion } from '../lib/chartTheme.js';
import { onFrame } from '../lib/raf.js';

const clock = (s) => new Date(s * 1000).toLocaleTimeString([], { hour12: false });
const fmtVal = (v, dec = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }));

// uPlot with these rules: 2px lines, no vertical grid, axis text in a muted colour, a hover readout listing every
// series at the pointer, a legend only for two or more series. Two ways to feed it:
//  - getData(): called inside the shared animation-frame loop (at most ~30 times a second);
//    return aligned arrays [xs, ...ys] to redraw or null when nothing changed.
//  - data: static arrays, redrawn when the prop changes.
// series: [{ label, color, width?, fill?, fillTo?, step?, dec?, unit? }] (the x series is added here)
// x: 'time' (clock), 'ago' (seconds before now), 'num' (plain numbers), or a format function.
// Styling lives in the .chart-* classes (index.css) and the --chart-* CSS variables (lib/chartTheme.js).
export default function Chart({ series, getData, data, height = 150, fill = false, x = 'time', xRange, yRange, title, unit = '', legend = series.length > 1, sync, showX = true, wait = 'Loading readings' }) {
  const wrap = useRef(null);
  const host = useRef(null);
  const plot = useRef(null);
  const getRef = useRef(getData);
  getRef.current = getData;
  const real = useRef(false); // false while the plot holds its placeholder points
  const [ready, setReady] = useState(false); // the placeholder's axes (0 to 1, the epoch) stay under a plate until then
  const revealRef = useRef(() => {});

  useEffect(() => {
    const el = host.current;
    const C = chartColors();
    const axis = (extra) => ({ stroke: C.mute, grid: { stroke: C.grid, width: 1 }, ticks: { show: false }, font: `500 12px ${chartFont()}`, size: 44, gap: 6, ...extra });
    const hOf = () => (fill ? Math.max(70, el.clientHeight) : height);
    const fx = typeof x === 'function' ? x : x === 'num' ? (v) => fmtVal(v) : clock;

    // hover readout: one box listing every series at the pointer's x, written straight to the DOM
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    const head = document.createElement('div');
    head.className = 't';
    tip.appendChild(head);
    const lines = series.map((s) => {
      const r = document.createElement('div');
      r.className = 'r';
      const key = document.createElement('i');
      key.style.background = s.color;
      const val = document.createElement('b');
      const name = document.createElement('span');
      name.textContent = s.label;
      r.append(key, val, name);
      tip.appendChild(r);
      return val;
    });
    wrap.current.appendChild(tip);
    const showTip = (u) => {
      const { idx, left, top } = u.cursor;
      if (!real.current || idx == null || left == null || left < 0) { tip.style.display = 'none'; return; }
      head.textContent = fx(u.data[0][idx]);
      series.forEach((s, i) => { lines[i].textContent = `${fmtVal(u.data[i + 1]?.[idx], s.dec ?? 0)}${s.unit ?? unit ? ` ${s.unit ?? unit}` : ''}`; });
      tip.style.display = 'block';
      const o = u.over.getBoundingClientRect(), w = wrap.current.getBoundingClientRect();
      const px = o.left - w.left + left, py = o.top - w.top + top;
      const tw = tip.offsetWidth;
      tip.style.left = `${px + 14 + tw > w.width ? px - 14 - tw : px + 14}px`;
      tip.style.top = `${Math.max(0, Math.min(py - 20, w.height - tip.offsetHeight))}px`;
    };

    // the first real data draws in from the left: the lines are clipped to a strip that widens over 400 ms in
    // the shared animation loop; the axes and grid stay put
    let reveal = 1, clipped = false;
    const stops = [];
    const drawIn = () => {
      if (reducedMotion()) return;
      reveal = 0;
      const t0 = performance.now();
      const off = onFrame((t) => {
        const k = Math.min(1, (t - t0) / 400);
        reveal = 1 - (1 - k) ** 3;
        u.redraw(false);
        if (k === 1) off();
      });
      stops.push(off);
    };
    revealRef.current = drawIn;

    const xAxis = axis({ size: 24, grid: { show: false }, show: showX });
    if (x === 'ago') Object.assign(xAxis, {
      // whole-second steps only, so no two ticks can round to the same label; minutes once past a minute
      incrs: [1, 2, 5, 10, 15, 30, 60, 120, 300, 600],
      values: (u, vals) => vals.map((v) => {
        const s = Math.round(u.data[0][u.data[0].length - 1] - v);
        if (s <= 0) return 'now';
        return s < 60 ? `-${s}s` : `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }),
    });
    else if (x === 'time') Object.assign(xAxis, {
      space: 80, // an HH:MM:SS label is about 60 px wide at 12 px: keep a gap between neighbours on a phone
      incrs: [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600], // never finer than a second, so labels never repeat
      values: (u, vals) => vals.map((v) => clock(v)),
    });
    const opts = {
      width: el.clientWidth || 400,
      height: hOf(),
      legend: { show: false },
      // charts with the same sync key share one crosshair
      cursor: { drag: { x: false, y: false }, points: { size: 7 }, ...(sync ? { sync: { key: sync } } : {}) },
      scales: { x: { time: x === 'time', ...(xRange ? { range: xRange } : {}) }, y: { range: yRange || ((u, min, max) => (min == null ? [0, 1] : uPlot.rangeNum(min, max, 0.1, true))) } },
      axes: [xAxis, axis({ splits: undefined, space: 30, values: (u, vals) => vals.map((v) => v.toLocaleString()) })],
      series: [{}, ...series.map((s) => ({
        label: s.label, stroke: s.color, width: s.width || 2,
        ...(s.fill ? { fill: s.fill } : {}), ...(s.fillTo != null ? { fillTo: s.fillTo } : {}),
        ...(s.step ? { paths: uPlot.paths.stepped({ align: 1 }) } : {}), points: { show: false },
      }))],
      hooks: {
        setCursor: [showTip],
        drawAxes: [(u) => {
          if (reveal >= 1) return;
          const { ctx, bbox } = u;
          ctx.save(); ctx.beginPath(); ctx.rect(bbox.left, 0, bbox.width * reveal, ctx.canvas.height); ctx.clip();
          clipped = true;
        }],
        draw: [(u) => { if (clipped) { u.ctx.restore(); clipped = false; } }],
      },
    };
    // placeholder points: uPlot cannot range a scale over no data
    const empty = [[0, 1], ...series.map(() => [null, null])];
    const u = new uPlot(opts, empty, el);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: hOf() }));
    ro.observe(el);
    let lastDraw = 0;
    const off = onFrame((t) => {
      if (!getRef.current || t - lastDraw < 33) return;
      lastDraw = t; // ask at most ~30 times a second, whether or not there was anything new
      const d = getRef.current();
      if (d) { const first = !real.current; real.current = true; u.setData(d); if (first) { drawIn(); setReady(true); } if (u.cursor.left >= 0) showTip(u); }
    });
    return () => { off(); stops.forEach((f) => f()); ro.disconnect(); u.destroy(); tip.remove(); plot.current = null; };
    // series shape is fixed per mount; remount through `key` when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data || !plot.current) return;
    const first = !real.current;
    real.current = true;
    plot.current.setData(data);
    if (first) { revealRef.current(); setReady(true); }
  }, [data]);

  return (
    <div ref={wrap} className={`chart ${fill ? 'chart-fill' : ''}`}>
      {(title || legend) && (
        <div className="chart-head">
          {title && <h3>{title}</h3>}
          {legend && (
            <span className="chart-legend">
              {series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
            </span>
          )}
        </div>
      )}
      <div className="chart-body">
        <div ref={host} role="img" aria-label={title ? `${title} chart` : 'Chart'} className="chart-host" />
        {!ready && <div className="chart-wait"><span className="blink-slow">{wait}</span></div>}
      </div>
    </div>
  );
}

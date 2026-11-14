// Station building blocks from docs/DESIGN.md "Components": Monitor, Readout, BarGauge, ArcGauge, Jewel, LitButton,
// ButtonGrid and ConsoleStrip. Local stand-ins until the shell's client/src/ui versions exist; same names and props
// so a station swaps its import line and nothing else. Numbers, needles and canvases move in the one shared
// animation-frame loop (lib/raf.js); React re-renders at most four times a second (lib/hooks.js useTick).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { reducedMotion } from '../../lib/chartTheme.js';
import { onFrame } from '../../lib/raf.js';
import { eachRecent, levelOf, limitsOf, meta, read, readAgo, ringOf, shipCode, shipName } from './data.js';
import './stations.css';

// canvas colours: the same values as the CSS tokens in stations.css
export const C = {
  void: '#050608', panel: '#14161a', raised: '#1e2127', bulkhead: '#56625e', line: '#ffffff14',
  ink: '#f1f3f5', ink2: '#b3b9c2', mute: '#8d95a0', accent: '#5cb8ff',
  ready: '#3edb6a', warn: '#ffd23f', crit: '#ff4a55', critInk: '#ff7a82', dev1: '#2f6fae',
  chart1: '#7cc4ff', chart2: '#f4efe2', scope: '#58c4ff', amber: '#ff9a1f', railing: '#e0522a',
};
export const levelColor = (l) => (l === 'crit' ? C.crit : l === 'warn' ? C.warn : null);
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

const fmts = new Map();
export function fmt(v, dec = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  let f = fmts.get(dec);
  if (!f) fmts.set(dec, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })));
  return f.format(v);
}
export const decOf = (key) => { const s = meta(key)?.scale ?? 1; return s >= 100 ? 2 : s >= 10 ? 1 : 0; };

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

/** Eases from the last shown value to `v` over `ms` in the shared frame loop, calling apply(x) each frame. */
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

/** A number that ticks to each new value in 240 ms. The span's text is written outside React. */
export function Num({ v, dec = 0, className = 'st-num', level }) {
  const ref = useRef(null);
  useTween(v, 240, (x) => { if (ref.current) ref.current.textContent = fmt(x, dec); });
  return <span ref={ref} className={className} data-level={level || undefined} />;
}

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

function Lock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

const BLANK = {
  restricted: ['RESTRICTED', 'Your station has no access to these readings.'],
  awaiting: ['AWAITING TELEMETRY', 'No readings from this source yet.'],
  nosignal: ['NO SIGNAL', 'The source stopped sending.'],
};
/** A rounded screen in a bezel with a title strip. States: live, awaiting, nosignal, restricted. */
export function Monitor({ title, meta: right, state = 'live', className = '', style, children, note, pad = false }) {
  const [word, text] = BLANK[state] ?? [];
  return (
    <section className={`st-mon ${className}`} style={style} aria-label={title}>
      <header className="st-mon-head"><h2>{title}</h2>{right != null && <span className="st-meta">{right}</span>}</header>
      <div className="st-screen">
        <div className={`st-screen-in ${pad ? 'st-pad' : ''}`} key={state}>
          {state === 'live' ? children : (
            <div className={`st-blank ${state === 'nosignal' ? 'st-static' : ''}`} role="status">
              {state === 'restricted' && <Lock />}
              <b className={state === 'awaiting' ? 'st-blink-slow' : undefined}>{word}</b>
              <span>{state === 'restricted' ? note ?? text : text}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function Chip({ level, children }) {
  return <span className="st-chip" data-level={level}>{children}</span>;
}
/** The status word that always goes with a status colour. */
export function LevelChip({ level, warn = 'YELLOW', crit = 'RED' }) {
  return level ? <Chip level={level}>{level === 'crit' ? crit : warn}</Chip> : null;
}

function Arrow({ dir }) {
  if (!dir) return <span className="st-trend" aria-hidden="true" />;
  return (
    <svg className="st-trend" width="10" height="10" viewBox="0 0 10 10" aria-label={dir > 0 ? 'rising' : 'falling'} role="img">
      <path d={dir > 0 ? 'M5 1 L9 8 H1 Z' : 'M5 9 L9 2 H1 Z'} fill="currentColor" />
    </svg>
  );
}

/** A value with its unit, coloured past a limit and then always followed by the level's word. */
export function Val({ src, k, v, dec, unit }) {
  const m = meta(k);
  const x = v !== undefined ? v : read(src, k);
  const level = levelOf(k, x);
  return (
    <>
      <Num v={x} dec={dec ?? decOf(k)} className="" level={level} />
      {(unit ?? m?.unit) ? <span className="st-unit">{unit ?? m.unit}</span> : null}
      {level && <> <LevelChip level={level} /></>}
    </>
  );
}

/** Label, big number with unit, change arrow and a 60 s sparkline with the limit lines. Colour only past a limit. */
export function Readout({ src, k, label, unit, dec, size = '', spark = true, ms = 60000, value, sparkH = 30 }) {
  const m = meta(k);
  const v = value !== undefined ? value : read(src, k);
  const level = levelOf(k, v);
  const ago = readAgo(src, k, 5000);
  const span = m ? (m.max - m.min) * 0.004 : 0;
  const dir = v == null || ago == null || Math.abs(v - ago) <= span ? 0 : Math.sign(v - ago);
  return (
    <div className="st-ro" data-level={level || undefined}>
      <div className="st-ro-top"><span className="st-label" title={m?.label}>{label ?? m?.label ?? k}</span></div>
      <div className={`st-ro-val ${level ? 'st-flash' : ''}`} key={level ?? 'ok'}>
        <Num v={v} dec={dec ?? decOf(k)} className={`st-num ${size}`} />
        {(unit ?? m?.unit) ? <span className="st-unit">{unit ?? m.unit}</span> : null}
        <Arrow dir={dir} />
        {level && <span style={{ marginLeft: 'auto', alignSelf: 'center' }}><LevelChip level={level} /></span>}
      </div>
      {spark && <Spark src={src} k={k} ms={ms} h={sparkH} />}
    </div>
  );
}

/** Canvas sparkline over the last `ms`, redrawn about 8 times a second; dashed warn and critical lines when in view. */
export function Spark({ src, k, ms = 60000, h = 30 }) {
  const m = meta(k);
  const lim = limitsOf(k);
  const ref = useCanvas((ctx, w, hh) => {
    ctx.clearRect(0, 0, w, hh);
    const r = ringOf(src, k);
    if (!r?.len || !r.cols[k]) return;
    let lo = Infinity, hi = -Infinity;
    const n = eachRecent(r, k, ms, (t, v) => { if (v < lo) lo = v; if (v > hi) hi = v; });
    if (!n) return;
    const minSpan = m ? (m.max - m.min) * 0.02 : 1;
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const end = r.lastTs;
    const X = (t) => w - ((end - t) / ms) * w;
    const Y = (v) => 2 + (1 - (v - lo) / (hi - lo)) * (hh - 4);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const side of ['high', 'low']) {
      const rule = lim?.[side];
      if (!rule) continue;
      for (const [val, col] of [[rule.warn, C.warn], [rule.critical, C.crit]]) {
        if (val <= lo || val >= hi) continue;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(0, Y(val)); ctx.lineTo(w, Y(val)); ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const step = Math.max(1, Math.floor(n / (w * 1.5)));
    ctx.strokeStyle = C.chart1; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true, lx = 0, ly = 0;
    eachRecent(r, k, ms, (t, v) => { lx = X(t); ly = Y(v); if (first) { ctx.moveTo(lx, ly); first = false; } else ctx.lineTo(lx, ly); }, step);
    ctx.stroke();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(Math.min(lx, w - 2), ly, 2, 0, Math.PI * 2); ctx.fill();
  }, [src, k, ms], 125);
  return <canvas ref={ref} className="st-spark" style={{ height: h }} aria-hidden="true" />;
}

/** Vertical segmented bar with limit ticks. */
export function BarGauge({ v, k, label, min, max, unit, dec, segs = 16, h = 120, showValue = true }) {
  const m = meta(k);
  const lo = min ?? m?.min ?? 0, hi = max ?? m?.max ?? 100;
  const level = levelOf(k, v);
  const on = v == null ? 0 : Math.round(clamp((v - lo) / (hi - lo)) * segs);
  const lim = limitsOf(k);
  const ticks = [];
  for (const side of ['high', 'low']) if (lim?.[side]) for (const [val, cls] of [[lim[side].warn, 'w'], [lim[side].critical, 'c']]) if (val > lo && val < hi) ticks.push([val, cls]);
  return (
    <div className="st-bar" data-level={level || undefined} role="meter" aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={v ?? undefined} aria-label={`${label ?? m?.label}${v == null ? ', no reading' : `, ${fmt(v, dec ?? decOf(k))} ${unit ?? m?.unit ?? ''}`}`}>
      {showValue && <span className="st-bar-val"><Num v={v} dec={dec ?? decOf(k)} className="" /><span className="st-unit">{unit ?? m?.unit}</span></span>}
      <div className="st-bar-col" style={{ height: h }}>
        {Array.from({ length: segs }, (_, i) => <i key={i} className={`st-seg ${i < on ? 'on' : ''}`} />)}
        {ticks.map(([val, cls]) => <b key={`${cls}${val}`} className={`st-tick ${cls}`} style={{ bottom: `${((val - lo) / (hi - lo)) * 100}%` }} />)}
      </div>
      {label && <span className="st-bar-lab">{label}</span>}
    </div>
  );
}

/** Thin horizontal bar, 0..max. */
export function HBar({ v, k, min = 0, max = 100, label }) {
  const level = levelOf(k, v);
  return (
    <div className="st-hbar" data-level={level || undefined} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={v ?? undefined} aria-label={label}>
      <i style={{ width: `${v == null ? 0 : clamp((v - min) / (max - min)) * 100}%` }} />
    </div>
  );
}

const polar = (cx, cy, r, deg) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
const arcPath = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
/** 240° arc with a needle that eases to each value; warn and critical zones from the channel's limits. `below` puts the number under the arc. */
export function ArcGauge({ v, k, min, max, ticks = [], label, unit, dec, numClass = 'st-num st-xl', tickDec = 0, below = false }) {
  const m = meta(k);
  const lo = min ?? m?.min ?? 0, hi = max ?? m?.max ?? 100;
  const level = levelOf(k, v);
  const ang = (x) => -120 + clamp((x - lo) / (hi - lo)) * 240;
  const needle = useRef(null), fill = useRef(null);
  const R = 84, cx = 100, cy = 100, L = (Math.PI * R * 240) / 180;
  useTween(v ?? lo, 600, (x) => {
    needle.current?.setAttribute('transform', `rotate(${ang(x)} ${cx} ${cy})`);
    fill.current?.setAttribute('stroke-dashoffset', String(L * (1 - clamp((x - lo) / (hi - lo)))));
  });
  const lim = limitsOf(k);
  const zones = [];
  if (lim?.high) zones.push([lim.high.warn, lim.high.critical, C.warn], [lim.high.critical, hi, C.crit]);
  if (lim?.low) zones.push([lim.low.warn, lim.low.critical, C.warn], [lo, lim.low.critical, C.crit]);
  return (
    <div style={{ position: 'relative', width: '100%' }} data-level={level || undefined}>
      <svg className="st-arc" viewBox={below ? '0 0 200 150' : '0 0 200 168'} role="img" aria-label={`${label ?? m?.label}: ${v == null ? 'no reading' : fmt(v, dec ?? decOf(k))} ${unit ?? m?.unit ?? ''}`}>
        <path d={arcPath(cx, cy, R, -120, 120)} fill="none" stroke="#ffffff12" strokeWidth="10" strokeLinecap="round" />
        <path ref={fill} d={arcPath(cx, cy, R, -120, 120)} fill="none" stroke={levelColor(level) ?? C.chart1} strokeOpacity="0.85" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${L} ${L}`} strokeDashoffset={L} />
        {zones.map(([a, b, col]) => {
          const x0 = Math.min(a, b), x1 = Math.max(a, b);
          if (x1 <= lo || x0 >= hi) return null;
          return <path key={`${a}${col}`} d={arcPath(cx, cy, R + 11, ang(Math.max(lo, x0)), ang(Math.min(hi, x1)))} fill="none" stroke={col} strokeWidth="3" strokeDasharray="3 2" />;
        })}
        {ticks.map((t) => {
          const [x0, y0] = polar(cx, cy, R - 9, ang(t)), [x1, y1] = polar(cx, cy, R - 16, ang(t)), [tx, ty] = polar(cx, cy, R - 27, ang(t));
          return (
            <g key={t}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={C.mute} strokeWidth="1.5" />
              <text x={tx} y={ty + 3.5} textAnchor="middle" fontSize="10" fill={C.mute}>{fmt(t, tickDec)}</text>
            </g>
          );
        })}
        <g ref={needle} transform={`rotate(-120 ${cx} ${cy})`}>
          <path d={`M${cx - 3} ${cy} L${cx} ${cy - R + 4} L${cx + 3} ${cy} Z`} fill={C.ink} />
        </g>
        <circle cx={cx} cy={cy} r="7" fill={C.raised} stroke={C.bulkhead} />
      </svg>
      <div style={below ? { textAlign: 'center', marginTop: -6 } : { position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center' }}>
        <Num v={v} dec={dec ?? decOf(k)} className={numClass} level={level} />
        {(unit ?? m?.unit) ? <span className="st-unit">{unit ?? m.unit}</span> : null}
      </div>
    </div>
  );
}

export function Jewel({ status = 'ok', label }) {
  return <span className="st-jewel" data-s={status} role="img" aria-label={`${label}: ${status === 'crit' ? 'red' : status === 'warn' ? 'yellow' : status === 'off' ? 'no signal' : 'nominal'}`} />;
}

/** A real control: a translucent lit rectangle with a Michroma label and a key cap. Blinks while its command waits for the server. Same props as the shell's ui/LitButton. */
export function LitButton({ color = 'blue', label, keyCap, onClick, lit, pending, disabled, title, pressed }) {
  return (
    <button type="button" className="st-lit" data-c={color} data-lit={lit ? 'true' : undefined} data-pending={pending ? 'true' : undefined}
      aria-pressed={pressed} aria-busy={pending || undefined} onClick={onClick} disabled={disabled} title={title} aria-keyshortcuts={keyCap || undefined}>
      <span className="flash" aria-hidden="true" />
      {label}
      {keyCap && <kbd className="key">{keyCap}</kbd>}
    </button>
  );
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const LIT = ['red', 'amber', 'yellow', 'green', 'blue', 'white'];
/** Decorative jellybeans that twinkle on their own (CSS only, seeded per grid). */
export function ButtonGrid({ seed = 1, n = 42 }) {
  const beans = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: n }, () => ({ c: LIT[Math.floor(r() * 6)], t: 1.5 + r() * 4.5, d: -r() * 6 }));
  }, [seed, n]);
  return (
    <div className="st-beans" aria-hidden="true">
      {beans.map((b, i) => <i key={i} className="st-bean" style={{ '--bc': `var(--lit-${b.c})`, '--bd': `var(--lit-${b.c}-dim)`, '--t': `${b.t.toFixed(2)}s`, '--dl': `${b.d.toFixed(2)}s`, '--on': `${Math.floor(i / 3) * 40}ms` }} />)}
    </div>
  );
}

/** A jewel-row entry: a system's worst level, or off while its monitor has no live data. */
export const J = (label, level, monitorState) => ({ label, status: monitorState !== 'live' ? 'off' : level || 'ok' });

/** The console strip: real controls, the decorative grid, a jewel per system and the last command's answer. */
export function ConsoleStrip({ children, seed, jewels = [], cmd }) {
  return (
    <div className="st-console" role="group" aria-label="Console controls">
      <div className="st-controls">{children}</div>
      <ButtonGrid seed={seed} />
      <div className="st-console-side">
        <div className="st-jewels">{jewels.map((j) => <span key={j.label}><Jewel status={j.status} label={j.label} />{j.label}</span>)}</div>
        <div className={`st-cmdlog ${cmd?.last && !cmd.last.ok ? 'bad' : ''}`} role="status" aria-live="polite">{cmd?.last?.text ?? ''}</div>
      </div>
    </div>
  );
}

/**
 * The console frame every station uses: placard (division pill, station name, ship), the recessed bank of monitors
 * laid out on a 12-column grid with `rows` as its row template, and the desk (`desk`, a ConsoleStrip) along the bottom.
 */
export function Station({ name, division, ship, rows, end, desk, children }) {
  return (
    <div className="st-station" data-station={name.toLowerCase()}>
      <header className="st-plate">
        <i className="st-pill" data-div={division} aria-hidden="true" />
        <h1>{name}</h1>
        {ship != null && <span className="st-ship">{shipCode(ship)} · {shipName(ship)}</span>}
        {end && <span className="st-plate-end">{end}</span>}
      </header>
      <div className="st-grid" style={rows ? { '--rows': rows } : undefined}>{children}</div>
      {desk}
    </div>
  );
}

export { useKeys } from '../../lib/keys.js';

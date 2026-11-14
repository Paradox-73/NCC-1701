import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { alertsFor, canSee, levelOf, meta, monState, read, useCommand, useFeed, worst } from './parts/data.js';
import { useHistory } from './parts/history.js';
import { BarGauge, Chip, ConsoleStrip, Headline, J, LampBar, LevelChip, LitButton, Monitor, Num, Readings, Station } from '../ui/index.js';
import { C, clamp, fmt, levelColor, useCanvas } from './parts/ui.jsx';

const SWEEP_MS = 4000; // one turn of the scope (DESIGN.md SweepScope)
const NOISE_DB = 3.5; // returns under this are the sensor noise floor (DOMAIN.md: 1-3 dB)
const kind = (n, snr) => (n >= 1 && snr >= 10 ? 'solid' : snr >= NOISE_DB ? 'ghost' : n >= 1 ? 'weak' : null);

/** Round scope, fore up: range rings, bearing ticks, a sweep with a phosphor trail, the nearest contact as a fading blip. */
function Scope({ src, mode }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) / 2 - 24, cx = w / 2, cy = h / 2;
    const maxKm = mode === 'long' ? 1_000_000 : 100_000;
    ctx.lineWidth = 1; ctx.strokeStyle = '#58c4ff2e';
    for (const k of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.strokeStyle = '#58c4ff1a'; ctx.stroke();
    ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = C.mute;
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180, long = d % 30 === 0;
      ctx.strokeStyle = long ? '#58c4ff66' : '#58c4ff33';
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.lineTo(cx + Math.sin(a) * (R + (long ? 7 : 4)), cy - Math.cos(a) * (R + (long ? 7 : 4))); ctx.stroke();
      if (long) { ctx.textAlign = 'center'; ctx.fillText(String(d).padStart(3, '0'), cx + Math.sin(a) * (R + 16), cy - Math.cos(a) * (R + 16) + 3.5); }
    }
    ctx.textAlign = 'left';
    for (const k of [0.5, 1]) ctx.fillText(`${fmt((maxKm * k) / 1000, 0)}k km`, cx + 4, cy - R * k + 12);
    // sweep with a fading trail
    const sweep = (((t % SWEEP_MS) / SWEEP_MS) * 360 + 360) % 360;
    const sa = ((sweep - 90) * Math.PI) / 180;
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(sa - Math.PI / 2.4, cx, cy);
      g.addColorStop(0, 'transparent'); g.addColorStop(1 / 4.8, '#58c4ff40'); g.addColorStop(1 / 4.8 + 0.001, 'transparent'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, sa - Math.PI / 2.4, sa); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = C.scope; ctx.lineWidth = 1.5; ctx.shadowColor = C.scope; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * R, cy + Math.sin(sa) * R); ctx.stroke(); ctx.shadowBlur = 0;
    // noise speckle inside the trail
    const slot = Math.floor(t / 120);
    for (let i = 0; i < 26; i++) {
      const s1 = Math.sin(i * 91.7 + slot * 12.3) * 43758.5, s2 = Math.sin(i * 37.1 + slot * 7.7) * 24634.6;
      const fa = s1 - Math.floor(s1), fr = s2 - Math.floor(s2);
      const a = sa - fa * (Math.PI / 2.4), rr = Math.sqrt(fr) * R;
      ctx.fillStyle = `rgba(88,196,255,${0.08 + 0.2 * (1 - fa)})`; ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.5, 1.5);
    }
    // nearest contact: brightest just after the sweep passes it, then the phosphor fades
    const n = read(src, 'contacts') ?? 0, snr = read(src, 'contactSnr') ?? 0, brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
    const k = kind(n, snr);
    if (!k || brg == null || rng == null) return;
    const beyond = rng > maxKm;
    const a = (brg * Math.PI) / 180, rr = R * clamp(rng / maxKm, 0.04, 1);
    const age = ((((sweep - brg) % 360) + 360) % 360) / 360 * SWEEP_MS;
    const glow = 0.25 + 0.75 * Math.exp(-age / 1600);
    const col = levelColor(levelOf('contactRange', rng)) ?? C.scope;
    const x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
    ctx.globalAlpha = glow * (k === 'solid' ? 1 : 0.55);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    if (k === 'solid') { ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke(); }
    else {
      // a cloaked or weak return: faint and broken
      ctx.setLineDash([2, 4]); ctx.lineDashOffset = -t / 80;
      ctx.beginPath(); ctx.arc(x + Math.sin(t / 170) * 1.5, y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.font = '400 11px "Space Mono", monospace'; ctx.fillStyle = col; ctx.textAlign = x > cx ? 'right' : 'left';
    ctx.fillText(`${k === 'solid' ? 'C-1' : 'GHOST?'} ${fmt(brg, 0).padStart(3, '0')}°${beyond ? ' · beyond scale' : ''}`, x + (x > cx ? -14 : 14), y - 12);
  }, [src, mode], 33);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label={`Sensor scope, ${mode} range, fore at the top`} />;
}

function Contacts({ src }) {
  const n = read(src, 'contacts') ?? 0, snr = read(src, 'contactSnr'), brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
  const k = kind(n, snr ?? 0);
  const conf = snr == null ? null : clamp((snr - 2) / 18) * 100; // our estimate: 2 dB noise floor is 0 %, 20 dB is certain
  const rl = levelOf('contactRange', rng);
  return (
    <div style={{ height: '100%', padding: '10px 14px' }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="st-label">{n >= 1 ? `${fmt(n, 0)} contact${n === 1 ? '' : 's'} tracked; the nearest is detailed` : k ? 'Unconfirmed return above the noise floor' : 'No contacts. Sensors read the noise floor.'}</span>
        <div className="st-scroll">
          <table className="st-table">
            <thead><tr><th>Contact</th><th className="n">Bearing</th><th className="n">Range</th><th className="n">Signal</th><th className="n" title="Confidence">Conf.</th></tr></thead>
            <tbody>
              {k ? (
                <tr>
                  <td><Chip level={k === 'solid' ? 'info' : 'warn'}>{k === 'solid' ? 'C-1' : 'GHOST?'}</Chip></td>
                  <td className="n">{fmt(brg, 1)}°</td>
                  <td className="n" style={{ color: levelColor(rl) ?? undefined }}>{fmt(rng, 0)} km</td>
                  <td className="n">{fmt(snr, 1)} dB</td>
                  <td className="n">{fmt(conf, 0)}%</td>
                </tr>
              ) : <tr><td colSpan={5} style={{ color: C.mute }}>Nothing above {NOISE_DB} dB.</td></tr>}
            </tbody>
          </table>
        </div>
        {rl && <span><LevelChip level={rl} warn="CLOSING" crit="COLLISION RANGE" /> <span className="st-label">nearest contact inside {fmt(rl === 'crit' ? 10000 : 50000, 0)} km</span></span>}
      </div>
    </div>
  );
}

const LOG10 = Math.log10;
/** Life-forms aboard on a log scale, history then live, with a straight-line fit to log(count) drawn ahead (the Tribbles forecast). */
function Lifeforms({ src, showCo2 }) {
  const { data, meta: hm } = useHistory(src, 'lifeforms', 600, !!meta('lifeforms'));
  const co2 = useHistory(src, 'co2_09', 120, showCo2 && !!meta('co2_09'));
  const [fit, setFit] = useState(null);
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const d = data.current;
    const L = 44, B = h - 20, T = 10, Rr = w - 10;
    const now = d.xs.length ? d.xs[d.xs.length - 1] : Date.now() / 1000;
    const x0 = now - 180, x1 = now + 60; // three minutes back, one ahead
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (Rr - L);
    const Y = (lv) => B - (lv / 7) * (B - T);
    ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = C.mute; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    for (let e = 0; e <= 7; e++) {
      ctx.strokeStyle = '#ffffff0d'; ctx.beginPath(); ctx.moveTo(L, Y(e)); ctx.lineTo(Rr, Y(e)); ctx.stroke();
      if (e % 2 === 0 || e === 7) ctx.fillText(e === 0 ? '1' : e < 4 ? String(10 ** e) : `10^${e}`, L - 6, Y(e) + 3.5);
    }
    ctx.strokeStyle = '#ffffff26'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(now), T); ctx.lineTo(X(now), B); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'center'; ctx.fillText('now', X(now), h - 6); ctx.fillText('-3 min', X(x0) + 18, h - 6); ctx.fillText('+1 min', X(x1) - 20, h - 6);
    // stored (grey) up to the join, live (blue) from the same point on
    let cut = d.seqs.findIndex((q) => q > d.joinSeq);
    if (cut < 0) cut = d.xs.length;
    for (const [from, to, col] of [[0, cut, C.mute], [Math.max(0, cut - 1), d.xs.length, C.chart1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      let on = false;
      for (let i = from; i < to; i++) {
        if (d.xs[i] < x0 || d.ys[i] == null) { on = false; continue; }
        const px = X(d.xs[i]), py = Y(LOG10(Math.max(1, d.ys[i])));
        if (!on) { ctx.moveTo(px, py); on = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // fit log10(count) = a + b t over the last 60 s of nonzero counts
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < d.xs.length; i++) {
      if (d.ys[i] == null || d.ys[i] < 1 || d.xs[i] < now - 60) continue;
      const x = d.xs[i] - now, y = LOG10(d.ys[i]);
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const b = n > 5 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
    const a = n > 5 ? (sy - b * sx) / n : 0;
    if (n > 5 && b > 0.001) {
      ctx.strokeStyle = C.chart2; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(now), Y(clamp(a, 0, 7))); ctx.lineTo(X(x1), Y(clamp(a + b * 60, 0, 7))); ctx.stroke(); ctx.setLineDash([]);
    }
    if (Math.floor(t / 1000) !== fit?.sec) setFit({ sec: Math.floor(t / 1000), b: n > 5 ? b : null, last: d.ys[d.ys.length - 1] ?? null });
  }, [src], 100);
  const doubling = fit?.b > 0.001 ? LOG10(2) / fit.b : null;
  // deck 9 carbon dioxide: straight line over the last 30 s, when this role may see life support
  let co2Eta = null;
  if (showCo2) {
    const cd = co2.data.current, m = cd.xs.length;
    if (m > 10) {
      const t1 = cd.xs[m - 1], i0 = cd.xs.findIndex((x) => x > t1 - 30);
      const dt = t1 - cd.xs[i0], dv = cd.ys[m - 1] - cd.ys[i0];
      if (dt > 5 && dv > 0 && cd.ys[m - 1] < 5000) co2Eta = (5000 - cd.ys[m - 1]) / (dv / dt);
      if (co2Eta > 900) co2Eta = null; // a slow drift is not a forecast worth printing
    }
  }
  return (
    <div className="st-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(140px, 32%)', height: '100%' }}>
      <div style={{ position: 'relative' }}>
        <canvas ref={ref} className="st-canvas" role="img" aria-label="Unregistered life-forms aboard, log scale, with a one-minute forecast" />
        {hm.status === 'ready' && !(fit?.last >= 1) && <div className="st-blank" style={{ pointerEvents: 'none' }}><span>No unregistered life-forms aboard. The forecast starts when a count appears.</span></div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px 10px 4px' }}>
        <div className="st-ro"><span className="st-label">Aboard now</span><span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Num value={fit?.last ?? read(src, 'lifeforms')} dec={0} className="st-num st-sm" level={levelOf('lifeforms', fit?.last)} /><LevelChip level={levelOf('lifeforms', fit?.last)} /></span></div>
        <div className="st-ro"><span className="st-label">Doubling time</span><span className="st-num st-xs">{doubling ? `${fmt(doubling, 1)} s` : '—'}</span></div>
        {showCo2 && <div className="st-ro"><span className="st-label">Deck 9 CO₂ passes 5,000 ppm</span><span className="st-num st-xs">{co2Eta ? `in ${fmt(co2Eta, 0)} s` : 'not on this trend'}</span></div>}
        <span className="st-label" style={{ marginTop: 'auto' }}>Dashed: straight-line fit to log(count) over the last minute.</span>
      </div>
    </div>
  );
}

/** The hooded viewer: a blue return spectrum. Its floor follows ion flux, its peak the nearest contact's signal. */
function Viewer({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    // the viewer's own blue light, brighter with a stronger return
    const flux = read(src, 'ionFlux') ?? 0, snr = read(src, 'contactSnr') ?? 0;
    const lamp = ctx.createRadialGradient(w / 2, h * 0.55, 4, w / 2, h * 0.55, Math.max(w, h) * 0.7);
    lamp.addColorStop(0, `rgba(63,163,255,${0.34 + clamp(snr / 40) * 0.4})`); lamp.addColorStop(1, 'rgba(14,44,74,0.15)');
    ctx.fillStyle = lamp; ctx.fillRect(0, 0, w, h);
    const bins = 40, bw = w / bins, peak = bins * 0.62;
    for (let i = 0; i < bins; i++) {
      const s = Math.sin(i * 12.9898 + Math.floor(t / 90) * 4.1) * 43758.5;
      const noise = (s - Math.floor(s)) * (3 + flux * 0.6);
      const sig = snr * Math.exp(-((i - peak) ** 2) / 6);
      const v = clamp((noise + sig) / 60);
      const bh = v * (h - 30);
      const g = ctx.createLinearGradient(0, h - 18 - bh, 0, h - 18);
      g.addColorStop(0, '#bfe8ff'); g.addColorStop(0.3, C.scope); g.addColorStop(1, '#0e2c4a');
      ctx.fillStyle = g; ctx.fillRect(i * bw + 1, h - 18 - bh, bw - 2, bh);
    }
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
    v.addColorStop(0, 'transparent'); v.addColorStop(1, '#000000d0');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = C.mute; ctx.textAlign = 'left';
    ctx.fillText(`floor ${fmt(flux, 1)} ion flux`, 8, h - 5); ctx.textAlign = 'right'; ctx.fillText(`peak ${fmt(snr, 1)} dB`, w - 8, h - 5);
  }, [src], 90);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Viewer: sensor return spectrum" />;
}

/** Spock's hooded viewer: a pale wedge-shaped hood over the scanner screen, its blue light spilling out of the mouth. */
function HoodedViewer({ src }) {
  return (
    <div className="hood">
      <div className="hood__shell" aria-hidden="true" />
      <div className="hood__mouth"><Viewer src={src} /></div>
    </div>
  );
}

function Anomalies({ src }) {
  const list = alertsFor(src).filter((a) => a.type === 'zscore').slice(0, 40);
  if (!list.length) return <div className="st-blank"><b>NO ANOMALIES</b><span>The detector flags a reading 4 standard deviations from its recent mean, held for half a second.</span></div>;
  const now = Date.now();
  return (
    <div className="st-scroll" style={{ height: '100%' }}>
      <table className="st-table">
        <thead><tr><th>Channel</th><th className="n">z-score</th><th className="n">Since</th><th /></tr></thead>
        <tbody>
          {list.map((a) => {
            const z = /([\d.]+) standard deviations (above|below)/.exec(a.message ?? '');
            return (
              <tr key={a.id} className={a.arrivedAt && now - a.arrivedAt < 1500 ? 'st-row new' : undefined}>
                <td style={{ whiteSpace: 'normal' }}>{meta(a.channel)?.label ?? a.channel}</td>
                <td className="n">{z ? `${z[2] === 'below' ? '−' : '+'}${z[1]}` : '≥ 4'}</td>
                <td className="n">{fmt((now - a.ts) / 1000, 0)} s ago</td>
                <td>{a.ack ? <Chip level="off">SEEN</Chip> : <Chip level="warn">YELLOW</Chip>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Science (DESIGN.md "Science", The 1966 set): the sensor scope beside three headline monitors, contacts, sensor arrays
 * and life-forms aboard. The hooded viewer, the contact table, the anomaly list, both arrays with ion flux and the
 * life-forms forecast are each a page of the monitor they belong to.
 */
export default function Science({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const src = shipId;
  useFeed(src, ['sensors'], 600000);
  const [mode, setMode] = useState('short');
  const cmd = useCommand(shipId);
  const st = (...g) => monState(user, src, g);
  const scan = (m) => cmd.send('science.scan', { mode: m });
  // the scope's scale is local to this console; the scan pass goes to the ship only when the role may order one
  const range = (m) => { setMode(m); if (cmd.can('science.scan')) scan(m); };
  const sys = (ks) => worst(ks.map((k) => levelOf(k, read(src, k))));
  const p = cmd.pending('science.scan');
  const n = read(src, 'contacts'), rng = read(src, 'contactRange'), snr = read(src, 'contactSnr');
  const lr = read(src, 'lrSensor'), sr = read(src, 'srSensor');
  const arr = lr == null && sr == null ? null : Math.min(lr ?? 100, sr ?? 100);
  const arrK = (lr ?? 100) <= (sr ?? 100) ? 'lrSensor' : 'srSensor';
  const life = read(src, 'lifeforms');
  const anomalies = alertsFor(src).filter((a) => a.type === 'zscore' && !a.ack).length;
  const desk = (
    <ConsoleStrip seed={23} jewels={[J('LONG RANGE', sys(['lrSensor']), st('sensors')), J('SHORT RANGE', sys(['srSensor']), st('sensors')), J('ION FLUX', sys(['ionFlux']), st('sensors')), J('LIFE-FORMS', sys(['lifeforms']), st('sensors'))]}>
      <LitButton color="blue" label="Scan" onClick={() => scan(mode)} {...cmd.bind('science.scan')} />
      <LitButton color="blue" label="Focus contact" onClick={() => scan('focus')} {...cmd.bind('science.scan')} disabled={!cmd.can('science.scan') || !(read(src, 'contacts') >= 1 || read(src, 'contactSnr') >= NOISE_DB)} />
      <LitButton color="white" label="Long range" onClick={() => range('long')} pressed={mode === 'long'} pending={p} />
      <LitButton color="white" label="Short range" onClick={() => range('short')} pressed={mode === 'short'} pending={p} />
    </ConsoleStrip>
  );

  return (
    <Station name="Science" division="science" ship={src} rows="minmax(250px, 1fr) minmax(250px, 1fr)" desk={desk}>
      <Monitor title="Sensor scope" meta={`${mode === 'long' ? 'long' : 'short'} range · fore up`} state={st('sensors')} className="st-c6" style={{ gridRow: '1 / span 2', '--mh': 'auto' }} index={0}
        views={[
          { label: 'Scope', content: <Scope src={src} mode={mode} /> },
          { label: 'Viewer', content: <HoodedViewer src={src} /> },
        ]} />
      <Monitor title="Contacts" status={levelOf('contactRange', rng) ?? (anomalies ? 'warn' : 'ok')} state={st('sensors')} className="st-c3" index={1}
        views={[
          { label: 'Nearest', content: (
            <Headline value={n ?? 0} unit={n === 1 ? 'contact' : 'contacts'} level={levelOf('contactRange', rng)} warn="CLOSING" crit="COLLISION RANGE"
              word={n >= 1 ? `${fmt(rng, 0)} KM` : snr >= NOISE_DB ? 'GHOST?' : 'CLEAR'}>
              <LampBar value={snr} k="contactSnr" min={0} max={30} label="Return signal" />
            </Headline>
          ) },
          { label: 'Table', content: <Contacts src={src} /> },
          { label: anomalies ? `Anomalies ${anomalies}` : 'Anomalies', content: <Anomalies src={src} /> },
        ]} />
      <Monitor title="Sensor arrays" status={sys(['lrSensor', 'srSensor', 'ionFlux']) ?? 'ok'} state={st('sensors')} className="st-c3" index={2}
        views={[
          { label: 'Health', content: (
            <Headline value={arr} unit={`% ${arrK === 'lrSensor' ? 'long range' : 'short range'}`} level={levelOf(arrK, arr)}>
              <LampBar value={arr} k={arrK} min={0} max={100} label="Weaker sensor array" />
            </Headline>
          ) },
          { label: 'Arrays', content: (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 14, height: '100%', padding: 12 }}>
              <BarGauge value={lr} k="lrSensor" label="Long" min={0} max={100} h="auto" segs={14} dec={0} />
              <BarGauge value={sr} k="srSensor" label="Short" min={0} max={100} h="auto" segs={14} dec={0} />
              <Readings items={[{ label: 'Ion flux', value: read(src, 'ionFlux'), unit: 'index', dec: 1, level: levelOf('ionFlux', read(src, 'ionFlux')) }]} />
            </div>
          ) },
        ]} />
      <Monitor title="Life-forms aboard" status={levelOf('lifeforms', life) ?? 'ok'} state={st('sensors')} className="st-c6" index={3}
        views={[
          { label: 'Count', content: (
            <Headline value={life} unit="aboard" level={levelOf('lifeforms', life)}>
              <LampBar value={life == null ? null : Math.log10(Math.max(1, life))} k="lifeforms" min={0} max={7} label="Life-forms aboard, log scale" />
            </Headline>
          ) },
          { label: 'Forecast', content: <Lifeforms src={src} showCo2={canSee(user, 'lifesupport')} /> },
        ]} />
    </Station>
  );
}

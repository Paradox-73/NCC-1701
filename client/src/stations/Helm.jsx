import { useRef } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { SHIPS, eachSlot, levelOf, monState, read, ringOf, shipCode, useCommand, useFeed, worst } from './parts/data.js';
import { ArcGauge, BarGauge, Chip, ConsoleStrip, HBar, J, LitButton, Monitor, Num, Station, useKeys } from '../ui/index.js';
import { C, Readout, Val, clamp, fmt, levelColor, useCanvas } from './parts/ui.jsx';

const SPAN = 320; // sector units across the shorter side of the plot
const fresh = (src) => { const r = ringOf(src, 'posX'); return r?.len && Date.now() - r.lastTs < 5000; };

function chevron(ctx, x, y, deg, size, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate((deg * Math.PI) / 180);
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.35); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}

/** North-up sector plot centred on the ship: grid, two-minute trail, one-minute course line, task force, contact bearing. */
function NavPlot({ src, others }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const x = read(src, 'posX'), y = read(src, 'posY');
    if (x == null || y == null) return;
    const hd = read(src, 'heading') ?? 0, sp = read(src, 'speed') ?? 0;
    const s = Math.min(w, h) / SPAN, cx = w / 2, cy = h / 2;
    const P = (px, py) => [cx + (px - x) * s, cy - (py - y) * s];
    // grid every 25 su, labelled every 50
    ctx.lineWidth = 1; ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = C.mute;
    const step = 25;
    for (let gx = Math.ceil((x - cx / s) / step) * step; gx <= x + cx / s; gx += step) {
      const [px] = P(gx, 0);
      ctx.strokeStyle = gx % 100 === 0 ? '#ffffff1c' : '#ffffff0b'; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      if (gx % 50 === 0) { ctx.textAlign = 'center'; ctx.fillText(String(gx), px, h - 6); }
    }
    for (let gy = Math.ceil((y - cy / s) / step) * step; gy <= y + cy / s; gy += step) {
      const [, py] = P(0, gy);
      ctx.strokeStyle = gy % 100 === 0 ? '#ffffff1c' : '#ffffff0b'; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      if (gy % 50 === 0) { ctx.textAlign = 'left'; ctx.fillText(String(gy), 6, py - 3); }
    }
    // range rings 50 and 100 su
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#7cc4ff33';
    for (const rr of [50, 100]) { ctx.beginPath(); ctx.arc(cx, cy, rr * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = C.mute; ctx.textAlign = 'left'; ctx.fillText('100 su', cx + 100 * s * 0.71 + 4, cy - 100 * s * 0.71);
    // trail of the last two minutes
    const r = ringOf(src, 'posX');
    ctx.strokeStyle = C.chart1; ctx.lineWidth = 2;
    let i0 = 0;
    const n = eachSlot(r, 120000, () => {}), every = Math.max(1, Math.floor(n / 240));
    eachSlot(r, 120000, (i) => {
      const [px, py] = P(r.cols.posX[i], r.cols.posY[i]);
      ctx.globalAlpha = 0.15 + 0.7 * ((i0 * every) / Math.max(1, n)); // older trail fades out
      if (i0++ === 0) { ctx.beginPath(); ctx.moveTo(px, py); } else { ctx.lineTo(px, py); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px, py); }
    }, every);
    ctx.globalAlpha = 1;
    // course: where the ship will be in one minute at this speed (DOMAIN.md: speed / 400 su a second)
    const ahead = Math.max(12, (sp / 400) * 60), rad = (hd * Math.PI) / 180;
    ctx.setLineDash([6, 5]); ctx.strokeStyle = C.chart2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(rad) * ahead * s, cy - Math.cos(rad) * ahead * s); ctx.stroke(); ctx.setLineDash([]);
    // task force
    for (const id of others) {
      if (!fresh(id)) continue;
      const ox = read(id, 'posX'), oy = read(id, 'posY');
      let [px, py] = P(ox, oy);
      const off = px < 12 || py < 12 || px > w - 12 || py > h - 12;
      if (off) { const a = Math.atan2(py - cy, px - cx); const k = Math.min((w / 2 - 16) / Math.abs(Math.cos(a)), (h / 2 - 16) / Math.abs(Math.sin(a))); px = cx + Math.cos(a) * k; py = cy + Math.sin(a) * k; }
      chevron(ctx, px, py, read(id, 'heading') ?? 0, 7, off ? '#b3b9c288' : C.ink2);
      ctx.fillStyle = C.ink2; ctx.font = '400 10px "Space Mono", monospace'; ctx.textAlign = 'left';
      ctx.fillText(shipCode(id), px + 10, py + 4);
    }
    // nearest sensor contact: a bearing mark on the outer ring (its range is in km, not on this grid)
    const contacts = read(src, 'contacts'), brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
    if (contacts >= 1 && brg != null) {
      const a = ((hd + brg) * Math.PI) / 180, R = Math.min(w, h) * 0.44;
      const lv = levelOf('contactRange', rng);
      const col = levelColor(lv) ?? C.scope;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * (R - 10), cy - Math.cos(a) * (R - 10)); ctx.lineTo(cx + Math.sin(a) * (R + 6), cy - Math.cos(a) * (R + 6)); ctx.stroke();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 300);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + Math.sin(a) * R, cy - Math.cos(a) * R, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.font = '400 11px "Space Mono", monospace';
      const lx = cx + Math.sin(a) * (R - 22), ly = cy - Math.cos(a) * (R - 22);
      ctx.textAlign = Math.sin(a) > 0.2 ? 'right' : Math.sin(a) < -0.2 ? 'left' : 'center';
      ctx.fillText(`CONTACT ${fmt(brg, 0).padStart(3, '0')}° · ${fmt(rng, 0)} km`, lx, ly + 4);
    }
    chevron(ctx, cx, cy, hd, 11, C.ink);
    ctx.fillStyle = C.mute; ctx.font = '400 10px Michroma, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('N', w - 10, 16);
    ctx.beginPath(); ctx.moveTo(w - 6, 22); ctx.lineTo(w - 6, 40); ctx.strokeStyle = C.mute; ctx.lineWidth = 1; ctx.stroke();
  }, [src, others.join()], 50);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Navigation plot: own ship at the centre, north up, grid in sector units" />;
}

const QUADS = [['shieldFore', 'Fore', 0], ['shieldStbd', 'Starboard', 90], ['shieldAft', 'Aft', 180], ['shieldPort', 'Port', 270]];
const polar = (deg, r) => [120 + r * Math.sin((deg * Math.PI) / 180), 120 - r * Math.cos((deg * Math.PI) / 180)];
const arc = (a0, a1, r) => { const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };

/** Top-down ship with an arc per quadrant, coloured by strength; an arc flares white for 300 ms when it takes a hit. */
function ShieldRing({ src }) {
  const prev = useRef({}), flare = useRef({});
  const up = read(src, 'shieldsUp') >= 0.5;
  const now = performance.now();
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', height: '100%', padding: '10px 12px', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Chip level={up ? 'ok' : 'off'}>{up ? 'SHIELDS UP' : 'SHIELDS DOWN'}</Chip>
        {QUADS.map(([k, l]) => { const lv = levelOf(k, read(src, k)); return lv ? <Chip key={k} level={lv}>{l.toUpperCase()} {lv === 'crit' ? 'RED' : 'YELLOW'}</Chip> : null; })}
      </div>
      <div style={{ position: 'relative', minHeight: 0 }}>
      <svg viewBox="0 0 240 240" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img"
        aria-label={`Shields ${up ? 'up' : 'down'}: ${QUADS.map(([k, l]) => `${l} ${fmt(read(src, k), 0)}%`).join(', ')}`}>
        <g fill="#3a4048" stroke="#56625e" strokeWidth="1">
          <path d="M104 126 L80 152 M136 126 L160 152" stroke="#56625e" strokeWidth="5" />
          <rect x="72" y="140" width="14" height="66" rx="6" /><rect x="154" y="140" width="14" height="66" rx="6" />
          <rect x="115" y="98" width="10" height="30" /><ellipse cx="120" cy="150" rx="13" ry="36" />
          <circle cx="120" cy="82" r="40" /><circle cx="120" cy="82" r="7" fill="#56625e" />
        </g>
        {QUADS.map(([k, l, mid]) => {
          const v = read(src, k);
          if (v != null) {
            if (prev.current[k] != null && v < prev.current[k] - 2) flare.current[k] = now + 300;
            prev.current[k] = v;
          }
          const lv = levelOf(k, v);
          const hit = flare.current[k] > now;
          const col = hit ? '#ffffff' : levelColor(lv) ?? C.chart1;
          const [tx, ty] = polar(mid, mid % 180 ? 98 : 104);
          return (
            <g key={k}>
              <path d={arc(mid - 38, mid + 38, 108)} fill="none" stroke="#ffffff10" strokeWidth="9" strokeLinecap="round" />
              <path d={arc(mid - 38, mid + 38, 108)} fill="none" stroke={col} strokeOpacity={up ? 0.25 + 0.75 * clamp((v ?? 0) / 100) : 0.25} strokeWidth="9" strokeLinecap="round" strokeDasharray={up ? undefined : '4 6'} style={{ filter: hit ? 'drop-shadow(0 0 6px #fff)' : undefined }} />
              <text x={tx} y={ty + (mid === 0 ? 14 : mid === 180 ? -6 : 4)} textAnchor={mid === 90 ? 'end' : mid === 270 ? 'start' : 'middle'} fontSize="12" fontFamily="Space Mono, monospace" fontWeight="700" fill={lv === 'crit' ? C.critInk : lv === 'warn' ? C.warn : C.ink}>{fmt(v, 0)}%</text>
            </g>
          );
        })}
      </svg>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center' }}>
        <span className="st-label">Generator load</span><HBar value={read(src, 'shieldLoad')} k="shieldLoad" max={150} label="Shield generator load" />
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}><Val src={src} k="shieldLoad" dec={0} /></span>
      </div>
    </div>
  );
}

function Bank({ src, k, label }) {
  const v = read(src, k);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
      <BarGauge value={v} k={k} label={label} min={0} max={100} h="auto" segs={14} dec={0} />
      <Chip level={v == null ? 'off' : v >= 99.5 ? 'ok' : 'info'}>{v == null ? '—' : v >= 99.5 ? 'CHARGED' : 'CHARGING'}</Chip>
    </div>
  );
}

function Torpedoes({ src }) {
  const tubes = Math.round(read(src, 'tubesLoaded') ?? 0), left = Math.round(read(src, 'torpedoes') ?? 0);
  const cap = Math.max(24, left);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 14, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[1, 2].map((n) => (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
            <span className="st-label">Tube {n}</span>
            <i aria-hidden="true" style={{ display: 'block', width: '100%', height: 12, borderRadius: 3, background: tubes >= n ? 'var(--lit-green)' : 'var(--lit-green-dim)', boxShadow: tubes >= n ? '0 0 6px 1px #3edb6a55, inset 0 0 4px #ffffff55' : 'inset 0 -3px 6px #0006' }} />
            <Chip level={tubes >= n ? 'ok' : 'off'}>{tubes >= n ? 'LOADED' : 'RELOADING'}</Chip>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <Num value={read(src, 'torpedoes')} dec={0} className="st-num st-xl" /><span className="st-label">photon torpedoes left</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }} aria-hidden="true">
        {Array.from({ length: cap }, (_, i) => <i key={i} style={{ height: 6, borderRadius: 2, background: i < left ? C.amber : '#ffffff12', boxShadow: i < left ? '0 0 4px #ff9a1f66' : 'none' }} />)}
      </div>
    </div>
  );
}

/** Helm and navigation (DESIGN.md "Helm and navigation"); the helm also runs the weapons, as on the show. */
export default function Helm({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const src = shipId;
  useFeed(src, ['helm', 'shields', 'weapons', 'sensors']);
  const others = SHIPS.map((s) => s.id).filter((id) => id !== src);
  useSubscription(user?.groups?.includes('helm') ? others : [], ['helm']); // the task force on the plot; refused quietly where the role may not see other ships
  const cmd = useCommand(shipId);
  const st = (...g) => monState(user, src, g);
  const wf = read(src, 'warpFactor'), up = read(src, 'shieldsUp') >= 0.5, imp = read(src, 'impulse');
  const sp = read(src, 'speed');
  const order = cmd.send;
  const warpTo = (f) => { const x = clamp(Math.round(f), 0, 9); order('helm.warp', { factor: x }); };
  const keys = {
    ArrowUp: () => warpTo((wf ?? 0) + 1), ArrowDown: () => warpTo((wf ?? 0) - 1),
    i: () => order('helm.impulse', { percent: 100 }), x: () => order('helm.stop', {}),
    ArrowLeft: () => order('helm.heading', { delta: -5 }), ArrowRight: () => order('helm.heading', { delta: 5 }),
    'Shift+S': () => order('tactical.shields', { up: !up }),
    p: () => order('tactical.phasers', { bank: 'fore' }), 'Shift+P': () => order('tactical.torpedo', {}),
  };
  for (let d = 0; d <= 9; d++) keys[String(d)] = () => warpTo(d);
  useKeys(keys);
  const sys = (ks) => worst(ks.map((k) => levelOf(k, read(src, k))));

  const desk = (
    <ConsoleStrip seed={7} jewels={[J('HELM', sys(['warpFactor', 'descentRate']), st('helm')), J('SHIELDS', sys(['shieldFore', 'shieldAft', 'shieldPort', 'shieldStbd', 'shieldLoad']), st('shields')), J('WEAPONS', sys(['phaserTemp']), st('weapons')), J('SENSORS', sys(['contactRange']), st('sensors'))]}>
      <LitButton color="amber" label="Warp −" keyCap="↓" onClick={keys.ArrowDown} {...cmd.bind('helm.warp')} />
      <LitButton color="amber" label="Warp +" keyCap="↑" onClick={keys.ArrowUp} {...cmd.bind('helm.warp')} lit={wf >= 1} />
      <LitButton color="amber" label="Full impulse" keyCap="I" onClick={keys.i} {...cmd.bind('helm.impulse')} lit={imp >= 99} />
      <LitButton color="red" label="All stop" keyCap="X" onClick={keys.x} {...cmd.bind('helm.stop')} />
      <LitButton color="white" label="Port 5°" keyCap="←" onClick={keys.ArrowLeft} {...cmd.bind('helm.heading')} />
      <LitButton color="white" label="Stbd 5°" keyCap="→" onClick={keys.ArrowRight} {...cmd.bind('helm.heading')} />
      <LitButton color="green" label="Shields" keyCap="⇧ S" onClick={keys['Shift+S']} {...cmd.bind('tactical.shields')} pressed={up} />
      <LitButton color="red" label="Phasers" keyCap="P" onClick={keys.p} {...cmd.bind('tactical.phasers')} />
      <LitButton color="red" label="Torpedo" keyCap="⇧ P" onClick={keys['Shift+P']} {...cmd.bind('tactical.torpedo')} />
    </ConsoleStrip>
  );

  return (
    <Station name="Helm" division="command" ship={src} rows="minmax(300px, 1.35fr) minmax(250px, 1fr)" desk={desk}>
        <Monitor title="Navigation plot" meta={`${shipCode(src)} · north up · ${SPAN} su`} state={st('helm')} className="st-c8" style={{ '--mh': '340px' }}>
          <NavPlot src={src} others={others} />
        </Monitor>
        <Monitor title="Warp factor" meta="cubic warp scale" state={st('helm')} className="st-c4">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '6px 16px 14px', gap: 10 }}>
            <div style={{ maxWidth: 180, width: '100%', margin: '0 auto' }}>
              <ArcGauge value={wf} k="warpFactor" min={0} max={9} ticks={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} numClass="st-num st-hero" dec={2} unit="" below />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center' }}>
              <span className="st-label">Impulse</span><HBar value={imp} k="impulse" label="Impulse power" />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}><Num value={imp} dec={0} className="" /><span className="st-unit">%</span></span>
            </div>
            <dl className="st-kv">
              <dt>Speed</dt><dd><Num value={sp} dec={sp != null && sp < 10 ? 2 : 0} className="" /><span className="st-unit">× light</span></dd>
              <dt>Heading</dt><dd><Num value={read(src, 'heading')} dec={1} className="" /><span className="st-unit">°</span></dd>
              <dt>Position</dt><dd><Num value={read(src, 'posX')} dec={1} className="" /><span className="st-unit">,</span> <Num value={read(src, 'posY')} dec={1} className="" /><span className="st-unit">su</span></dd>
              {read(src, 'orbitAlt') > 50 && <><dt>Orbit altitude</dt><dd><Num value={read(src, 'orbitAlt')} dec={0} className="" /><span className="st-unit">km</span></dd><dt>Descent rate</dt><dd><Val src={src} k="descentRate" dec={0} /></dd></>}
            </dl>
          </div>
        </Monitor>
        <Monitor title="Shields" meta="four quadrants" state={st('shields')} className="st-c4" style={{ '--mh': '340px' }}>
          <ShieldRing src={src} />
        </Monitor>
        <Monitor title="Phaser banks" meta="charge" state={st('weapons')} className="st-c4" style={{ '--mh': '280px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 18, height: '100%', padding: 14 }}>
            <Bank src={src} k="phaserFore" label="Fore" />
            <Bank src={src} k="phaserAft" label="Aft" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <Readout src={src} k="phaserTemp" label="Coolant temperature" />
            </div>
          </div>
        </Monitor>
        <Monitor title="Photon torpedoes" meta="tubes and magazine" state={st('weapons')} className="st-c4">
          <Torpedoes src={src} />
        </Monitor>
    </Station>
  );
}

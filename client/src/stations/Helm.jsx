import { useAuth } from '../lib/auth.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { hitOn } from '../lib/ship.js';
import { SHIPS, eachSlot, levelOf, meta, monState, read, ringOf, shipCode, stardate, useCommand, useFeed, worst } from './parts/data.js';
import { BarGauge, Chip, ConsoleStrip, HBar, Headline, J, LampBar, LevelChip, LitButton, Monitor, Num, Readings, Station, useKeys } from '../ui/index.js';
import { C, Val, clamp, fmt, levelColor, useCanvas } from './parts/ui.jsx';

const REACH = 160; // sector units from the centre of the astrogator disc to its rim
const fresh = (src) => { const r = ringOf(src, 'posX'); return r?.len && Date.now() - r.lastTs < 5000; };
const RAD = Math.PI / 180;
// the astrogator's backlit plotting glass and its ink (RESEARCH.md, Bridge consoles: pale disc, yellow centre, red and green lines)
const GLASS = { hi: '#fbf6e3', mid: '#efe4c1', rim: '#d8c993', ink: '#1d1e20', faint: '#1d1e2055', centre: '#f4c43c', course: '#c8261c', trail: '#1f7a39' };

function chevron(ctx, x, y, deg, size, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(deg * RAD);
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.35); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}

/**
 * The astrogator between helm and navigation: a backlit plotting disc, north up, own ship at the centre. Range rings
 * every 50 sector units and a bearing ring, the two-minute trail in green, the one-minute course in red ending in the
 * "flying point", the task force (pinned to the rim when out of range) and the nearest contact's bearing.
 */
function Astrogator({ src, others }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) / 2 - 9, cx = w / 2, cy = h / 2;
    if (R < 30) return; // too small to plot; a negative radius would throw and stop the shared frame loop
    // the dark ring the glass sits in, then the glass
    ctx.fillStyle = '#1c1f23'; ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff59'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R + 8.5, 0, Math.PI * 2); ctx.stroke();
    const glass = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.05, cx, cy, R);
    glass.addColorStop(0, GLASS.hi); glass.addColorStop(0.75, GLASS.mid); glass.addColorStop(1, GLASS.rim);
    ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    const x = read(src, 'posX'), y = read(src, 'posY');
    if (x == null || y == null) return;
    const hd = read(src, 'heading') ?? 0, sp = read(src, 'speed') ?? 0;
    const s = (R - 22) / REACH;
    const P = (px, py) => [cx + (px - x) * s, cy - (py - y) * s];
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    // the yellow centre plate out to 25 su, the range rings and the rays of the coordinate grid
    ctx.fillStyle = GLASS.centre; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(cx, cy, 25 * s, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = GLASS.faint; ctx.lineWidth = 1;
    for (let a = 0; a < 360; a += 30) { ctx.beginPath(); ctx.moveTo(cx + Math.sin(a * RAD) * 25 * s, cy - Math.cos(a * RAD) * 25 * s); ctx.lineTo(cx + Math.sin(a * RAD) * (R - 22), cy - Math.cos(a * RAD) * (R - 22)); ctx.stroke(); }
    ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = GLASS.ink; ctx.textAlign = 'left';
    for (const rr of [50, 100, 150]) {
      ctx.strokeStyle = rr === 100 ? GLASS.ink : GLASS.faint; ctx.lineWidth = rr === 100 ? 1.2 : 1;
      ctx.beginPath(); ctx.arc(cx, cy, rr * s, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(`${rr} su`, cx + rr * s * 0.71 + 3, cy - rr * s * 0.71 - 2);
    }
    // the two-minute trail
    const r = ringOf(src, 'posX');
    ctx.strokeStyle = GLASS.trail; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    const n = eachSlot(r, 120000, () => {}), every = Math.max(1, Math.floor(n / 240));
    let first = true;
    ctx.beginPath();
    eachSlot(r, 120000, (i) => { const [px, py] = P(r.cols.posX[i], r.cols.posY[i]); if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); }, every);
    ctx.stroke();
    // the course: where the ship will be in one minute at this speed (DOMAIN.md: speed / 400 su a second)
    const ahead = Math.min(REACH - 4, Math.max(12, (sp / 400) * 60));
    const fx = cx + Math.sin(hd * RAD) * ahead * s, fy = cy - Math.cos(hd * RAD) * ahead * s;
    ctx.strokeStyle = GLASS.course; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke(); ctx.setLineDash([]);
    // the flying point: a bright spot at the course's end
    const fp = ctx.createRadialGradient(fx, fy, 0, fx, fy, 11);
    fp.addColorStop(0, '#ffffff'); fp.addColorStop(0.35, '#ff6a4d'); fp.addColorStop(1, '#ff6a4d00');
    ctx.fillStyle = fp; ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t / 260); ctx.beginPath(); ctx.arc(fx, fy, 11, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    // the task force: in range on the plot, otherwise pinned to the rim on their bearing
    ctx.font = '700 10px "Space Mono", monospace';
    for (const id of others) {
      if (!fresh(id)) continue;
      let [px, py] = P(read(id, 'posX'), read(id, 'posY'));
      const d = Math.hypot(px - cx, py - cy), lim = R - 30;
      const off = d > lim;
      if (off) { px = cx + ((px - cx) / d) * lim; py = cy + ((py - cy) / d) * lim; }
      ctx.globalAlpha = off ? 0.6 : 1;
      chevron(ctx, px, py, read(id, 'heading') ?? 0, 7, GLASS.ink);
      ctx.fillStyle = GLASS.ink; ctx.textAlign = px > cx ? 'right' : 'left';
      ctx.fillText(shipCode(id), px + (px > cx ? -11 : 11), py + 4);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // the bearing ring: ticks every 10°, numbers every 30°
    ctx.strokeStyle = GLASS.ink; ctx.fillStyle = GLASS.ink; ctx.font = '400 10px "Space Mono", monospace'; ctx.textAlign = 'center';
    for (let a = 0; a < 360; a += 10) {
      const long = a % 30 === 0, r0 = R - (long ? 9 : 5);
      ctx.lineWidth = long ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a * RAD) * R, cy - Math.cos(a * RAD) * R); ctx.lineTo(cx + Math.sin(a * RAD) * r0, cy - Math.cos(a * RAD) * r0); ctx.stroke();
      if (long) ctx.fillText(a === 0 ? 'N' : String(a).padStart(3, '0'), cx + Math.sin(a * RAD) * (R - 17), cy - Math.cos(a * RAD) * (R - 17) + 3.5);
    }
    // the nearest sensor contact: a mark on the bearing ring (its range is in km, not on this grid)
    const contacts = read(src, 'contacts'), brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
    if (contacts >= 1 && brg != null) {
      const a = (hd + brg) * RAD, col = levelColor(levelOf('contactRange', rng)) === C.crit ? '#b3121f' : '#1b5fb4';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * (R - 30), cy - Math.cos(a) * (R - 30)); ctx.lineTo(cx + Math.sin(a) * (R - 1), cy - Math.cos(a) * (R - 1)); ctx.stroke();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t / 300); ctx.beginPath(); ctx.arc(cx + Math.sin(a) * (R - 34), cy - Math.cos(a) * (R - 34), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.font = '700 11px "Space Mono", monospace';
      const lx = cx + Math.sin(a) * (R - 48), ly = cy - Math.cos(a) * (R - 48);
      ctx.textAlign = Math.sin(a) > 0.2 ? 'right' : Math.sin(a) < -0.2 ? 'left' : 'center';
      ctx.fillText(`CONTACT ${fmt(brg, 0).padStart(3, '0')}° · ${fmt(rng, 0)} km`, lx, ly + 4);
    }
    chevron(ctx, cx, cy, hd, 11, GLASS.ink);
  }, [src, others.join()], 50);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Astrogator: own ship at the centre, north up, range rings every 50 sector units, course in red" />;
}

/** The astrogator's housing: the sensors alert lamp on top, the disc, then the chronometer and position windows. */
function AstrogatorPanel({ src, others }) {
  const rng = read(src, 'contactRange'), lv = read(src, 'contacts') >= 1 ? levelOf('contactRange', rng) : null;
  const orbit = read(src, 'orbitAlt') > 50;
  return (
    <div className="astro">
      <div className="astro__alert" data-level={lv ?? undefined}>
        <i className="astro__lamp" aria-hidden="true" />
        <span>Sensors alert</span>
        <b>{lv === 'crit' ? 'COLLISION RANGE' : lv === 'warn' ? 'CONTACT CLOSING' : 'CLEAR'}</b>
      </div>
      <div className="astro__disc"><Astrogator src={src} others={others} /></div>
      <dl className="astro__log">
        <div><dt>Stardate</dt><dd>{fmt(stardate(Date.now()), 2)}</dd></div>
        <div><dt>Heading</dt><dd><Num value={read(src, 'heading')} dec={1} /><span className="st-unit">°</span></dd></div>
        <div><dt>Speed</dt><dd><Num value={read(src, 'speed')} dec={read(src, 'speed') < 10 ? 2 : 0} /><span className="st-unit">× light</span></dd></div>
        <div><dt>Position</dt><dd><Num value={read(src, 'posX')} dec={1} /><span className="st-unit">,</span> <Num value={read(src, 'posY')} dec={1} /><span className="st-unit">su</span></dd></div>
        {orbit && <div><dt>Orbit altitude</dt><dd><Num value={read(src, 'orbitAlt')} dec={0} /><span className="st-unit">km</span></dd></div>}
        {orbit && <div><dt>Descent rate</dt><dd><Val src={src} k="descentRate" dec={0} /></dd></div>}
      </dl>
    </div>
  );
}

const FAN = 60; // the targeting scanner shows 60° either side of the bow
const FAN_KM = 100_000; // its range scale; a contact further out sits on the rim
/** The targeting scanner at navigation: an amber fan ahead of the bow; the nearest contact sits under a crosshair ring. */
function TargetFan({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(h - 18, (w / 2 - 8) / Math.sin(FAN * RAD)), cx = w / 2, cy = h - 6, r0 = R * 0.18;
    if (R < 24) return; // too small to draw the fan
    const ang = (deg) => (deg - 90) * RAD; // 0 = straight ahead, up the screen
    const glow = ctx.createLinearGradient(0, cy - R, 0, cy);
    glow.addColorStop(0, '#ffd75e'); glow.addColorStop(1, '#f2a516');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R, ang(-FAN), ang(FAN)); ctx.arc(cx, cy, r0, ang(FAN), ang(-FAN), true); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a2a0699'; ctx.lineWidth = 1;
    for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.arc(cx, cy, r0 + ((R - r0) * k) / 5, ang(-FAN), ang(FAN)); ctx.stroke(); }
    for (let a = -FAN; a <= FAN; a += 10) { ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang(a)) * r0, cy + Math.sin(ang(a)) * r0); ctx.lineTo(cx + Math.cos(ang(a)) * R, cy + Math.sin(ang(a)) * R); ctx.stroke(); }
    // the forward phaser arc, 20° either side of the bow
    ctx.strokeStyle = '#1f9a44'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r0 + (R - r0) * 0.3, ang(-20), ang(20)); ctx.stroke();
    const n = read(src, 'contacts') ?? 0, brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
    ctx.font = '700 10px "Space Mono", monospace';
    if (n >= 1 && brg != null && rng != null) {
      const rel = ((brg + 180) % 360) - 180; // degrees off the bow, port negative
      if (Math.abs(rel) <= FAN) {
        const rr = r0 + (R - r0) * clamp(rng / FAN_KM, 0.02, 1);
        const x = cx + Math.cos(ang(rel)) * rr, y = cy + Math.sin(ang(rel)) * rr;
        ctx.strokeStyle = '#b3121f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 6); ctx.stroke();
        ctx.fillStyle = '#b3121f'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 200); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      } else {
        // off the fan: an arrow on the side it lies
        const left = rel < 0, ax = left ? 10 : w - 10;
        ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.moveTo(ax, 11); ctx.lineTo(ax + (left ? 9 : -9), 5); ctx.lineTo(ax + (left ? 9 : -9), 17); ctx.closePath(); ctx.fill();
        ctx.textAlign = left ? 'left' : 'right'; ctx.fillText(left ? 'PORT' : 'STBD', left ? 24 : w - 24, 15);
      }
    }
    ctx.fillStyle = '#3edb6a'; ctx.textAlign = 'left'; ctx.fillText('ATTI AUTO', 6, h - 6);
    ctx.textAlign = 'right'; ctx.fillText('AUTO INCL', w - 6, h - 6);
  }, [src], 50);
  return <canvas ref={ref} className="st-canvas" aria-hidden="true" />;
}

function Targeting({ src }) {
  const n = read(src, 'contacts') ?? 0, brg = read(src, 'contactBearing'), rng = read(src, 'contactRange');
  const tubes = Math.round(read(src, 'tubesLoaded') ?? 0), left = Math.round(read(src, 'torpedoes') ?? 0);
  const lv = n >= 1 ? levelOf('contactRange', rng) : null;
  const target = n >= 1 && brg != null && rng != null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px 10px', gap: 8 }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 90 }}>
        <TargetFan src={src} />
      </div>
      <p className="st-label" style={{ margin: 0, color: C.ink2 }}>
        {target ? <>Target <b className="mono" style={{ color: C.ink }}>{fmt(brg, 0).padStart(3, '0')}°</b> off the bow, <b className="mono" style={{ color: C.ink }}>{fmt(rng, 0)}</b> km{rng > FAN_KM ? ', beyond the scale' : ''} <LevelChip level={lv} warn="CLOSING" crit="COLLISION RANGE" /></> : 'No target. Sensors report no contact.'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {[1, 2].map((k) => <Chip key={k} level={tubes >= k ? 'ok' : 'off'}>{`TUBE ${k} ${tubes >= k ? 'LOADED' : 'RELOADING'}`}</Chip>)}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 6 }}><Num value={read(src, 'torpedoes')} dec={0} className="st-num st-sm" /><span className="st-label">torpedoes left</span></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(24, left)}, 1fr)`, gap: 2 }} aria-hidden="true">
        {Array.from({ length: Math.max(24, left) }, (_, i) => <i key={i} style={{ height: 5, borderRadius: 1, background: i < left ? C.amber : '#ffffff14' }} />)}
      </div>
    </div>
  );
}

const QUADS = [['shieldFore', 'Fore', 0, 'fore'], ['shieldStbd', 'Starboard', 90, 'stbd'], ['shieldAft', 'Aft', 180, 'aft'], ['shieldPort', 'Port', 270, 'port']];
const polar = (deg, r) => [120 + r * Math.sin((deg * Math.PI) / 180), 120 - r * Math.cos((deg * Math.PI) / 180)];
const arc = (a0, a1, r) => { const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };

/** Top-down ship with an arc per quadrant, coloured by strength; an arc flares white when the scenario's hit fx lands on it. */
function ShieldRing({ src }) {
  const up = read(src, 'shieldsUp') >= 0.5;
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
        {QUADS.map(([k, l, mid, quad]) => {
          const v = read(src, k);
          const lv = levelOf(k, v);
          const hit = hitOn(src, quad, 400);
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

/**
 * Helm and navigation (DESIGN.md "Helm and navigation", The 1966 set): the astrogator between three headline monitors,
 * warp factor, the weakest shield and phaser charge. Impulse, the four shield quadrants, both phaser banks, coolant and
 * the targeting scanner are each one page press away on the monitor they belong to.
 */
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
  const r = (k, label, dec = 0) => { const v = read(src, k); return { label, value: v, unit: meta(k)?.unit, dec, level: levelOf(k, v) }; };

  const QUADS = [['shieldFore', 'Fore'], ['shieldAft', 'Aft'], ['shieldPort', 'Port'], ['shieldStbd', 'Stbd']];
  const weakest = QUADS.reduce((w, [k, l]) => { const v = read(src, k); return v != null && (!w || v < w.v) ? { v, k, l } : w; }, null);
  const shieldLv = sys(QUADS.map(([k]) => k));
  const fore = read(src, 'phaserFore'), aft = read(src, 'phaserAft');
  const charge = fore == null && aft == null ? null : Math.min(fore ?? 100, aft ?? 100);

  const desk = (
    <ConsoleStrip seed={7} jewels={[J('Helm', sys(['warpFactor', 'descentRate']), st('helm')), J('Shields', sys(['shieldFore', 'shieldAft', 'shieldPort', 'shieldStbd', 'shieldLoad']), st('shields')), J('Weapons', sys(['phaserTemp']), st('weapons')), J('Sensors', sys(['contactRange']), st('sensors'))]}>
      <LitButton color="amber" label="Warp −" keyCap="↓" onClick={keys.ArrowDown} {...cmd.bind('helm.warp')} />
      <LitButton color="amber" label="Warp +" keyCap="↑" onClick={keys.ArrowUp} {...cmd.bind('helm.warp')} lit={wf >= 1} />
      <LitButton color="amber" label="Impulse" keyCap="I" onClick={keys.i} {...cmd.bind('helm.impulse')} lit={imp >= 99} title="Full impulse" />
      <LitButton color="red" label="All stop" keyCap="X" onClick={keys.x} {...cmd.bind('helm.stop')} />
      <LitButton color="white" label={<>Port <span className="mono">5°</span></>} keyCap="←" onClick={keys.ArrowLeft} {...cmd.bind('helm.heading')} />
      <LitButton color="white" label={<>Stbd <span className="mono">5°</span></>} keyCap="→" onClick={keys.ArrowRight} {...cmd.bind('helm.heading')} />
      <LitButton color="green" label="Shields" keyCap="⇧ S" onClick={keys['Shift+S']} {...cmd.bind('tactical.shields')} pressed={up} />
      <LitButton color="red" label="Phasers" keyCap="P" onClick={keys.p} {...cmd.bind('tactical.phasers')} />
      <LitButton color="red" label="Torpedo" keyCap="⇧ P" onClick={keys['Shift+P']} {...cmd.bind('tactical.torpedo')} />
    </ConsoleStrip>
  );

  return (
    <Station name="Helm" division="command" ship={src} rows="minmax(250px, 1fr) minmax(250px, 1fr)" desk={desk}>
      <Monitor title="Warp factor" status={sys(['warpFactor']) ?? 'ok'} state={st('helm')} className="st-c3" style={{ gridRow: 1 }} index={0}
        views={[
          { label: 'Warp', content: (
            <Headline value={wf} dec={1} level={levelOf('warpFactor', wf)} word={wf != null && wf < 0.05 ? (imp >= 1 ? 'IMPULSE' : 'ALL STOP') : undefined}>
              <LampBar value={wf} k="warpFactor" min={0} max={9} segs={18} label="Warp factor" />
            </Headline>
          ) },
          { label: 'Impulse', content: (
            <Headline value={imp} unit="% impulse" level={levelOf('impulse', imp)}>
              <LampBar value={imp} k="impulse" min={0} max={100} label="Impulse power" />
            </Headline>
          ) },
        ]} />
      <Monitor title="Astrogator" meta={`${shipCode(src)} · north up`} state={st('helm')} className="st-c6 monitor--astro" style={{ gridRow: '1 / span 2', '--mh': 'auto' }} index={1}>
        <AstrogatorPanel src={src} others={others} />
      </Monitor>
      <Monitor title="Shields" status={shieldLv ?? 'ok'} state={st('shields')} className="st-c3" style={{ gridRow: '1 / span 2', '--mh': 'auto' }} index={2}
        views={[
          { label: 'Weakest', content: (
            <Headline value={weakest?.v} unit={`% ${weakest ? weakest.l.toLowerCase() : ''}`} level={levelOf(weakest?.k, weakest?.v)} word={up ? 'UP' : 'DOWN'}>
              <LampBar value={weakest?.v} k={weakest?.k ?? 'shieldFore'} min={0} max={100} label="Weakest shield quadrant" />
            </Headline>
          ) },
          { label: 'Quadrants', content: <ShieldRing src={src} /> },
          { label: 'Detail', content: <Readings items={[...QUADS.map(([k, l]) => r(k, l)), r('shieldLoad', 'Load')]} /> },
        ]} />
      <Monitor title="Weapons" status={sys(['phaserTemp']) ?? 'ok'} state={st('weapons', 'sensors')} className="st-c3" style={{ gridRow: 2 }} index={3}
        views={[
          { label: 'Phasers', content: (
            <Headline value={charge} unit="% charged" level={null} word={charge != null && charge >= 99.5 ? 'CHARGED' : undefined}>
              <LampBar value={charge} k="phaserFore" min={0} max={100} label="Phaser charge, weaker bank" />
            </Headline>
          ) },
          { label: 'Banks', content: (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 12, height: '100%', padding: '10px 12px' }}>
              <Bank src={src} k="phaserFore" label="Fore" />
              <Bank src={src} k="phaserAft" label="Aft" />
              <Readings items={[r('phaserTemp', 'Coolant')]} />
            </div>
          ) },
          { label: 'Targeting', content: <Targeting src={src} /> },
        ]} />
    </Station>
  );
}

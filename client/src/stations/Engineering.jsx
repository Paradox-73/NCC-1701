import { useState } from 'react';
import Chart from '../components/Chart.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { levelOf, meta, monState, read, useCommand, useFeed, worst } from './parts/data.js';
import { useHistory, useHistoryData } from './parts/history.js';
import { ArcGauge, BarGauge, C, Chip, ConsoleStrip, HBar, LevelChip, LitButton, Monitor, Num, Readout, clamp, decOf, fmt, useCanvas } from './parts/ui.jsx';

// DOMAIN.md deck names (our choice; the show never gave a full deck plan) and the hull profile each band draws
const DECKS = ['Bridge', "Officers' quarters", 'Crew quarters', 'Laboratories', 'Sickbay', 'Recreation', 'Transporter rooms', 'Shuttle hangar', 'Cargo and food stores', 'Life support plant', 'Main engineering', 'Impulse and auxiliary control'];
const PROFILE = [0.2, 0.52, 0.84, 1, 0.94, 0.72, 0.18, 0.36, 0.58, 0.62, 0.58, 0.44];
const pad2 = (n) => String(n).padStart(2, '0');
const deckKeys = (d) => [`o2_${pad2(d)}`, `co2_${pad2(d)}`, `temp_${pad2(d)}`, `press_${pad2(d)}`, `grav_${pad2(d)}`];
const PRESETS = { cruise: [55, 15, 10, 20], combat: [30, 35, 25, 10], emergency: [10, 40, 10, 40] };
// validated with the dataviz checker on the void surface (CVD 8.0, so every segment also carries a direct label)
const ALLOC = [['allocWarp', 'Warp', '#C9790E'], ['allocShields', 'Shields', '#3A8BDD'], ['allocWeapons', 'Weapons', '#C95BB5'], ['allocLife', 'Life support', '#2A9E74']];
const XP = ['IDLE', 'ENERGIZING', 'TRANSPORTING', 'FAULT'];

/** Intermix column with plasma rising at the reaction rate, and conduits carrying it up to the two nacelles. */
function Chamber({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const rate = read(src, 'reactionRate') ?? 0;
    const hot = levelOf('chamberTemp', read(src, 'chamberTemp')) ?? levelOf('reactionRate', rate);
    const glow = hot === 'crit' ? C.crit : hot === 'warn' ? C.warn : C.amber;
    const k = clamp(rate / 100, 0, 1.3);
    const cx = w / 2, top = 46, bot = h - 14, cw = Math.min(34, w * 0.22);
    // conduits to the nacelles
    const ports = [[14, 16, read(src, 'nacellePort') ?? 0], [w - 14, 16, read(src, 'nacelleStbd') ?? 0]];
    for (const [nx, ny, out] of ports) {
      ctx.strokeStyle = '#ffffff1a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, top + 4); ctx.lineTo(nx, ny + 10); ctx.stroke();
      const f = clamp(out / 100, 0, 1.3);
      for (let i = 0; i < 6; i++) {
        const p = ((t / 1000) * (0.25 + f * 0.6) + i / 6) % 1;
        ctx.fillStyle = glow; ctx.globalAlpha = f * (0.35 + 0.65 * (1 - p));
        ctx.beginPath(); ctx.arc(cx + (nx - cx) * p, top + 4 + (ny + 10 - top - 4) * p, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.2 + 0.8 * clamp(f); ctx.fillStyle = glow;
      ctx.shadowColor = glow; ctx.shadowBlur = 14 * f;
      ctx.beginPath(); ctx.ellipse(nx, ny + 6, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // the column: glass, then plasma bands rising at a speed set by the reaction rate
    const g = ctx.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
    g.addColorStop(0, '#ffffff10'); g.addColorStop(0.5, '#ffffff22'); g.addColorStop(1, '#ffffff08');
    ctx.fillStyle = g; ctx.fillRect(cx - cw / 2, top, cw, bot - top);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - cw / 2, top, cw, bot - top); ctx.clip();
    const H = bot - top, n = 7, speed = 18 + k * 90;
    for (let i = 0; i < n; i++) {
      const y = bot - (((t / 1000) * speed + (i * H) / n) % H);
      const b = ctx.createRadialGradient(cx, y, 0, cx, y, cw * 0.9);
      b.addColorStop(0, '#fff8e6'); b.addColorStop(0.25, glow); b.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.15 + 0.75 * clamp(k); ctx.fillStyle = b;
      ctx.fillRect(cx - cw, y - cw * 0.9, cw * 2, cw * 1.8);
    }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1; ctx.strokeRect(cx - cw / 2 + 0.5, top + 0.5, cw - 1, bot - top - 1);
    for (let y = top + 12; y < bot; y += 18) { ctx.fillStyle = '#00000080'; ctx.fillRect(cx - cw / 2, y, cw, 2); }
    ctx.font = '400 9px Michroma, sans-serif'; ctx.fillStyle = C.mute; ctx.textAlign = 'left';
    ctx.fillText('PORT', 4, 44); ctx.textAlign = 'right'; ctx.fillText('STBD', w - 4, 44);
  }, [src], 33);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Reaction chamber: plasma rises at the reaction rate and flows to both nacelles" />;
}

function PowerBar({ src }) {
  const vals = ALLOC.map(([k]) => read(src, k));
  const total = vals.reduce((a, v) => a + (v ?? 0), 0) || 1;
  const preset = Object.entries(PRESETS).find(([, p]) => p.every((x, i) => Math.abs((vals[i] ?? -99) - x) < 2))?.[0];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', alignItems: 'center', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: '1 1 300px' }}>
        <div style={{ display: 'flex', gap: 2, height: 30, borderRadius: 4, overflow: 'hidden' }} role="img" aria-label={`Power allocation: ${ALLOC.map(([, l], i) => `${l} ${fmt(vals[i], 0)}%`).join(', ')}`}>
          {ALLOC.map(([k, , col], i) => <i key={k} style={{ flex: `${Math.max(0.001, vals[i] ?? 0)} 1 0`, background: col, transition: 'flex-grow 600ms cubic-bezier(0.2,0,0,1)' }} />)}
        </div>
        <div className="st-legend">
          {ALLOC.map(([k, l, col], i) => <span key={k}><i style={{ background: col }} />{l} <b className="mono" style={{ fontFamily: 'var(--font-mono)', color: C.ink }}>{fmt(((vals[i] ?? 0) / total) * 100, 0)}%</b></span>)}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
        <div className="st-ro"><span className="st-label">Preset</span><span className="st-num st-xs" style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 12, letterSpacing: '0.08em' }}>{preset ? preset.toUpperCase() : 'CUSTOM'}</span></div>
        <div style={{ width: 150 }}><Readout src={src} k="powerTotal" label="Total output" unit="% rated" sparkH={22} /></div>
        <div style={{ width: 110 }} className="st-ro">
          <div className="st-ro-top"><span className="st-label">Battery</span><LevelChip level={levelOf('battery', read(src, 'battery'))} /></div>
          <span><Num v={read(src, 'battery')} dec={0} className="st-num st-sm" level={levelOf('battery', read(src, 'battery'))} /><span className="st-unit">%</span></span>
          <HBar v={read(src, 'battery')} k="battery" label="Emergency battery charge" />
        </div>
      </div>
    </div>
  );
}

/** Six pads of the transporter platform; they shimmer while energizing and transporting, flicker red on a fault. */
function Pads({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const st = Math.round(read(src, 'xpState') ?? 0);
    const r = Math.min(w / 9, h / 5.2);
    const pads = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) pads.push([w / 2 + (i - 1) * r * 2.6 + (row ? 0 : 0), h / 2 + (row - 0.5) * r * 2.2]);
    for (const [x, y] of pads) {
      ctx.fillStyle = '#1a1d22'; ctx.strokeStyle = '#ffffff26'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.55, r * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
      if (st === 0) continue;
      const col = st === 3 ? C.crit : st === 2 ? '#fff3c4' : C.amber;
      if (st === 3 && Math.floor(t / 180) % 2) continue;
      ctx.globalAlpha = st === 2 ? 0.85 : 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      if (st >= 1) {
        // the sparkle column of the original series' beam effect
        for (let i = 0; i < (st === 2 ? 26 : 10); i++) {
          const s = Math.sin(i * 12.9898 + Math.floor(t / 90) * 78.233) * 43758.5453;
          const fx = s - Math.floor(s), fy = (fx * 7.13 + i * 0.37) % 1;
          ctx.globalAlpha = 0.4 + 0.6 * fx; ctx.fillStyle = '#fffdf2';
          ctx.fillRect(x - r * 0.6 + fx * r * 1.2, y - r * 2.4 + fy * r * 2.4, 1.6, 1.6);
        }
      }
      ctx.globalAlpha = 1;
    }
  }, [src], 50);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Transporter pads" />;
}

function DeckStack({ src, sel, onSel }) {
  return (
    <div role="listbox" aria-label="Decks" className="st-fill-scroll" style={{ display: 'grid', gap: 3, padding: '10px 10px 10px 6px', height: '100%', alignContent: 'start' }}>
      {DECKS.map((name, i) => {
        const d = i + 1;
        const lv = worst(deckKeys(d).map((k) => levelOf(k, read(src, k))));
        const on = sel === d;
        return (
          <button key={d} type="button" role="option" aria-selected={on} onClick={() => onSel(d)} className="eng-deck" data-level={lv || undefined}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 34%) 26px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, minHeight: 23, padding: '0 6px', border: 0, borderRadius: 4, cursor: 'pointer', textAlign: 'left', background: on ? C.raised : 'transparent', boxShadow: on ? `inset 0 0 0 1px ${C.accent}88` : 'none' }}>
            <span style={{ display: 'flex', justifyContent: 'center' }} aria-hidden="true">
              <i style={{ display: 'block', height: 15, width: `${PROFILE[i] * 100}%`, borderRadius: i < 6 ? 8 : 4, background: lv === 'crit' ? 'var(--color-crit-fill)' : lv === 'warn' ? C.warn : on ? '#2b4a66' : '#23282f', boxShadow: lv ? `0 0 8px ${lv === 'crit' ? '#ff4a5566' : '#ffd23f55'}` : 'inset 0 1px 0 #ffffff12' }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: C.mute }}>{pad2(d)}</span>
            <span style={{ fontSize: 13, color: on ? C.ink : C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
            <LevelChip level={lv} warn="YELLOW" crit="RED" />
          </button>
        );
      })}
    </div>
  );
}

const DECK_FIELDS = [['o2', 'Oxygen'], ['co2', 'Carbon dioxide'], ['temp', 'Temperature'], ['press', 'Pressure'], ['grav', 'Gravity']];
function DeckDetail({ src, deck }) {
  const [field, setField] = useState('co2');
  const key = `${field}_${pad2(deck)}`;
  const m = meta(key);
  const { data, meta: hm } = useHistory(src, key, 600, !!m);
  const getData = useHistoryData(data, [src, key]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10, padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        {DECK_FIELDS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => setField(f)} aria-pressed={field === f}
            style={{ border: 0, borderRadius: 6, padding: '8px 10px 6px', textAlign: 'left', cursor: 'pointer', background: field === f ? C.raised : '#ffffff06', boxShadow: field === f ? `inset 0 0 0 1px ${C.accent}88` : 'none' }}>
            <Readout src={src} k={`${f}_${pad2(deck)}`} label={label} size="st-sm" sparkH={20} />
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column' }}>
        {m ? (
          <Chart key={key} fill x="time" title={`${m.label}, last 10 minutes · stored then live`} unit={m.unit} getData={getData}
            series={[{ label: 'Stored', color: C.mute, dec: decOf(key), unit: m.unit }, { label: 'Live', color: C.chart1, dec: decOf(key), unit: m.unit }]} />
        ) : <p className="st-label">This channel is not in the registry yet.</p>}
        <span className="st-label" style={{ marginTop: 4 }}>{hm.status === 'ready' ? `${hm.count.toLocaleString()} stored readings · ${hm.live.toLocaleString()} live since${hm.downsampled ? ' · thinned by the server' : ''}` : hm.status === 'error' ? `History unavailable: ${hm.error}` : 'Loading stored readings…'}</span>
      </div>
    </div>
  );
}

/** Engineering (DESIGN.md "Engineering"): reaction chamber, dilithium, nacelles, power, transporter, decks. */
export default function Engineering({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const src = shipId;
  useFeed(src, ['warp', 'impulse', 'power', 'transporter', 'lifesupport', 'gravity']);
  const [deck, setDeck] = useState(11);
  const cmd = useCommand(shipId);
  const st = (...g) => monState(user, src, g);
  const xp = Math.round(read(src, 'xpState') ?? 0);
  const preset = (p) => cmd.send('engineering.allocate', { preset: p }, `${p[0].toUpperCase()}${p.slice(1)} power allocation`);
  const presetOn = (p) => PRESETS[p].every((x, i) => Math.abs((read(src, ALLOC[i][0]) ?? -99) - x) < 2);
  const sys = (keys) => worst(keys.map((k) => levelOf(k, read(src, k))));
  const decksLv = worst(Array.from({ length: 12 }, (_, i) => sys(deckKeys(i + 1))));
  const warpLv = sys(['reactionRate', 'intermixDev', 'dilithiumEff', 'dilithiumTemp', 'chamberTemp', 'nacelleDelta', 'warpField']);
  const jewel = (lv, state) => (state !== 'live' ? 'off' : lv || 'ok');

  return (
    <div className="st-station" data-station="engineering">
      <div className="st-grid" style={{ '--rows': 'minmax(250px, 3fr) minmax(112px, 1.15fr) minmax(250px, 3.1fr)' }}>
        <Monitor title="Reaction chamber" meta="matter / antimatter" state={st('warp')} className="st-c4" style={{ '--mh': '300px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 44%) 1fr', height: '100%' }}>
            <div style={{ position: 'relative' }}><Chamber src={src} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 12px 4px', minWidth: 0 }}>
              <Readout src={src} k="reactionRate" label="Reaction rate" unit="% rated" />
              <Readout src={src} k="chamberTemp" label="Chamber temperature" />
              <dl className="st-kv">
                <dt>Intermix deviation</dt><dd><Num v={read(src, 'intermixDev')} dec={2} className="" level={levelOf('intermixDev', read(src, 'intermixDev'))} /><span className="st-unit">%</span></dd>
                <dt>Warp field</dt><dd><Num v={read(src, 'warpField')} dec={1} className="" level={levelOf('warpField', read(src, 'warpField'))} /><span className="st-unit">%</span></dd>
              </dl>
            </div>
          </div>
        </Monitor>
        <Monitor title="Dilithium" meta="crystal articulation" state={st('warp')} className="st-c4" style={{ '--mh': '300px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 16px 12px', gap: 6 }}>
            <span className="st-label">Crystal efficiency</span>
            <div style={{ maxWidth: 210, width: '100%', margin: '0 auto', flex: '1 1 auto', minHeight: 0 }}>
              <ArcGauge v={read(src, 'dilithiumEff')} k="dilithiumEff" min={0} max={100} ticks={[0, 25, 50, 75, 100]} unit="%" dec={1} numClass="st-num" />
            </div>
            <Readout src={src} k="dilithiumTemp" label="Crystal chamber temperature" />
          </div>
        </Monitor>
        <Monitor title="Nacelles" meta="warp and impulse" state={st('warp', 'impulse')} className="st-c4" style={{ '--mh': '300px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 18, height: '100%', padding: 14 }}>
            <BarGauge v={read(src, 'nacellePort')} k="nacellePort" label="Port" min={0} max={130} h="auto" segs={20} dec={0} />
            <BarGauge v={read(src, 'nacelleStbd')} k="nacelleStbd" label="Stbd" min={0} max={130} h="auto" segs={20} dec={0} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <Readout src={src} k="nacelleDelta" label="Imbalance" size="st-sm" sparkH={20} />
              <Readout src={src} k="impulseReactor" label="Impulse reactor" unit="% rated" size="st-sm" sparkH={20} />
              <Readout src={src} k="impulseTemp" label="Impulse temperature" size="st-sm" sparkH={20} />
            </div>
          </div>
        </Monitor>
        <Monitor title="Power allocation" meta="warp · shields · weapons · life support" state={st('power')} className="st-c8" style={{ '--mh': '150px' }}>
          <div className="st-pad" style={{ height: '100%' }}><PowerBar src={src} /></div>
        </Monitor>
        <Monitor title="Transporter" meta="room 1" state={st('transporter')} className="st-c4" style={{ '--mh': '150px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', height: '100%' }}>
            <div style={{ position: 'relative' }}><Pads src={src} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', justifyContent: 'center' }}>
              <Chip level={xp === 3 ? 'crit' : xp ? 'info' : 'off'}>{XP[xp] ?? 'IDLE'}</Chip>
              <dl className="st-kv" style={{ fontSize: 12 }}>
                <dt>Energy</dt><dd style={{ fontSize: 13 }}><Num v={read(src, 'xpEnergy')} dec={1} className="" level={levelOf('xpEnergy', read(src, 'xpEnergy'))} /><span className="st-unit">MW</span></dd>
                <dt>Lock</dt><dd style={{ fontSize: 13 }}><Num v={read(src, 'xpLock')} dec={0} className="" level={levelOf('xpLock', read(src, 'xpLock'))} /><span className="st-unit">%</span></dd>
                <dt>Pattern</dt><dd style={{ fontSize: 13 }}><Num v={read(src, 'xpPattern')} dec={1} className="" level={levelOf('xpPattern', read(src, 'xpPattern'))} /><span className="st-unit">%</span></dd>
              </dl>
            </div>
          </div>
        </Monitor>
        <Monitor title="Deck stack" meta="life support · gravity" state={st('lifesupport', 'gravity')} className="st-c5" style={{ '--mh': '340px' }}>
          <DeckStack src={src} sel={deck} onSel={setDeck} />
        </Monitor>
        <Monitor title={`Deck ${pad2(deck)} · ${DECKS[deck - 1]}`} meta="history and live" state={st('lifesupport', 'gravity')} className="st-c7" style={{ '--mh': '420px' }}>
          <DeckDetail src={src} deck={deck} />
        </Monitor>
      </div>
      <ConsoleStrip seed={11} cmd={cmd} jewels={[['WARP', jewel(warpLv, st('warp'))], ['IMPULSE', jewel(sys(['impulseReactor', 'impulseTemp']), st('impulse'))], ['POWER', jewel(sys(['powerTotal', 'battery']), st('power'))], ['DECKS', jewel(decksLv, st('lifesupport'))], ['TRANSPORT', jewel(xp === 3 ? 'crit' : sys(['xpEnergy', 'xpLock', 'xpPattern']), st('transporter'))]]}>
        <LitButton c="amber" label="Cruise" onClick={() => preset('cruise')} lit={presetOn('cruise')} pending={cmd.pending === 'engineering.allocate'} />
        <LitButton c="red" label="Combat" onClick={() => preset('combat')} lit={presetOn('combat')} pending={cmd.pending === 'engineering.allocate'} />
        <LitButton c="yellow" label="Emergency power" onClick={() => preset('emergency')} lit={presetOn('emergency')} pending={cmd.pending === 'engineering.allocate'} />
        <LitButton c="green" label="Energize" onClick={() => cmd.send('transporter.energize', {}, 'Energize')} lit={xp === 1 || xp === 2} pending={cmd.pending === 'transporter.energize'} />
        <LitButton c="red" label="Cold restart" onClick={() => cmd.send('engineering.coldRestart', {}, 'Cold restart')} pending={cmd.pending === 'engineering.coldRestart'} title="Only when a scenario asks for it" />
      </ConsoleStrip>
    </div>
  );
}

import { useState } from 'react';
import Chart from '../components/Chart.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { DECK_NAMES, levelOf, meta, monState, pad2, read, useCommand, useFeed, worst } from './parts/data.js';
import { useHistory, useHistoryData } from './parts/history.js';
import { ArcGauge, BarGauge, Chip, ConsoleStrip, HBar, J, LevelChip, LitButton, Monitor, Num, Station } from '../ui/index.js';
import { C, Readout, Val, calmRange, clamp, decOf, fmt, useCanvas } from './parts/ui.jsx';

// the hull profile each deck band draws, saucer then engineering hull
const PROFILE = [0.2, 0.52, 0.84, 1, 0.94, 0.72, 0.18, 0.36, 0.58, 0.62, 0.58, 0.44];
const deckKeys = (d) => [`o2_${pad2(d)}`, `co2_${pad2(d)}`, `temp_${pad2(d)}`, `press_${pad2(d)}`, `grav_${pad2(d)}`];
const PRESETS = { cruise: [55, 15, 10, 20], combat: [30, 35, 25, 10], emergency: [10, 40, 10, 40] };
// validated with the dataviz checker on the void surface (CVD 8.0, so every segment also carries a direct label)
const ALLOC = [['allocWarp', 'Warp', '#C9790E'], ['allocShields', 'Shields', '#3A8BDD'], ['allocWeapons', 'Weapons', '#C95BB5'], ['allocLife', 'Life support', '#2A9E74']];
const XP = ['IDLE', 'ENERGIZING', 'TRANSPORTING', 'FAULT'];
// the readout wall along the console band: [channel, label, decimals]
const READOUT_WALL = [['reactionRate', 'Reaction', 0], ['chamberTemp', 'Chamber', 1], ['intermixDev', 'Intermix', 2], ['warpField', 'Field', 1], ['dilithiumEff', 'Dilithium', 1], ['dilithiumTemp', 'Crystal', 0], ['nacellePort', 'Port nac', 0], ['nacelleStbd', 'Stbd nac', 0], ['impulseReactor', 'Impulse', 0], ['powerTotal', 'Output', 0], ['battery', 'Battery', 0]];

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

/**
 * Power allocation as the slide levers of the engineering desk (RESEARCH.md, Bridge consoles): one slot per system, its
 * red knob at the share of power. The levers show the allocation; the presets on the console set it (the server takes
 * presets only). Total output and the emergency battery sit in readout windows beside them.
 */
function SlideLevers({ src }) {
  const vals = ALLOC.map(([k]) => read(src, k));
  const total = vals.reduce((a, v) => a + (v ?? 0), 0) || 1;
  const preset = Object.entries(PRESETS).find(([, p]) => p.every((x, i) => Math.abs((vals[i] ?? -99) - x) < 2))?.[0];
  const battery = read(src, 'battery'), bLv = levelOf('battery', battery);
  return (
    <div className="levers">
      <div className="levers__bank">
        {ALLOC.map(([k, l, col], i) => {
          const pct = ((vals[i] ?? 0) / total) * 100;
          return (
            <div key={k} className="lever" role="meter" aria-label={`${l} ${fmt(pct, 0)}% of power`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={vals[i] == null ? undefined : Math.round(pct)}>
              <span className="lever__val"><Num value={pct} dec={0} /><span className="st-unit">%</span></span>
              <div className="lever__slot"><span className="lever__track" style={{ transform: `translateY(${(1 - clamp(pct / 100)) * 100}%)` }}><i className="lever__knob" /></span></div>
              <span className="lever__name"><i style={{ background: col }} aria-hidden="true" />{l}</span>
            </div>
          );
        })}
      </div>
      <div className="levers__side">
        <div className="levers__win"><span>Preset</span><b className="display" style={{ fontSize: 12, fontWeight: 400 }}>{preset ? preset.toUpperCase() : 'CUSTOM'}</b></div>
        <div className="levers__win levers__win--wide"><Readout src={src} k="powerTotal" label="Total output" unit="% rated" size="sm" sparkH={18} /></div>
        <div className="levers__win">
          <span>Battery</span>
          <b><Num value={battery} dec={0} level={bLv} /><span className="st-unit">%</span> <LevelChip level={bLv} /></b>
          <HBar value={battery} k="battery" label="Emergency battery charge" />
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
    <div role="listbox" aria-label="Decks" className="st-fill-scroll" style={{ display: 'grid', gap: 1, padding: '6px 10px 6px 6px', height: '100%', alignContent: 'start' }}>
      {DECK_NAMES.map((name, i) => {
        const d = i + 1;
        const lv = worst(deckKeys(d).map((k) => levelOf(k, read(src, k))));
        const on = sel === d;
        return (
          <button key={d} type="button" role="option" aria-selected={on} onClick={() => onSel(d)} className="eng-deck" data-level={lv || undefined}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 34%) 26px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, minHeight: 18, padding: '0 6px', border: 0, borderRadius: 4, cursor: 'pointer', textAlign: 'left', background: on ? C.raised : 'transparent', boxShadow: on ? `inset 0 0 0 1px ${C.accent}88` : 'none' }}>
            <span style={{ display: 'flex', justifyContent: 'center' }} aria-hidden="true">
              <i style={{ display: 'block', height: 12, width: `${PROFILE[i] * 100}%`, borderRadius: i < 6 ? 8 : 4, background: lv === 'crit' ? 'var(--crit-fill)' : lv === 'warn' ? C.warn : on ? '#2b4a66' : '#23282f', boxShadow: lv ? `0 0 8px ${lv === 'crit' ? '#ff4a5566' : '#ffd23f55'}` : 'inset 0 1px 0 #ffffff12' }} />
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
            <Readout src={src} k={`${f}_${pad2(deck)}`} label={label} size="sm" sparkH={20} />
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column' }}>
        {m ? (
          <Chart key={key} fill x="time" title={`${m.label}, last 10 minutes · stored then live`} unit={m.unit} getData={getData} yRange={calmRange(key)}
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
  const preset = (p) => cmd.send('engineering.allocate', { preset: p });
  const presetOn = (p) => PRESETS[p].every((x, i) => Math.abs((read(src, ALLOC[i][0]) ?? -99) - x) < 2);
  const sys = (keys) => worst(keys.map((k) => levelOf(k, read(src, k))));
  const decksLv = worst(Array.from({ length: 12 }, (_, i) => sys(deckKeys(i + 1))));
  const warpLv = sys(['reactionRate', 'intermixDev', 'dilithiumEff', 'dilithiumTemp', 'chamberTemp', 'nacelleDelta', 'warpField']);

  const desk = (
    <ConsoleStrip seed={11} readouts={READOUT_WALL.map(([k, l, dec]) => ({ label: l, value: <Num value={read(src, k)} dec={dec} />, unit: meta(k)?.unit }))} jewels={[J('WARP', warpLv, st('warp')), J('IMPULSE', sys(['impulseReactor', 'impulseTemp']), st('impulse')), J('POWER', sys(['powerTotal', 'battery']), st('power')), J('DECKS', decksLv, st('lifesupport')), J('TRANSPORT', xp === 3 ? 'crit' : sys(['xpEnergy', 'xpLock', 'xpPattern']), st('transporter'))]}>
      <LitButton color="amber" label="Cruise" onClick={() => preset('cruise')} lit={presetOn('cruise')} {...cmd.bind('engineering.allocate')} />
      <LitButton color="red" label="Combat" onClick={() => preset('combat')} lit={presetOn('combat')} {...cmd.bind('engineering.allocate')} />
      <LitButton color="yellow" label="Emergency power" onClick={() => preset('emergency')} lit={presetOn('emergency')} {...cmd.bind('engineering.allocate')} />
      <LitButton color="green" label="Energize" onClick={() => cmd.send('transporter.energize')} lit={xp === 1 || xp === 2} {...cmd.bind('transporter.energize')} />
      <LitButton color="red" label="Cold restart" onClick={() => cmd.send('engineering.coldRestart')} {...cmd.bind('engineering.coldRestart')} />
    </ConsoleStrip>
  );

  return (
    <Station name="Engineering" division="ops" ship={src} rows="minmax(236px, 2.6fr) minmax(150px, 1.3fr) minmax(270px, 2.6fr)" desk={desk}>
        <Monitor title="Reaction chamber" meta="matter / antimatter" state={st('warp')} className="st-c4" style={{ '--mh': '300px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 44%) 1fr', height: '100%' }}>
            <div style={{ position: 'relative' }}><Chamber src={src} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px 10px 4px', minWidth: 0 }}>
              <Readout src={src} k="reactionRate" label="Reaction rate" unit="% rated" sparkH={22} />
              <Readout src={src} k="chamberTemp" label="Chamber temperature" sparkH={22} />
              <dl className="st-kv" style={{ gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 8px' }}>
                <dt>Intermix</dt><dd style={{ fontSize: 14 }}><Val src={src} k="intermixDev" dec={2} /></dd>
                <dt>Field</dt><dd style={{ fontSize: 14 }}><Val src={src} k="warpField" dec={1} /></dd>
              </dl>
            </div>
          </div>
        </Monitor>
        <Monitor title="Dilithium" meta="crystal articulation" state={st('warp')} className="st-c4">
          <div className="st-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'center', height: '100%', padding: '8px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <span className="st-label">Crystal efficiency</span>
              <div style={{ width: '100%', maxWidth: 190 }}>
                <ArcGauge value={read(src, 'dilithiumEff')} k="dilithiumEff" min={0} max={100} ticks={[0, 25, 50, 75, 100]} unit="%" dec={1} numClass="st-num" below />
              </div>
            </div>
            <Readout src={src} k="dilithiumTemp" label="Crystal chamber temperature" sparkH={40} />
          </div>
        </Monitor>
        <Monitor title="Nacelles" meta="warp and impulse" state={st('warp', 'impulse')} className="st-c4" style={{ '--mh': '280px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 18, height: '100%', padding: 14 }}>
            <BarGauge value={read(src, 'nacellePort')} k="nacellePort" label="Port" min={0} max={130} h="auto" segs={20} dec={0} />
            <BarGauge value={read(src, 'nacelleStbd')} k="nacelleStbd" label="Stbd" min={0} max={130} h="auto" segs={20} dec={0} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <Readout src={src} k="nacelleDelta" label="Imbalance" size="sm" sparkH={20} />
              <Readout src={src} k="impulseReactor" label="Impulse reactor" unit="% rated" size="sm" spark={false} />
              <Readout src={src} k="impulseTemp" label="Impulse temperature" size="sm" spark={false} />
            </div>
          </div>
        </Monitor>
        <Monitor title="Power allocation" meta="slide levers · warp · shields · weapons · life support" state={st('power')} className="st-c8 monitor--housing monitor--levers" style={{ '--mh': '230px' }}>
          <SlideLevers src={src} />
        </Monitor>
        <Monitor title="Transporter" meta="room 1" state={st('transporter')} className="st-c4" style={{ '--mh': '160px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', height: '100%' }}>
            <div style={{ position: 'relative' }}><Pads src={src} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', justifyContent: 'center' }}>
              <Chip level={xp === 3 ? 'crit' : xp ? 'info' : 'off'}>{XP[xp] ?? 'IDLE'}</Chip>
              <dl className="st-kv" style={{ fontSize: 12, rowGap: 2 }}>
                <dt>Energy</dt><dd style={{ fontSize: 13 }}><Val src={src} k="xpEnergy" dec={1} /></dd>
                <dt>Lock</dt><dd style={{ fontSize: 13 }}><Val src={src} k="xpLock" dec={0} /></dd>
                <dt>Pattern</dt><dd style={{ fontSize: 13 }}><Val src={src} k="xpPattern" dec={1} /></dd>
              </dl>
            </div>
          </div>
        </Monitor>
        <Monitor title="Deck stack" meta="life support · gravity" state={st('lifesupport', 'gravity')} className="st-c5">
          <DeckStack src={src} sel={deck} onSel={setDeck} />
        </Monitor>
        <Monitor title={`Deck ${pad2(deck)} · ${DECK_NAMES[deck - 1]}`} meta="history and live" state={st('lifesupport', 'gravity')} className="st-c7" style={{ '--mh': '620px' }}>
          <DeckDetail src={src} deck={deck} />
        </Monitor>
    </Station>
  );
}

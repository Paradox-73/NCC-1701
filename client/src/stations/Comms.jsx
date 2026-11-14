import { useState } from 'react';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { state } from '../lib/store.js';
import { SHIPS, alertsFor, levelOf, linkOf, meta, monState, read, shipCode, shipName, stardate, useCommand, useFeed, worst } from './parts/data.js';
import { C, Chip, ConsoleStrip, J, LitButton, Monitor, Num, Readout, Station, clamp, fmt, useCanvas, useKeys } from './parts/ui.jsx';

const CARRIER_SLOTS = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86]; // where open channels sit across the band

/** Subspace waterfall: newest row on top, one bright line per open channel, noise floor from interference, gaps from loss. */
function Waterfall({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    const cv = ctx.canvas, k = Math.round(2 * (cv.width / w));
    // scroll the old rows down; 'copy' replaces pixels instead of stacking translucent rows into a solid block
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(cv, 0, 0, cv.width, cv.height - k, 0, k, cv.width, cv.height - k);
    ctx.restore();
    const carrier = read(src, 'carrier') ?? 0, noise = (read(src, 'interference') ?? 0) / 100, loss = (read(src, 'loss') ?? 0) / 100;
    const open = clamp(Math.round(read(src, 'channelsOpen') ?? 0), 0, CARRIER_SLOTS.length);
    ctx.clearRect(0, 0, w, 2);
    for (let x = 0; x < w; x += 2) {
      const r = Math.sin(x * 12.9898 + t * 0.0137) * 43758.5;
      let v = (r - Math.floor(r)) * (0.08 + noise * 0.9);
      for (let i = 0; i < open; i++) {
        const dx = x - CARRIER_SLOTS[i] * w;
        const drop = Math.sin((t / 80) * (i + 1.7)) * 0.5 + 0.5 < loss * 1.4; // lost frames show as gaps in the line
        if (!drop) v += (carrier / 60) * Math.exp(-(dx * dx) / 18);
      }
      v = clamp(v);
      ctx.fillStyle = v > 0.75 ? `rgba(235,248,255,${v})` : `rgba(88,196,255,${v * 0.95})`;
      ctx.fillRect(x, 0, 2, 2);
    }
  }, [src], 80);
  const open = clamp(Math.round(read(src, 'channelsOpen') ?? 0), 0, CARRIER_SLOTS.length);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={ref} className="st-canvas" role="img" aria-label={`Subspace waterfall: ${open} open channel${open === 1 ? '' : 's'}, newest at the top`} />
      {CARRIER_SLOTS.slice(0, open).map((x, i) => <span key={i} style={{ position: 'absolute', top: 6, left: `${x * 100}%`, transform: 'translateX(-50%)', font: '400 10px var(--font-mono)', color: C.ink2, textShadow: '0 1px 2px #000' }}>CH {i + 1}</span>)}
      <span style={{ position: 'absolute', left: 8, bottom: 6, font: '400 10px var(--font-mono)', color: C.mute }}>newest on top · older below</span>
    </div>
  );
}

/** Oscilloscope trace of the carrier: amplitude from carrier strength, noise from interference, with phosphor persistence. */
function SignalScope({ src }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.fillStyle = 'rgba(5,6,8,0.42)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#58c4ff14'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo((w * i) / 10, 0); ctx.lineTo((w * i) / 10, h); ctx.stroke(); }
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, (h * i) / 8); ctx.lineTo(w, (h * i) / 8); ctx.stroke(); }
    const carrier = read(src, 'carrier') ?? 0, noise = (read(src, 'interference') ?? 0) / 100;
    const A = clamp(carrier / 80) * (h / 2 - 12), mid = h / 2;
    ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 1.8; ctx.shadowColor = C.scope; ctx.shadowBlur = 8; ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const r = Math.sin(x * 78.233 + t * 0.07) * 43758.5;
      const y = mid - A * Math.sin((x / w) * Math.PI * 6 - t / 160) - (r - Math.floor(r) - 0.5) * noise * A * 1.6;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  }, [src], 40);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Carrier waveform" />;
}

const TARGETS = [{ id: 'command', code: 'SFC', name: 'Starfleet Command' }, ...SHIPS.filter((s) => s.id !== 1).map((s) => ({ id: s.id, code: s.code, name: s.name }))];

function Hail({ src, target, onTarget }) {
  const open = read(src, 'hailing') >= 0.5;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 6, background: open ? '#3edb6a14' : '#ffffff06', boxShadow: `inset 0 0 0 1px ${open ? '#3edb6a55' : '#ffffff10'}` }}>
        <i aria-hidden="true" style={{ width: 34, height: 14, borderRadius: 3, flex: 'none', background: open ? 'var(--lit-green)' : 'var(--lit-green-dim)', boxShadow: open ? '0 0 10px 2px #3edb6a66, inset 0 0 4px #fff8' : 'inset 0 -3px 6px #0007' }} />
        <span style={{ font: '400 11px/1.3 var(--font-display)', letterSpacing: '0.08em', color: open ? C.ready : C.mute }}>{open ? 'HAILING FREQUENCIES OPEN' : 'HAILING FREQUENCIES CLOSED'}</span>
        <span style={{ marginLeft: 'auto', font: '700 14px var(--font-mono)' }}><Num v={read(src, 'channelsOpen')} dec={0} className="" /><span className="st-unit">open</span></span>
      </div>
      <div role="radiogroup" aria-label="Hail target" style={{ display: 'grid', gap: 4 }}>
        {TARGETS.map((x) => {
          const link = x.id === 'command' ? (state.status === 'online' ? 'live' : 'lost') : linkOf(x.id);
          const sel = target === x.id;
          return (
            <button key={x.id} type="button" role="radio" aria-checked={sel} onClick={() => onTarget(x.id)}
              style={{ display: 'grid', gridTemplateColumns: '14px 74px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, minHeight: 34, padding: '0 10px', border: 0, borderRadius: 4, cursor: 'pointer', textAlign: 'left', background: sel ? C.raised : 'transparent', boxShadow: sel ? `inset 0 0 0 1px ${C.accent}88` : 'none' }}>
              <span className="st-jewel" data-s={link === 'live' ? 'ok' : link === 'lost' ? 'off' : 'info'} aria-hidden="true" />
              <span style={{ font: '400 12px var(--font-mono)', color: C.ink2 }}>{x.code}</span>
              <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
              <Chip level={link === 'live' ? 'ok' : link === 'lost' ? 'off' : 'info'}>{link === 'live' ? 'LINK' : link === 'lost' ? 'NO LINK' : 'UNKNOWN'}</Chip>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SEV = { critical: ['crit', 'RED'], warn: ['warn', 'YELLOW'], info: ['info', 'INFO'] };
function Log({ src, local }) {
  const items = [...local, ...alertsFor(src).slice(0, 300).map((a) => ({ id: a.id, ts: a.ts, sev: a.severity, from: shipCode(a.sourceId), text: a.message, fresh: a.arrivedAt && Date.now() - a.arrivedAt < 1500 }))].sort((a, b) => b.ts - a.ts);
  return (
    <VirtualList items={items} rowHeight={36} label="Message log" className="st-list" style={{ height: '100%' }}
      empty={<div className="st-blank"><b>NO TRAFFIC</b><span>Hails you send and alerts for this ship appear here.</span></div>}
      renderRow={(m) => {
        const [lv, word] = SEV[m.sev] ?? ['ok', 'SENT'];
        return (
          <div className={`st-row ${m.fresh ? 'new' : ''}`}>
            <span className="t">{fmt(stardate(m.ts), 2)}</span>
            <Chip level={lv}>{word}</Chip>
            <span className="t" style={{ color: C.ink2 }}>{m.from}</span>
            <span className="m" title={m.text}>{m.text}</span>
          </div>
        );
      }} />
  );
}

/** Communications (DESIGN.md "Communications"): subspace channels, hailing, the carrier scope and the message log. */
export default function Comms({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const src = shipId;
  useFeed(src, ['comms']);
  const [target, setTarget] = useState('command');
  const [intercom, setIntercom] = useState(false);
  const [local, setLocal] = useState([]);
  const cmd = useCommand(shipId);
  const st = (...g) => monState(user, src, g);
  const note = (text, sev) => setLocal((l) => [{ id: `l${Date.now()}`, ts: Date.now(), sev, from: shipCode(src), text }, ...l].slice(0, 50));
  const tgt = TARGETS.find((x) => x.id === target);
  const hail = async (priority) => {
    const say = `${priority ? 'Priority one message to' : 'Hailing'} ${tgt.name}`;
    await cmd.send('comms.hail', { target: priority ? 'command' : target }, say);
    note(say);
  };
  const close = async () => { await cmd.send('comms.close', {}, 'Close channel'); note('Channel closed'); };
  const hailing = read(src, 'hailing') >= 0.5;
  useKeys({ h: () => (hailing ? close() : hail(false)) });
  const sys = (ks) => worst(ks.map((k) => levelOf(k, read(src, k))));
  const p = (t) => cmd.pending === t;
  const desk = (
    <ConsoleStrip seed={31} cmd={cmd} jewels={[J('CARRIER', sys(['carrier']), st('comms')), J('DELAY', sys(['delay']), st('comms')), J('LOSS', sys(['loss']), st('comms')), J('NOISE', sys(['interference']), st('comms'))]}>
      <LitButton color="blue" label={`Hail ${tgt.code}`} keyCap="H" onClick={() => hail(false)} pending={p('comms.hail')} lit={hailing} />
      <LitButton color="white" label="Close channel" onClick={close} pending={p('comms.close')} />
      <LitButton color="red" label="Priority one" onClick={() => hail(true)} pending={p('comms.hail')} />
      <LitButton color="yellow" label="Intercom" pressed={intercom} onClick={() => { setIntercom(!intercom); note(intercom ? 'Intercom closed' : 'Intercom open to all decks'); }} title="Ship-wide announcement channel, local to this console" />
    </ConsoleStrip>
  );

  return (
    <Station name="Communications" division="ops" ship={src} rows="minmax(250px, 1.2fr) minmax(210px, 1fr)" desk={desk}>
      <Monitor title="Subspace channels" meta="receiver waterfall" state={st('comms')} className="st-c7">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(170px, 34%)', height: '100%' }} className="st-split">
          <div style={{ position: 'relative', minHeight: 180 }}><Waterfall src={src} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px', minWidth: 0, borderLeft: '1px solid #ffffff0d' }}>
            <Readout src={src} k="carrier" label="Carrier strength" size="st-sm" sparkH={20} />
            <Readout src={src} k="delay" label="Delay to Starfleet" size="st-sm" sparkH={20} />
            <Readout src={src} k="loss" label="Message loss" size="st-sm" sparkH={20} />
            <Readout src={src} k="interference" label="Interference" size="st-sm" sparkH={20} />
          </div>
        </div>
      </Monitor>
      <Monitor title="Hail" meta="task force · Starfleet" state={st('comms')} className="st-c5">
        <Hail src={src} target={target} onTarget={setTarget} />
      </Monitor>
      <Monitor title="Signal scope" meta={meta('carrier') ? 'carrier waveform' : ''} state={st('comms')} className="st-c6" style={{ '--mh': '220px' }}>
        <SignalScope src={src} />
      </Monitor>
      <Monitor title="Message log" meta="priority · from · text" state={st('comms')} className="st-c6" style={{ '--mh': '260px' }}>
        <Log src={src} local={local} />
      </Monitor>
    </Station>
  );
}

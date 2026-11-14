import { useRef, useState } from 'react';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { logOf } from '../lib/ship.js';
import { play } from '../lib/sound.js';
import { state } from '../lib/store.js';
import { SHIPS, alertsFor, levelOf, linkOf, meta, monState, read, shipCode, stardate, useCommand, useFeed, worst } from './parts/data.js';
import { Chip, ConsoleStrip, J, LitButton, Monitor, Num, Station, useKeys } from '../ui/index.js';
import { C, Readout, clamp, fmt, useCanvas } from './parts/ui.jsx';

const CARRIER_SLOTS = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86]; // where open channels sit across the band

/** Subspace waterfall: newest row on top, one bright line per open channel, noise floor from interference, gaps from loss. */
function Waterfall({ src }) {
  const painted = useRef(0); // canvas width the history was painted for
  const ref = useCanvas((ctx, w, h, t) => {
    const cv = ctx.canvas, k = Math.round(2 * (cv.width / w));
    const carrier = read(src, 'carrier') ?? 0, noise = (read(src, 'interference') ?? 0) / 100, loss = (read(src, 'loss') ?? 0) / 100;
    const open = clamp(Math.round(read(src, 'channelsOpen') ?? 0), 0, CARRIER_SLOTS.length);
    if (painted.current !== cv.width) {
      painted.current = cv.width;
      for (let y = h; y > 0; y -= 2) row(ctx, w, y, t - (h - y) * 40, carrier, noise, loss, open);
    }
    // scroll the old rows down; 'copy' replaces pixels instead of stacking translucent rows into a solid block
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(cv, 0, 0, cv.width, cv.height - k, 0, k, cv.width, cv.height - k);
    ctx.restore();
    row(ctx, w, 0, t, carrier, noise, loss, open);
  }, [src], 80);
  const open = clamp(Math.round(read(src, 'channelsOpen') ?? 0), 0, CARRIER_SLOTS.length);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={ref} className="st-canvas" role="img" aria-label={`Subspace waterfall: ${open} open channel${open === 1 ? '' : 's'}, newest at the top`} />
      {CARRIER_SLOTS.slice(0, open).map((x, i) => <span key={i} style={{ position: 'absolute', top: 6, left: `${x * 100}%`, transform: 'translateX(-50%)', font: '400 10px var(--font-mono)', color: C.ink2, textShadow: '0 1px 2px #000' }}>CH {i + 1}</span>)}
      <span style={{ position: 'absolute', left: 14, bottom: 12, padding: '2px 6px', borderRadius: 3, background: '#000a', font: '400 10px var(--font-mono)', color: C.ink2 }}>newest on top · older below</span>
    </div>
  );
}

/** One 2 px row of the waterfall at height y. */
function row(ctx, w, y, t, carrier, noise, loss, open) {
  ctx.clearRect(0, y, w, 2);
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
    ctx.fillRect(x, y, 2, 2);
  }
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

/** Uhura's ear receiver: a silver ribbed earpiece in its cradle; its lamp lights while hailing frequencies are open. */
function EarReceiver({ on }) {
  return (
    <svg className="ear" viewBox="0 0 120 44" aria-hidden="true" data-on={on || undefined}>
      <defs>
        <linearGradient id="ear-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f2f4f6" /><stop offset="0.45" stopColor="#aeb4ba" /><stop offset="1" stopColor="#6c7279" /></linearGradient>
      </defs>
      <rect x="2" y="30" width="116" height="10" rx="3" className="ear__cradle" />
      <rect x="22" y="12" width="70" height="18" rx="9" fill="url(#ear-metal)" stroke="#00000080" />
      {[34, 40, 46, 52, 58, 64, 70].map((x) => <path key={x} d={'M' + x + ' 13.5V28.5'} stroke="#0000004d" strokeWidth="1.4" />)}
      <rect x="88" y="15" width="16" height="12" rx="5" fill="#1a1c1f" />
      <circle cx="14" cy="21" r="5" className="ear__lamp" />
      {on && [0, 1, 2].map((i) => <path key={i} className="ear__wave" style={{ animationDelay: (i * 0.4) + 's' }} d={'M' + (108 + i * 4) + ' 10 q6 11 0 22'} />)}
    </svg>
  );
}

function Hail({ src, target, onTarget }) {
  const open = read(src, 'hailing') >= 0.5;
  const channels = clamp(Math.round(read(src, 'channelsOpen') ?? 0), 0, CARRIER_SLOTS.length);
  return (
    <div className="comm">
      <div className="comm__top">
        <EarReceiver on={open} />
        <div className="comm__hail" data-open={open || undefined}>
          <i className="comm__lamp" aria-hidden="true" />
          <span>{open ? 'HAILING FREQUENCIES OPEN' : 'HAILING FREQUENCIES CLOSED'}</span>
        </div>
      </div>
      <div className="comm__switches" role="img" aria-label={channels + ' of ' + CARRIER_SLOTS.length + ' subspace channels open'}>
        {CARRIER_SLOTS.map((_, i) => (
          <span key={i} className="comm__switch" data-on={i < channels || undefined}><i aria-hidden="true" /><b>CH {i + 1}</b></span>
        ))}
        <span className="comm__count"><Num value={read(src, 'channelsOpen')} dec={0} /><span className="st-unit">open</span></span>
      </div>
      <div role="radiogroup" aria-label="Hail target" className="comm__targets">
        {TARGETS.map((x) => {
          const link = x.id === 'command' ? (state.status === 'online' ? 'live' : 'lost') : linkOf(x.id);
          const sel = target === x.id;
          return (
            <button key={x.id} type="button" role="radio" aria-checked={sel} onClick={() => onTarget(x.id)} className="comm__target">
              <i className="comm__toggle" aria-hidden="true" />
              <span className="mono" style={{ fontSize: 12, color: '#c9d0d8' }}>{x.code}</span>
              <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
              <Chip level={link === 'live' ? 'ok' : link === 'lost' ? 'off' : 'info'}>{link === 'live' ? 'LINK' : link === 'lost' ? 'NO LINK' : 'UNKNOWN'}</Chip>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SEV = { critical: ['crit', 'RED'], warn: ['warn', 'YELLOW'], info: ['info', 'INFO'], refused: ['crit', 'REFUSED'], log: ['ok', 'LOG'] };
// who a log line is from: the scenario's script and its orders, the alert system, or the officer who gave the order
const sender = (by, src) => (!by ? shipCode(src) : by === 'log' || by === 'scenario' ? 'SCENARIO' : by === 'alert system' ? 'ALERTS' : by.toUpperCase().slice(0, 10));
/** The ship's traffic, newest first: the log lines the server sends to its room (orders, hails, scenario messages) and its alerts. */
function Log({ src }) {
  const now = Date.now();
  const items = [
    ...logOf(src).slice(0, 200).map((l) => ({ id: `l${l.id}`, ts: l.ts, sev: l.kind === 'command' ? 'refused' : 'log', from: sender(l.by, src), text: l.text, fresh: l.fresh && now - l.ts < 1500 })),
    ...alertsFor(src).slice(0, 200).map((a) => ({ id: a.id, ts: a.ts, sev: a.severity, from: shipCode(a.sourceId), text: a.message, fresh: a.arrivedAt && now - a.arrivedAt < 1500 })),
  ].sort((a, b) => b.ts - a.ts);
  return (
    <VirtualList items={items} rowHeight={36} label="Message log" className="st-list" style={{ height: '100%' }}
      empty={<div className="st-blank"><b>NO TRAFFIC</b><span>Hails, orders, scenario messages and alerts for this ship appear here.</span></div>}
      renderRow={(m) => {
        const [lv, word] = SEV[m.sev] ?? SEV.info;
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
  const cmd = useCommand(shipId);
  const st = (...g) => monState(user, src, g);
  const tgt = TARGETS.find((x) => x.id === target);
  const hail = (priority) => cmd.send('comms.hail', { target: priority ? 'command' : target });
  const close = () => cmd.send('comms.close');
  const hailing = read(src, 'hailing') >= 0.5;
  useKeys({ h: () => (hailing ? close() : hail(false)) });
  const sys = (ks) => worst(ks.map((k) => levelOf(k, read(src, k))));
  const desk = (
    <ConsoleStrip seed={31} jewels={[J('CARRIER', sys(['carrier']), st('comms')), J('DELAY', sys(['delay']), st('comms')), J('LOSS', sys(['loss']), st('comms')), J('NOISE', sys(['interference']), st('comms'))]}>
      <LitButton color="blue" label={`Hail ${tgt.code}`} keyCap="H" onClick={() => hail(false)} {...cmd.bind('comms.hail')} lit={hailing} />
      <LitButton color="white" label="Close channel" onClick={close} {...cmd.bind('comms.close')} />
      <LitButton color="red" label="Priority one" onClick={() => hail(true)} {...cmd.bind('comms.hail')} />
      <LitButton color="yellow" label="Intercom" pressed={intercom} onClick={() => { if (!intercom) play('intercom'); setIntercom(!intercom); }} title="Ship-wide announcement channel, local to this console" />
    </ConsoleStrip>
  );

  return (
    <Station name="Communications" division="ops" ship={src} rows="minmax(250px, 1.2fr) minmax(210px, 1fr)" desk={desk}>
      <Monitor title="Subspace channels" meta="receiver waterfall" state={st('comms')} className="st-c7">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(170px, 34%)', height: '100%' }} className="st-split">
          <div style={{ position: 'relative', minHeight: 180 }}><Waterfall src={src} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px', minWidth: 0, borderLeft: '1px solid #ffffff0d' }}>
            <Readout src={src} k="carrier" label="Carrier strength" size="sm" sparkH={20} />
            <Readout src={src} k="delay" label="Delay to Starfleet" size="sm" sparkH={20} />
            <Readout src={src} k="loss" label="Message loss" size="sm" sparkH={20} />
            <Readout src={src} k="interference" label="Interference" size="sm" sparkH={20} />
          </div>
        </div>
      </Monitor>
      <Monitor title="Hailing" meta="ear receiver · task force · Starfleet" state={st('comms')} className="st-c5 monitor--housing monitor--comm">
        <Hail src={src} target={target} onTarget={setTarget} />
      </Monitor>
      <Monitor title="Signal scope" meta={meta('carrier') ? 'carrier waveform' : ''} state={st('comms')} className="st-c6" style={{ '--mh': '220px' }}>
        <SignalScope src={src} />
      </Monitor>
      <Monitor title="Message log" meta="priority · from · text" state={st('comms')} className="st-c6" style={{ '--mh': '260px' }}>
        <Log src={src} />
      </Monitor>
    </Station>
  );
}

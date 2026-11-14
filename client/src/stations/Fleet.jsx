import { Fragment, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCENARIOS, SCENARIO_LIST } from '@ncc/shared/scenarios/index.js';
import Chart from '../components/Chart.jsx';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { commandWords } from '../lib/commands.js';
import { ship } from '../lib/ship.js';
import { ackAlert, ackAlerts, state } from '../lib/store.js';
import { SHIPS, alertFlagOf, conditionOf, isOpen, linkOf, posOf, read, ringOf, shipCode, shipName, stardate, useCommand } from './parts/data.js';
import { Chip, ConsoleStrip, J, LevelChip, LitButton, Monitor, Num, Station } from '../ui/index.js';
import { C, clamp, fmt, useCanvas } from './parts/ui.jsx';

// a ship's condition is the server's, from its overview row; null until the server has heard from the ship
const COND = { red: ['crit', 'RED ALERT'], yellow: ['warn', 'YELLOW ALERT'], normal: ['ok', 'NORMAL'] };
const ringColor = (id) => { const c = conditionOf(id); return c === 'red' ? C.crit : c === 'yellow' ? C.warn : C.chart1; };
const weakest = (id) => {
  const o = state.overview.get(id);
  if (o?.shield != null) return o.shield;
  const vs = ['shieldFore', 'shieldAft', 'shieldPort', 'shieldStbd'].map((k) => read(id, k)).filter((v) => v != null);
  return vs.length ? Math.min(...vs) : undefined;
};
// step times of each episode script, for the timeline's marks (the server's runner plays the same scripts)
const MARKS = Object.fromEntries(Object.values(SCENARIOS).map((x) => [x.id, [...new Set(x.steps.map((step) => step.t))]]));
const STATE_WORD = { running: 'running', awaiting: 'waiting for an order', ended: 'complete', stopped: 'stopped' };

/** The task force on one sector plot: heading chevrons, one-minute trails, a condition ring each, links to Starfleet. */
function SectorMap({ ids }) {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const ships = ids.map((id) => ({ id, p: posOf(id), link: linkOf(id) })).filter((s) => s.p);
    let x0 = -150, x1 = 150, y0 = -150, y1 = 150;
    if (ships.length) {
      x0 = Math.min(...ships.map((s) => s.p.x)); x1 = Math.max(...ships.map((s) => s.p.x));
      y0 = Math.min(...ships.map((s) => s.p.y)); y1 = Math.max(...ships.map((s) => s.p.y));
    }
    // fit the task force itself with room for the labels; a 60 su floor keeps ships in tight formation apart
    const span = Math.max(60, x1 - x0, y1 - y0) * 1.7, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const s = Math.min(w, h) / span;
    const P = (x, y) => [w / 2 + (x - mx) * s, h / 2 - (y - my) * s];
    const step = [5, 10, 25, 50, 100, 200, 500, 1000, 2000].find((x) => x * s >= 64) ?? 5000; // labels at least 64 px apart
    ctx.lineWidth = 1; ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = C.mute;
    for (let gx = Math.ceil((mx - w / 2 / s) / step) * step; gx <= mx + w / 2 / s; gx += step) {
      const [px] = P(gx, 0); ctx.strokeStyle = '#ffffff0e'; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(String(gx), px, h - 6);
    }
    for (let gy = Math.ceil((my - h / 2 / s) / step) * step; gy <= my + h / 2 / s; gy += step) {
      const [, py] = P(0, gy); ctx.strokeStyle = '#ffffff0e'; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillText(String(gy), 6, py - 3);
    }
    // links: every ship relays to Starfleet Command, drawn to the corner where its relay sits
    const hq = [w - 14, 14];
    ctx.font = '400 9px Michroma, sans-serif'; ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.fillText('STARFLEET COMMAND', w - 26, 18);
    ctx.fillStyle = C.chart2; ctx.beginPath(); ctx.arc(hq[0], hq[1], 4, 0, Math.PI * 2); ctx.fill();
    for (const sh of ships) {
      const [px, py] = P(sh.p.x, sh.p.y);
      ctx.strokeStyle = sh.link === 'live' ? '#7cc4ff40' : '#ff4a5560'; ctx.setLineDash(sh.link === 'live' ? [3, 6] : [1, 7]); ctx.lineDashOffset = -t / 60;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hq[0], hq[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    const labels = []; // label slots taken so far: ships close together stack their labels instead of overprinting
    for (const sh of [...ships].sort((a, b) => b.p.y - a.p.y)) {
      const [px, py] = P(sh.p.x, sh.p.y), col = sh.link === 'lost' ? C.mute : ringColor(sh.id);
      const r = ringOf(sh.id, 'posX');
      if (r?.len && r.cols.posY) {
        ctx.strokeStyle = '#7cc4ff55'; ctx.lineWidth = 1.5; ctx.beginPath();
        let first = true;
        const n = r.len, end = r.lastTs;
        for (let i = Math.max(0, n - 600); i < n; i += 3) {
          const idx = (r.head - n + i + r.cap * 2) % r.cap;
          if (end - r.ts[idx] > 60000) continue;
          const [qx, qy] = P(r.cols.posX[idx], r.cols.posY[idx]);
          if (first) { ctx.moveTo(qx, qy); first = false; } else ctx.lineTo(qx, qy);
        }
        ctx.stroke();
      }
      const pulse = col === C.crit ? 0.55 + 0.45 * Math.sin(t / 160) : 1;
      ctx.globalAlpha = pulse; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      if (sh.link === 'lost') {
        ctx.strokeStyle = C.mute; ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6); ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke();
      } else {
        ctx.save(); ctx.translate(px, py); ctx.rotate(((sh.p.heading ?? 0) * Math.PI) / 180);
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      let ly = py - 2;
      for (let moved = true, n = 0; moved && n < 8; n++) { moved = false; for (const q of labels) if (Math.abs(q.x - px) < 110 && Math.abs(q.y - ly) < 28) { ly = q.y + 28; moved = true; } }
      labels.push({ x: px, y: ly });
      ctx.font = '700 11px "Space Mono", monospace'; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      ctx.fillText(shipCode(sh.id), px + 20, ly);
      ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = sh.link === 'lost' ? C.critInk : C.ink2;
      ctx.fillText(sh.link === 'lost' ? 'LINK LOST' : `warp ${fmt(sh.p.warp, 1)}`, px + 20, ly + 13);
    }
  }, [ids.join()], 50);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Sector map of the task force" />;
}

function ShipCard({ id, onOpen }) {
  const link = linkOf(id), cond = conditionOf(id);
  const open = state.alerts.filter((a) => a.sourceId === id && isOpen(a)).length;
  const [lv, word] = cond ? COND[cond] : ['off', 'NOT HEARD FROM'];
  const sh = weakest(id);
  const shLv = sh < 25 ? 'crit' : sh < 50 ? 'warn' : null; // DOMAIN.md shield limits: warn under 50 %, critical under 25 %
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <i className="pill" style={{ '--div': ringColor(id) }} aria-hidden="true" />
        <span style={{ font: '700 13px var(--font-mono)', whiteSpace: 'nowrap' }}>{shipCode(id)}</span>
        <span style={{ marginLeft: 'auto' }}><Chip level={link === 'live' ? 'ok' : link === 'lost' ? 'crit' : 'off'}>{link === 'live' ? 'LINK' : link === 'lost' ? 'LOST' : '—'}</Chip></span>
      </div>
      <span style={{ font: '400 10px var(--font-display)', letterSpacing: '0.08em', color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shipName(id).toUpperCase()}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Chip level={lv}>{cond ? `CONDITION ${word}` : word}</Chip></div>
      <dl className="st-kv" style={{ gridTemplateColumns: 'auto 1fr auto 1fr', gap: '3px 8px' }}>
        <dt>Warp</dt><dd style={{ fontSize: 14 }}><Num value={posOf(id)?.warp ?? read(id, 'warpFactor')} dec={1} className="" /></dd>
        <dt>Shield</dt><dd style={{ fontSize: 14 }}><Num value={sh} dec={0} className="" level={shLv} /><span className="st-unit">%</span>{shLv && <> <LevelChip level={shLv} /></>}</dd>
        <dt>Alerts</dt><dd style={{ fontSize: 14 }}>{open}</dd>
        <dt>Crew</dt><dd style={{ fontSize: 14 }}><Num value={read(id, 'crewAboard')} className="" /><span className="st-unit">aboard</span></dd>
      </dl>
    </>
  );
  const style = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0, padding: '8px 10px', border: 0, borderRadius: 6, textAlign: 'left', background: '#ffffff07', boxShadow: `inset 0 0 0 1px ${link === 'lost' ? '#ff4a5555' : '#ffffff12'}` };
  return <button type="button" style={style} onClick={() => onOpen(id)} aria-label={`Open the history of ${shipName(id)}`} title="Open this ship's history">{body}</button>;
}

const SEV = { critical: ['crit', 'RED'], warn: ['warn', 'YELLOW'], info: ['info', 'INFO'] };
function FleetLog({ canAck }) {
  const items = state.alerts.slice(0, 500);
  return (
    <VirtualList items={items} rowHeight={38} label="Fleet log" className="st-list" style={{ height: '100%' }}
      empty={<div className="st-blank"><b>ALL QUIET</b><span>Alerts from every ship of the task force appear here.</span></div>}
      renderRow={(a) => {
        const [lv, word] = SEV[a.severity] ?? ['info', 'INFO'];
        return (
          <div className={`st-row ${a.arrivedAt && Date.now() - a.arrivedAt < 1500 ? 'new' : ''}`}>
            <span className="t">{fmt(stardate(a.ts), 2)}</span>
            <span className="t" style={{ color: C.ink2 }}>{shipCode(a.sourceId)}</span>
            <Chip level={a.ack ? 'off' : lv}>{word}</Chip>
            <span className="m" title={a.message}>{a.message}</span>
            {a.ack ? <span className="t">seen · {a.ack.by}</span> : canAck && <button type="button" className="st-btn" onClick={() => ackAlert(a.id)}>ACK</button>}
          </div>
        );
      }} />
  );
}

/** Server health from the 1 Hz `metrics` event (admin room), with a two-minute latency history kept here. */
function System() {
  const hist = useRef({ xs: [], p50: [], p95: [], p99: [], ver: -1 });
  const m = state.metrics.latest;
  if (m && state.metrics.ver !== hist.current.ver) {
    const h = hist.current;
    h.ver = state.metrics.ver;
    h.xs.push(m.ts / 1000); h.p50.push(m.latencyMs.p50); h.p95.push(m.latencyMs.p95); h.p99.push(m.latencyMs.p99);
    if (h.xs.length > 120) for (const k of ['xs', 'p50', 'p95', 'p99']) h[k].shift();
  }
  const getData = useMemo(() => { let seen = -1; return () => { const h = hist.current; if (h.ver === seen || h.xs.length < 2) return null; seen = h.ver; return [h.xs.slice(), h.p50.slice(), h.p95.slice(), h.p99.slice()]; }; }, []);
  if (!m) return <div className="st-blank"><b className="st-blink-slow">AWAITING METRICS</b><span>The server sends them once a second to Starfleet Command.</span></div>;
  const r = m.rates, g = m.gauges ?? {};
  const rows = [
    ['Readings / s', state.rx], ['Samples / s', r.accepted], ['Dashboards', g.dashboards], ['Sources', g.sourcesConnected],
    ['Write queue', g.writerQueue], ['Duplicates / s', r.duplicates], ['Stale / s', r.stale], ['Invalid / s', r.invalid], ['Throttled / s', r.throttled],
  ];
  return (
    <div className="st-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.9fr) minmax(0, 1.4fr)', height: '100%' }}>
      <div className="st-fill-scroll" style={{ padding: '10px 14px', borderRight: '1px solid #ffffff0d', minWidth: 0 }}>
        <dl className="st-kv" style={{ gap: '5px 12px' }}>
          {rows.map(([l, v]) => <Fragment key={l}><dt>{l}</dt><dd style={{ fontSize: 14 }}><Num value={v} dec={0} className="" /></dd></Fragment>)}
        </dl>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: 10, minWidth: 0, minHeight: 160 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 4 }}>
          {['p50', 'p95', 'p99'].map((p) => <span key={p} className="st-label">{p} <b style={{ font: '700 16px var(--font-mono)', color: C.ink }}>{fmt(m.latencyMs[p], 1)}</b><span className="st-unit">ms</span></span>)}
        </div>
        <Chart fill x="time" title="Ingest to screen latency" unit="ms" getData={getData}
          series={[{ label: 'p50', color: '#2f6fae', dec: 1 }, { label: 'p95', color: '#58c4ff', dec: 1 }, { label: 'p99', color: '#bfe8ff', dec: 1 }]} />
      </div>
    </div>
  );
}

/**
 * The six episodes, from the scenario scripts. The timeline follows the server's `scenario` event, so every console, and
 * one that signs in mid-scenario, shows the same clock and step, and the order a step is waiting for.
 */
function Scenarios({ cmd }) {
  const s = ship.scenario;
  const live = s?.state === 'running' || s?.state === 'awaiting';
  const t = s?.t ?? 0, len = s?.duration || 1;
  const wait = live ? s.awaiting : null;
  const label = !s ? 'No scenario has run since sign-in'
    : `${s.title}: ${STATE_WORD[s.state] ?? s.state} · ${fmt(Math.min(t, len), 0)} of ${fmt(len, 0)} s${live ? ` · step ${s.step} of ${s.steps}` : ''}${wait ? ` · waiting for ${commandWords(wait.type, wait)} (${fmt(wait.secondsLeft, 0)} s)` : ''}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {SCENARIO_LIST.map((x) => {
          const on = live && s.id === x.id;
          return (
            <button key={x.id} type="button" onClick={() => cmd.send('scenario.start', { id: x.id })} aria-pressed={on} disabled={!cmd.can('scenario.start') || live}
              title={live && !on ? 'One scenario at a time' : undefined}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', border: 0, borderRadius: 6, cursor: live ? 'default' : 'pointer', textAlign: 'left', opacity: live && !on ? 0.55 : 1, background: on ? '#1c6fc033' : '#ffffff07', boxShadow: `inset 0 0 0 1px ${on ? C.accent : '#ffffff12'}` }}>
              <span style={{ font: '400 10px var(--font-display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{x.title}</span>
              <span className="st-label" style={{ fontSize: 11 }}>{x.episode} · {x.duration} s</span>
              <span style={{ fontSize: 12, color: C.ink2, lineHeight: 1.3 }}>{x.shows.join(', ')}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="st-label" style={{ minWidth: 150, color: wait ? C.warn : undefined }} aria-live="polite">{label}</span>
        <div style={{ position: 'relative', flex: 1, height: 14, borderRadius: 3, background: '#ffffff0a' }} aria-hidden="true">
          {s && <i style={{ position: 'absolute', inset: '0 auto 0 0', width: `${clamp(t / len) * 100}%`, background: wait ? C.warn : C.accent, borderRadius: 3, opacity: live ? 0.6 : 0.3 }} />}
          {s && MARKS[s.id]?.map((x) => <b key={x} style={{ position: 'absolute', top: -3, bottom: -3, left: `${clamp(x / len) * 100}%`, width: 2, background: x <= t ? C.ink : C.mute }} />)}
        </div>
      </div>
    </div>
  );
}

/** Starfleet Command (DESIGN.md "Starfleet Command"): the whole task force, the fleet log, server health and scenarios. */
export default function Fleet({ onOpenShip }) {
  useTick();
  const navigate = useNavigate();
  // a ship card opens that ship's history, stored then live: for a lost ship, the record of its last minutes
  const open = onOpenShip ?? ((id) => navigate(`/history?ship=${id}`));
  const { user } = useAuth();
  const ids = SHIPS.map((s) => s.id);
  const groups = ['helm', 'shields', 'crewsummary'].filter((g) => user?.groups?.includes(g));
  useSubscription(ids, groups);
  const cmd = useCommand(1);
  const admin = !!user?.admin;
  const lost = ids.filter((id) => linkOf(id) === 'lost').length;
  const [acking, setAcking] = useState(false);
  const ackYellow = async () => {
    setAcking(true);
    await ackAlerts(state.alerts.filter((a) => isOpen(a) && a.severity === 'warn').map((a) => a.id));
    setAcking(false);
  };
  const desk = (
    <ConsoleStrip seed={59} jewels={ids.map((id) => J(shipCode(id), linkOf(id) === 'lost' ? 'crit' : alertFlagOf(id), linkOf(id) === 'unknown' ? 'off' : 'live'))}>
      <LitButton color="red" label="Stop scenario" onClick={() => cmd.send('scenario.stop')} {...cmd.bind('scenario.stop')} disabled={!cmd.can('scenario.stop') || !(ship.scenario?.state === 'running' || ship.scenario?.state === 'awaiting')} />
      <LitButton color="white" label="Ack all yellow" onClick={ackYellow} pending={acking} disabled={!user?.canAck || acking} />
    </ConsoleStrip>
  );
  return (
    <Station name="Starfleet Command" division="fleet" ship={null} rows="minmax(250px, 1.3fr) minmax(220px, 1fr) minmax(210px, auto)" desk={desk}
      end={`${ids.length - lost} of ${ids.length} ships linked · ${fmt(state.rx, 0)} readings/s`}>
      <Monitor title="Sector map" meta="task force · sector units" className="st-c7" style={{ '--mh': '340px' }}>
        <SectorMap ids={ids} />
      </Monitor>
      <Monitor title="Ship cards" meta={`${ids.length} ships · open a ship's history`} className="st-c5" style={{ gridRow: 'span 2' }}>
        <div className="st-fill-scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', alignContent: 'start', gap: 8, padding: 10, height: '100%' }}>
          {ids.map((id) => <ShipCard key={id} id={id} onOpen={open} />)}
        </div>
      </Monitor>
      <Monitor title="Fleet log" meta="alerts from every ship" className="st-c7" style={{ '--mh': '320px' }}>
        <FleetLog canAck={!!user?.canAck} />
      </Monitor>
      <Monitor title="System" meta="server · 1 Hz" state={admin ? 'live' : 'restricted'} restricted="Server metrics: Starfleet Command only." className="st-c5" style={{ '--mh': '320px' }}>
        <System />
      </Monitor>
      <Monitor title="Scenarios" meta="launcher and timeline" state={admin || user?.role === 'captain' ? 'live' : 'restricted'} restricted="Scenarios: captain and Starfleet Command only." className="st-c7">
        <Scenarios cmd={cmd} />
      </Monitor>
    </Station>
  );
}

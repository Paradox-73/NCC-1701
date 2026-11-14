import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Chart from '../components/Chart.jsx';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { ackAlert, state } from '../lib/store.js';
import { SHIPS, alertFlagOf, conditionOf, isOpen, levelOf, linkOf, posOf, read, ringOf, shipCode, shipName, stardate, useCommand } from './parts/data.js';
import { C, Chip, ConsoleStrip, J, LevelChip, LitButton, Monitor, Num, Station, clamp, fmt, useCanvas } from './parts/ui.jsx';

const COND = { red: ['crit', 'RED ALERT'], yellow: ['warn', 'YELLOW ALERT'], normal: ['ok', 'NORMAL'] };
const ringColor = (id) => {
  const c = conditionOf(id) ?? (alertFlagOf(id) === 'crit' ? 'red' : alertFlagOf(id) === 'warn' ? 'yellow' : 'normal');
  return c === 'red' ? C.crit : c === 'yellow' ? C.warn : C.chart1;
};
const weakest = (id) => {
  const o = state.overview.get(id);
  if (o?.shield != null) return o.shield;
  const vs = ['shieldFore', 'shieldAft', 'shieldPort', 'shieldStbd'].map((k) => read(id, k)).filter((v) => v != null);
  return vs.length ? Math.min(...vs) : undefined;
};
// DOMAIN.md section 8, in build order; the server's scenario runner owns the scripts (shared/scenarios)
const SCENARIOS = [
  { id: 'balance-of-terror', title: 'Balance of Terror', ep: 'Season 1, 1966', sec: 95, shows: 'Statistical anomaly detection, red alert, shield hits', steps: [0, 8, 12, 20, 30, 38, 40, 45, 50, 58, 72, 75, 85] },
  { id: 'the-naked-time', title: 'The Naked Time', ep: 'Season 1, 1966', sec: 110, shows: '430-crew stream, medical privacy by role, cold restart', steps: [0, 5, 15, 40, 50, 70, 80, 85, 100] },
  { id: 'the-doomsday-machine', title: 'The Doomsday Machine', ep: 'Season 2, 1967', sec: 110, shows: 'Several ships, link loss, history of a lost ship', steps: [0, 10, 20, 30, 45, 55, 65, 80, 95, 105] },
  { id: 'mirror-mirror', title: 'Mirror, Mirror', ep: 'Season 2, 1967', sec: 70, shows: 'Duplicate, out-of-order and malformed telemetry', steps: [0, 5, 15, 25, 30, 45, 55] },
  { id: 'the-trouble-with-tribbles', title: 'The Trouble with Tribbles', ep: 'Season 2, 1967', sec: 85, shows: 'Deck-by-deck life support, growth forecast', steps: [0, 30, 45, 60, 80] },
  { id: 'space-seed', title: 'Space Seed', ep: 'Season 1, 1967', sec: 90, shows: 'Device keys, rate limiting, forged data refused', steps: [0, 10, 18, 25, 30, 40, 45, 60, 75, 85] },
];

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
    const span = Math.max(300, x1 - x0, y1 - y0) * 1.3, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const s = Math.min(w, h) / span;
    const P = (x, y) => [w / 2 + (x - mx) * s, h / 2 - (y - my) * s];
    const step = [25, 50, 100, 200, 500, 1000, 2000].find((x) => x * s >= 64) ?? 5000; // labels at least 64 px apart
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
    for (const sh of ships) {
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
      ctx.font = '700 11px "Space Mono", monospace'; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      ctx.fillText(shipCode(sh.id), px + 20, py - 2);
      ctx.font = '400 10px "Space Mono", monospace'; ctx.fillStyle = sh.link === 'lost' ? C.critInk : C.ink2;
      ctx.fillText(sh.link === 'lost' ? 'LINK LOST' : `warp ${fmt(sh.p.warp, 1)}`, px + 20, py + 11);
    }
  }, [ids.join()], 50);
  return <canvas ref={ref} className="st-canvas" role="img" aria-label="Sector map of the task force" />;
}

function ShipCard({ id, onOpen }) {
  const link = linkOf(id), cond = conditionOf(id), flag = alertFlagOf(id);
  const open = state.alerts.filter((a) => a.sourceId === id && isOpen(a)).length;
  const [lv, word] = cond ? COND[cond] : [flag ?? 'off', flag === 'crit' ? 'RED ALERTS OPEN' : flag === 'warn' ? 'YELLOW ALERTS OPEN' : 'NO OPEN ALERTS'];
  const sh = weakest(id);
  const shLv = sh < 25 ? 'crit' : sh < 50 ? 'warn' : null; // DOMAIN.md shield limits: warn under 50 %, critical under 25 %
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <i className="st-pill" style={{ '--pill': ringColor(id) }} aria-hidden="true" />
        <span style={{ font: '700 13px var(--font-mono)' }}>{shipCode(id)}</span>
        <span style={{ font: '400 10px var(--font-display)', letterSpacing: '0.08em', color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shipName(id).toUpperCase()}</span>
        <span style={{ marginLeft: 'auto' }}><Chip level={link === 'live' ? 'ok' : link === 'lost' ? 'crit' : 'off'}>{link === 'live' ? 'LINK' : link === 'lost' ? 'LOST' : '—'}</Chip></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Chip level={lv === 'ok' ? 'ok' : lv}>{cond ? `CONDITION ${word}` : word}</Chip></div>
      <dl className="st-kv" style={{ gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 10px' }}>
        <dt>Warp</dt><dd style={{ fontSize: 14 }}><Num v={posOf(id)?.warp ?? read(id, 'warpFactor')} dec={1} className="" /></dd>
        <dt>Weakest shield</dt><dd style={{ fontSize: 14 }}><Num v={sh} dec={0} className="" level={shLv} /><span className="st-unit">%</span>{shLv && <> <LevelChip level={shLv} /></>}</dd>
        <dt>Open alerts</dt><dd style={{ fontSize: 14 }}>{open}</dd>
        <dt>Crew</dt><dd style={{ fontSize: 14 }}><Num v={read(id, 'crewAboard')} className="" /><span className="st-unit">aboard</span></dd>
      </dl>
    </>
  );
  const style = { display: 'flex', flexDirection: 'column', gap: 8, width: '100%', padding: '10px 12px', border: 0, borderRadius: 8, textAlign: 'left', background: '#ffffff07', boxShadow: `inset 0 0 0 1px ${link === 'lost' ? '#ff4a5555' : '#ffffff12'}` };
  return onOpen ? <button type="button" style={{ ...style, cursor: 'pointer' }} onClick={() => onOpen(id)} aria-label={`Open the history of ${shipName(id)}`} title="Open this ship's history">{body}</button> : <div style={style}>{body}</div>;
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
      <div style={{ padding: '10px 14px', borderRight: '1px solid #ffffff0d', minWidth: 0 }}>
        <dl className="st-kv" style={{ gap: '5px 12px' }}>
          {rows.map(([l, v]) => <Fragment key={l}><dt>{l}</dt><dd style={{ fontSize: 14 }}><Num v={v} dec={0} className="" /></dd></Fragment>)}
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

function Scenarios({ cmd, running, setRunning }) {
  useTick(500);
  const sc = SCENARIOS.find((s) => s.id === running?.id);
  const t = running ? (Date.now() - running.at) / 1000 : 0;
  useEffect(() => { if (sc && t > sc.sec + 15) setRunning(null); }, [sc, t, setRunning]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px 12px', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" onClick={() => cmd.send('scenario.start', { id: s.id }, `Start ${s.title}`).then((ok) => ok && setRunning({ id: s.id, at: Date.now() }))}
            aria-pressed={running?.id === s.id}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', border: 0, borderRadius: 6, cursor: 'pointer', textAlign: 'left', background: running?.id === s.id ? '#1c6fc033' : '#ffffff07', boxShadow: `inset 0 0 0 1px ${running?.id === s.id ? C.accent : '#ffffff12'}` }}>
            <span style={{ font: '400 10px var(--font-display)', letterSpacing: '0.08em' }}>{s.title.toUpperCase()}</span>
            <span className="st-label" style={{ fontSize: 11 }}>{s.ep} · {s.sec} s</span>
            <span style={{ fontSize: 12, color: C.ink2, lineHeight: 1.3 }}>{s.shows}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="st-label" style={{ minWidth: 150 }}>{sc ? `${sc.title}: ${fmt(Math.min(t, sc.sec), 0)} of ${sc.sec} s` : 'No scenario running from this console'}</span>
        <div style={{ position: 'relative', flex: 1, height: 14, borderRadius: 3, background: '#ffffff0a' }} aria-hidden="true">
          {sc && <i style={{ position: 'absolute', inset: '0 auto 0 0', width: `${clamp(t / sc.sec) * 100}%`, background: C.accent, borderRadius: 3, opacity: 0.6 }} />}
          {sc?.steps.map((x) => <b key={x} style={{ position: 'absolute', top: -3, bottom: -3, left: `${(x / sc.sec) * 100}%`, width: 2, background: x <= t ? C.ink : C.mute }} />)}
        </div>
      </div>
    </div>
  );
}

/** Starfleet Command (DESIGN.md "Starfleet Command"): the whole task force, the fleet log, server health and scenarios. */
export default function Fleet({ onOpenShip }) {
  useTick();
  const { user } = useAuth();
  const ids = SHIPS.map((s) => s.id);
  const groups = ['helm', 'shields', 'crewsummary'].filter((g) => user?.groups?.includes(g));
  useSubscription(ids, groups);
  const cmd = useCommand(1);
  const [running, setRunning] = useState(null);
  const admin = !!user?.admin;
  const lost = ids.filter((id) => linkOf(id) === 'lost').length;
  const desk = (
    <ConsoleStrip seed={59} cmd={cmd} jewels={ids.map((id) => J(shipCode(id), linkOf(id) === 'lost' ? 'crit' : alertFlagOf(id), linkOf(id) === 'unknown' ? 'off' : 'live'))}>
      <LitButton color="red" label="Stop scenario" onClick={() => cmd.send('scenario.stop', {}, 'Stop the scenario').then((ok) => ok && setRunning(null))} {...cmd.bind('scenario.stop')} />
      <LitButton color="white" label="Ack all yellow" onClick={() => state.alerts.filter((a) => isOpen(a) && a.severity === 'warn').slice(0, 50).forEach((a) => ackAlert(a.id))} disabled={!user?.canAck} />
    </ConsoleStrip>
  );
  return (
    <Station name="Starfleet Command" division="fleet" ship={null} rows="minmax(260px, 1.5fr) minmax(200px, 1fr) minmax(150px, auto)" desk={desk}
      end={`${ids.length - lost} of ${ids.length} ships linked · ${fmt(state.rx, 0)} readings/s`}>
      <Monitor title="Sector map" meta="task force · sector units" className="st-c8" style={{ '--mh': '340px' }}>
        <SectorMap ids={ids} />
      </Monitor>
      <Monitor title="Ship cards" meta={`${ids.length} ships`} className="st-c4">
        <div className="st-fill-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, height: '100%' }}>
          {ids.map((id) => <ShipCard key={id} id={id} onOpen={onOpenShip} />)}
        </div>
      </Monitor>
      <Monitor title="Fleet log" meta="alerts from every ship" className="st-c5" style={{ '--mh': '300px' }}>
        <FleetLog canAck={!!user?.canAck} />
      </Monitor>
      <Monitor title="System" meta="server · 1 Hz" state={admin ? 'live' : 'restricted'} note="Server metrics: Starfleet Command only." className="st-c7" style={{ '--mh': '320px' }}>
        <System />
      </Monitor>
      <Monitor title="Scenarios" meta="launcher and timeline" state={admin || user?.role === 'captain' ? 'live' : 'restricted'} note="Scenarios: captain and Starfleet Command only." className="st-c12">
        <Scenarios cmd={cmd} running={running} setRunning={setRunning} />
      </Monitor>
    </Station>
  );
}

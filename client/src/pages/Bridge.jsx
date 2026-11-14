import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHANNEL_BY_KEY, GROUPS, SOURCES } from '@ncc/shared/schema.js';
import { stationById, canEnter } from '../app/stations.js';
import { useSubscription, useTick } from '../lib/hooks.js';
import { levelOf, worst } from '../lib/limits.js';
import { conditionOf, ship, shipLog, stardate } from '../lib/ship.js';
import { backfill, getRing, state } from '../lib/store.js';
import { viewerSlot } from '../app/MainViewer.jsx';
import { ButtonRow, Headline, Icon, Jewel, LampBar, LevelChip, LitButton, Monitor, STATUS_WORD, SweepScope, Trace, mayCommand, play, useCommand } from '../ui/index.js';
import Tour from '../app/Tour.jsx';
import { ScenarioPicker, ScenarioStrip } from './Scenario.jsx';
import './bridge.css';

const SHIP = 1;
const POWERED = 'ncc.powered';
const has = (key) => !!CHANNEL_BY_KEY[key];
const last = (group, key) => (has(key) ? getRing(SHIP, group)?.last(key) : undefined);
const FLAG_STATUS = (f) => (!(f & 1) ? 'off' : f & 4 ? 'crit' : f & 2 ? 'warn' : 'ok');
const COND_STATUS = { normal: 'ok', yellow: 'warn', red: 'crit' };
const SEV_LEVEL = { warning: 'warn', warn: 'warn', critical: 'crit' };
const DECKS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const FLEET = SOURCES.filter((s) => (s.kind ?? 'ship') === 'ship' && s.id !== SHIP).slice(0, 3);
let lastZoom = null; // where the user last zoomed in, so coming back zooms out from there

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = (e) => setM(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** 1 rising, -1 falling or 0 steady over the last 5 s; a change under 0.4 % of the channel's span counts as steady. */
function trendOf(group, k) {
  const ys = has(k) ? getRing(SHIP, group)?.window(5000, [k])?.[1] : null;
  if (!ys || ys.length < 2) return 0;
  const m = CHANNEL_BY_KEY[k], d = ys[ys.length - 1] - ys[0];
  return Math.abs(d) <= (m.max - m.min) * 0.004 ? 0 : Math.sign(d);
}

// ---- the station monitors on the wall: one headline each; every other number is on the station itself ----------
function EngineeringScreen() {
  const v = last('warp', 'reactionRate');
  return (
    <Headline value={v} unit="% rated" level={levelOf('reactionRate', v)} trend={trendOf('warp', 'reactionRate')}>
      <LampBar value={v} k="reactionRate" label="Matter/antimatter reaction rate" />
    </Headline>
  );
}

function LifeSupportScreen() {
  const r = getRing(SHIP, 'lifesupport');
  let low = null;
  const decks = DECKS.map((d, i) => {
    const o2 = r?.last(`o2_${d}`);
    if (o2 != null && (!low || o2 < low.v)) low = { v: o2, deck: i + 1, k: `o2_${d}` };
    return r?.len ? worst(['o2_', 'co2_', 'temp_', 'press_'].map((p) => levelOf(p + d, r.last(p + d)))) : 'off';
  });
  return (
    <Headline value={low?.v} unit="% O₂" dec={1} level={low ? levelOf(low.k, low.v) : 'off'} word={low && `Deck ${low.deck}`}>
      <ol className="decks" aria-label="Life support, deck by deck">
        {decks.map((lv, i) => <li key={DECKS[i]}><Jewel status={lv} label={`Deck ${i + 1}: ${STATUS_WORD[lv]}`} /><span aria-hidden="true">{i + 1}</span></li>)}
      </ol>
    </Headline>
  );
}

function SickbayScreen() {
  const v = last('crewsummary', 'crewWatch');
  const critical = last('crewsummary', 'crewCritical');
  return (
    <Headline value={v} unit="on watch" level={critical > 0 ? 'crit' : levelOf('crewWatch', v)} crit={critical > 0 ? `${critical} critical` : undefined}
      word={v === 0 ? 'All well' : undefined} trend={trendOf('crewsummary', 'crewWatch')} />
  );
}

function ScienceScreen() {
  const n = last('sensors', 'contacts');
  const range = last('sensors', 'contactRange');
  const contacts = n > 0 && range < 1e6 ? [{ bearing: last('sensors', 'contactBearing') ?? 0, range: Math.min(1, (range ?? 0) / 400000), cloaked: last('sensors', 'contactSnr') < 10 }] : [];
  return (
    <div className="scr-scope">
      <SweepScope contacts={contacts} label="Short-range sensors" />
      <Headline value={n} unit={n === 1 ? 'contact' : 'contacts'} level={n == null ? 'off' : n > 0 ? levelOf('contactRange', range) : 'ok'} word={n > 0 ? 'Tracking' : 'Clear'} />
    </div>
  );
}

function CommsScreen() {
  const v = last('comms', 'carrier');
  return (
    <Headline value={v} unit="dB" dec={1} level={levelOf('carrier', v)} word={last('comms', 'hailing') > 0 ? 'Hailing' : undefined}>
      <Trace src={SHIP} k="carrier" />
    </Headline>
  );
}

function FleetScreen() {
  return (
    <ul className="fleet">
      {FLEET.map((s) => {
        const o = state.overview.get(s.id);
        const status = !o ? 'off' : o.condition && o.condition !== 'normal' ? COND_STATUS[o.condition] : FLAG_STATUS(o.flags);
        return (
          <li key={s.id}>
            <Jewel status={status} size="lg" label={`${s.name}: ${STATUS_WORD[status]}`} />
            <b className="mono">{s.code}</b>
            <span className="fleet__name">{s.name.replace('USS ', '')}</span>
            <LevelChip level={status} off="No signal" />
          </li>
        );
      })}
    </ul>
  );
}

const TILES = [
  { id: 'engineering', station: 'engineering', title: 'Engineering', group: 'warp', Body: EngineeringScreen },
  { id: 'lifesupport', station: 'engineering', title: 'Life support', group: 'lifesupport', Body: LifeSupportScreen },
  { id: 'sickbay', station: 'sickbay', title: 'Sickbay', group: 'crewsummary', Body: SickbayScreen },
  { id: 'science', station: 'science', title: 'Science', group: 'sensors', Body: ScienceScreen },
  { id: 'comms', station: 'comms', title: 'Communications', group: 'comms', Body: CommsScreen },
  { id: 'fleet', station: 'fleet', title: 'Task force', group: null, Body: FleetScreen },
];
const RESTRICTED_TEXT = {
  engineering: 'Engineering data: chief engineer and captain', lifesupport: 'Life support data: engineering, medical and captain', sickbay: 'Crew counts',
  science: 'Sensor data: science, communications and captain', comms: 'Communications data: comms, science and captain', fleet: 'Task force: Starfleet Command (admin) only',
};

function Tile({ tile, user, index, onZoom }) {
  const st = stationById[tile.station];
  const sees = tile.group ? user.groups.includes(tile.group) && GROUPS.includes(tile.group) : FLEET.some((s) => user.ships?.includes(s.id));
  const enters = canEnter(user, st);
  const waiting = sees && tile.group && !getRing(SHIP, tile.group)?.len;
  const ref = useRef(null);
  return (
    <button type="button" ref={ref} className={`tile tile--${tile.id}`} data-tour={`tile-${tile.id}`} data-locked={!enters || undefined}
      onClick={() => onZoom(st, ref.current)} aria-label={`${tile.title}: open the ${st.label} station${enters ? '' : ' (restricted)'}`}>
      <Monitor title={tile.title} index={index} state={!sees ? 'restricted' : waiting ? 'awaiting' : 'live'} restricted={RESTRICTED_TEXT[tile.id]}
        meta={!enters && <Icon name="lock" className="tile__lock" title="Restricted station" />}>
        <tile.Body />
      </Monitor>
    </button>
  );
}

// ---- helm console, chair, log ------------------------------------------------------------------------------------
// The astrogator between helm and navigation: the pale plotting disc, the course in red ending in the flying point.
function Astrogator({ heading }) {
  const h = heading == null ? null : ((Math.round(heading) % 360) + 360) % 360;
  return (
    <figure className="helm__astro" role="img" aria-label={`Heading ${h == null ? 'unknown' : `${h} degrees`}`}>
      <span className="plate" aria-hidden="true">Heading</span>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="astro__ring" cx="60" cy="60" r="57" />
        <circle className="astro__glass" cx="60" cy="60" r="51" />
        {[18, 34].map((r) => <circle key={r} className="astro__grid" cx="60" cy="60" r={r} />)}
        {Array.from({ length: 12 }, (_, i) => <line key={i} className="astro__grid" x1="60" y1="51" x2="60" y2="9" transform={`rotate(${i * 30} 60 60)`} />)}
        <circle className="astro__centre" cx="60" cy="60" r="9" />
        <g className="astro__course" style={{ transform: `rotate(${h ?? 0}deg)` }}>
          <line x1="60" y1="60" x2="60" y2="16" />
          <circle cx="60" cy="16" r="4.5" />
        </g>
      </svg>
      <figcaption className="mono" aria-hidden="true">{h == null ? '—' : `${String(h).padStart(3, '0')}°`}</figcaption>
    </figure>
  );
}

const QUADS = ['shieldFore', 'shieldAft', 'shieldPort', 'shieldStbd'];
function HelmConsole({ ov, user }) {
  const helm = user.groups.includes('helm');
  const warp = ov?.warp ?? last('helm', 'warpFactor');
  const r = getRing(SHIP, 'shields');
  let weak = null;
  if (r?.len) for (const k of QUADS) { const v = r.last(k); if (!weak || v < weak.v) weak = { v, k }; }
  const shieldState = !user.groups.includes('shields') ? 'restricted' : weak ? 'live' : 'awaiting';
  return (
    <section className="helm" data-tour="helm" aria-label="Helm and navigation">
      <div className="helm__top">
        <Monitor title="Warp" index={7} state={helm ? 'live' : 'restricted'} restricted="Helm data: captain, science and communications">
          <Headline value={warp} dec={1} level={warp == null ? 'off' : 'ok'} word={warp != null && warp < 0.5 ? 'Impulse' : undefined} />
        </Monitor>
        <Astrogator heading={helm ? ov?.heading ?? last('helm', 'heading') : null} />
        <Monitor title="Shields" index={8} state={shieldState} restricted="Shield data: captain, engineering and science">
          <Headline value={weak?.v} unit="%" level={weak ? levelOf(weak.k, weak.v) : 'off'} word={last('shields', 'shieldsUp') > 0 ? 'Up' : 'Down'} />
        </Monitor>
      </div>
      <div className="helm__front" aria-hidden="true" />
    </section>
  );
}

const VIEW_WORD = { forward: 'Forward', tactical: 'Tactical', exterior: 'Exterior' };

// The arms of the captain's chair: grey boxes under walnut caps, the orders on black plates (RESEARCH.md, Bridge consoles).
function Chair({ user, condition, viewer, onViewer, onScenarios }) {
  const cond = useCommand('ship.condition');
  const shields = useCommand('tactical.shields');
  const hail = useCommand('comms.hail');
  const close = useCommand('comms.close');
  const captain = mayCommand(user, 'ship.condition');
  const canHail = mayCommand(user, 'comms.hail');
  const hailing = last('comms', 'hailing') > 0;
  const up = last('shields', 'shieldsUp') > 0;
  const tip = captain ? undefined : 'The captain gives this order';
  const running = ship.scenario && (ship.scenario.state === 'running' || ship.scenario.state === 'awaiting');
  return (
    <div className="chair" data-tour="chair">
      <div className="chair__arm">
        <ButtonRow label="Condition">
          <LitButton color="red" label="Red alert" keyCap="R" lit={condition === 'red'} pending={cond.pending} disabled={!captain} title={tip} onClick={() => cond.send({ level: 'red' })} />
          <LitButton color="yellow" label="Yellow" keyCap="Y" lit={condition === 'yellow'} disabled={!captain} title={tip ?? 'Yellow alert'} aria-label="Yellow alert" onClick={() => cond.send({ level: 'yellow' })} />
          <LitButton color="green" label="Stand down" keyCap="N" lit={condition === 'normal'} disabled={!captain} title={tip} onClick={() => cond.send({ level: 'normal' })} />
        </ButtonRow>
      </div>
      <div className="chair__seat" aria-hidden="true" />
      <div className="chair__arm">
        <ButtonRow label="Orders">
          <LitButton color="blue" label="Hail" keyCap="H" lit={hailing} pending={hail.pending || close.pending} disabled={!canHail} title={canHail ? undefined : 'Captain or communications officer'}
            onClick={() => (hailing ? close.send({}) : hail.send({ target: 'command' }))} />
          <LitButton color="amber" label="Shields" keyCap="⇧S" pressed={up} pending={shields.pending} disabled={!captain} title={tip} onClick={() => shields.send({ up: !up })} />
          <LitButton color="white" label={VIEW_WORD[viewer.mode]} keyCap="V" onClick={onViewer} title="Next viewscreen mode: forward, tactical, exterior" />
          <LitButton color="green" label="Scenario" lit={!!running} disabled={!mayCommand(user, 'scenario.start')} title="Play an episode of the original series" onClick={onScenarios} />
        </ButtonRow>
      </div>
    </div>
  );
}

// Three lines at most, newest first. Repeats of one alert, or of one log line, fold into one line with a count, and
// quiet links from several sources say how many went quiet.
function logRows() {
  const items = [
    ...state.alerts.filter((a) => a.sourceId === SHIP || a.sourceId == null).slice(0, 40)
      .map((a) => ({ key: a.type === 'link-loss' ? 'quiet' : `a|${a.type}|${a.channel}`, id: a.id, ts: a.ts, text: a.message, sev: SEV_LEVEL[a.severity], acked: !!a.ack, src: a.sourceId })),
    ...shipLog.slice(0, 40).map((l) => ({ key: `l|${l.text}`, id: l.id, ts: l.ts, text: l.text, sev: l.kind === 'command' ? (l.ok ? 'cmd' : 'bad') : 'log' })),
  ].sort((a, b) => b.ts - a.ts);
  const rows = new Map();
  for (const it of items) {
    const row = rows.get(it.key);
    if (row) { row.n++; row.srcs.add(it.src); } else if (rows.size < 3) rows.set(it.key, { ...it, n: 1, srcs: new Set([it.src]) });
  }
  return [...rows.values()].map((r) => ({ ...r, text: r.key === 'quiet' && r.srcs.size > 1 ? `${r.srcs.size} sources quiet` : r.n > 1 ? `${r.text} · ×${r.n}` : r.text }));
}

function CaptainsLog({ onOpen }) {
  const rows = logRows();
  return (
    <section className="log" data-tour="log" aria-label="Captain's log">
      <header className="log__head">
        <h2 className="log__title">Captain’s log</h2>
        <span className="log__sd mono">SD {stardate().toFixed(1)}</span>
        <button type="button" className="log__all" onClick={onOpen}>All alerts ›</button>
      </header>
      <ol className="log__list" aria-live="polite">
        {rows.map((r) => (
          <li key={r.id} className="log__row" data-sev={r.sev} data-fresh={Date.now() - r.ts < 4000 || undefined} data-acked={r.acked || undefined}>
            <span className="log__sd mono">{stardate(r.ts).toFixed(2)}</span>
            <LevelChip level={r.sev} />
            <span className="log__text">{r.text}</span>
          </li>
        ))}
        {!rows.length && <li className="log__row log__empty">All quiet on the bridge. Alerts, orders and scenario steps appear here.</li>}
      </ol>
    </section>
  );
}

// The glass; the viewer inside is the shell's MainViewer, which lives on between visits.
function Viewscreen({ ov, viewer, user }) {
  const orbit = last('helm', 'orbitAlt') > 0 || !!ship.scene;
  return (
    <figure className="viewscreen" data-tour="viewscreen">
      <div className="viewscreen__glass" style={{ '--zoom': viewer.zoom }}>
        <div className="viewscreen__zoom">
          <div ref={viewerSlot} className="viewscreen__slot" />
        </div>
        <ScenarioStrip user={user} />
        <figcaption className="viewscreen__mode mono">
          {viewer.mode === 'forward' && orbit ? 'ORBIT' : VIEW_WORD[viewer.mode].toUpperCase()} ×{viewer.zoom} · {ov?.warp != null ? (ov.warp >= 0.5 ? `WARP ${ov.warp.toFixed(1)}` : 'IMPULSE') : 'NO SIGNAL'}
        </figcaption>
      </div>
    </figure>
  );
}

// ---- the bridge ------------------------------------------------------------------------------------------------
// The forward wall seen from the captain's chair: 1600 x 936 at the least, scaled to fit the height and widened to
// fill wider screens; the side stations keep to the walls and the rest stays centred.
const W = 1600, H = 936;
const SUBSCRIBE = ['helm', 'warp', 'sensors', 'comms', 'lifesupport', 'crewsummary', 'shields'];

export default function Bridge({ powered, viewer, onViewer, onGo, user }) {
  useTick();
  const list = useMedia('(max-width: 1099px)');
  const groups = SUBSCRIBE.filter((g) => GROUPS.includes(g) && user.groups.includes(g));
  const ready = useSubscription([SHIP], groups);
  useEffect(() => { if (ready) backfill(SHIP, groups).catch(() => {}); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const ov = state.overview.get(SHIP);
  const condition = conditionOf(SHIP);

  const wrap = useRef(null);
  const [fit, setFit] = useState({ k: 0.9, w: W });
  useLayoutEffect(() => {
    if (list) return undefined;
    const el = wrap.current;
    const measure = () => { const k = Math.min(el.clientWidth / W, el.clientHeight / H); setFit({ k, w: el.clientWidth / k }); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [list]);

  // power-up once per session: monitors switch on one by one to four computer beeps, the viewscreen fades in
  const [boot, setBoot] = useState(() => { try { return sessionStorage.getItem(POWERED) !== '1'; } catch { return false; } });
  useEffect(() => {
    if (!boot || !powered) return undefined;
    try { sessionStorage.setItem(POWERED, '1'); } catch { /* private mode */ }
    const done = () => setBoot(false);
    const t = setTimeout(done, 2200);
    const beeps = [0, 1, 2, 3].map((i) => setTimeout(() => play('press'), 260 + i * 120));
    window.addEventListener('keydown', done, { once: true });
    window.addEventListener('pointerdown', done, { once: true });
    return () => { clearTimeout(t); beeps.forEach(clearTimeout); window.removeEventListener('keydown', done); window.removeEventListener('pointerdown', done); };
  }, [boot, powered]);

  const [picker, setPicker] = useState(false);

  // clicking a station zooms the bridge into it, then the turbolift takes over
  const [zoom, setZoom] = useState(null);
  const enterFrom = useRef(lastZoom);
  useEffect(() => { lastZoom = null; }, []);
  const zoomTo = (st, el) => {
    if (zoom) return;
    const box = el.getBoundingClientRect();
    const stage = wrap.current.querySelector('.bridge__stage')?.getBoundingClientRect() ?? box;
    const origin = list ? null : { x: ((box.left + box.width / 2 - stage.left) / stage.width) * 100, y: ((box.top + box.height / 2 - stage.top) / stage.height) * 100 };
    if (!origin || matchMedia('(prefers-reduced-motion: reduce)').matches) { onGo(st); return; }
    lastZoom = origin;
    setZoom(origin);
    setTimeout(() => onGo(st), 430);
  };

  const viewscreen = <Viewscreen ov={ov} viewer={viewer} user={user} />;
  const log = <CaptainsLog onOpen={() => onGo(stationById.alerts)} />;
  const helm = <HelmConsole ov={ov} user={user} />;
  const chair = <Chair user={user} condition={condition} viewer={viewer} onViewer={onViewer} onScenarios={() => setPicker(true)} />;
  const tiles = TILES.map((t, i) => <Tile key={t.id} tile={t} user={user} index={i + 1} onZoom={zoomTo} />);
  const from = enterFrom.current;
  return (
    <div ref={wrap} className={`bridge${list ? ' bridge--list' : ''}`} data-boot={boot && powered ? 'on' : undefined}>
      {list ? (
        <div className={`bridge__list${boot && powered ? ' power-on' : ''}`}>
          {viewscreen}
          {log}
          {chair}
          {helm}
          <div className="bridge__tiles">{tiles}</div>
        </div>
      ) : (
        <div className="bridge__fit" style={{ width: fit.w * fit.k, height: H * fit.k }}>
          <div className="bridge__scale" style={{ width: fit.w, transform: `scale(${fit.k})` }}>
            <div className={`bridge__stage${boot && powered ? ' power-on' : ''}${zoom ? ' is-zooming' : ''}${from && !zoom ? ' is-returning' : ''}`}
              style={{ '--zx': `${(zoom ?? from)?.x ?? 50}%`, '--zy': `${(zoom ?? from)?.y ?? 50}%` }}>
              <i className="desk desk--l" aria-hidden="true" />
              <i className="desk desk--r" aria-hidden="true" />
              <Rail side="l" />
              <Rail side="r" />
              {viewscreen}
              {log}
              {tiles}
              {helm}
              {chair}
            </div>
          </div>
        </div>
      )}
      {powered && !boot && <Tour />}
      {picker && <ScenarioPicker user={user} onClose={() => setPicker(false)} />}
    </div>
  );
}

// The red railing round the well, one side of it: a flat red rail on black posts, curving toward the chair.
function Rail({ side }) {
  return (
    <svg className={`rail rail--${side}`} viewBox="0 0 440 150" aria-hidden="true">
      {[70, 190, 310].map((x) => <path key={x} className="rail__post" d={`M${x - 9} ${22 + x * 0.11} L${x + 9} ${22 + x * 0.11} L${x + 16} 150 L${x - 16} 150 Z`} />)}
      <path className="rail__bar" d="M0 14 Q 240 18 440 74" />
    </svg>
  );
}

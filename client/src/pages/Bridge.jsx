import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHANNEL_BY_KEY, GROUPS, GROUP_CHANNELS, SOURCES } from '@ncc/shared/schema.js';
import { stationById, canEnter } from '../app/stations.js';
import { useSubscription, useTick } from '../lib/hooks.js';
import { bandOf, levelOf, worst } from '../lib/limits.js';
import { conditionOf, ship, shipLog, stardate } from '../lib/ship.js';
import { backfill, getRing, state } from '../lib/store.js';
import { viewerSlot } from '../app/MainViewer.jsx';
import { ArcGauge, ButtonGrid, DivisionPill, Icon, Jewel, KeyCap, LevelChip, LitButton, Monitor, Num, Readout, SweepScope, mayCommand, useCommand } from '../ui/index.js';
import Tour from '../app/Tour.jsx';
import { ScenarioPicker, ScenarioStrip, Ticker } from './Scenario.jsx';
import './bridge.css';

const SHIP = 1;
const POWERED = 'ncc.powered';
const has = (key) => !!CHANNEL_BY_KEY[key];
const last = (group, key) => (has(key) ? getRing(SHIP, group)?.last(key) : undefined);
const spark = (group, key) => (has(key) ? getRing(SHIP, group)?.window(60_000, [key]) : null);
const decOf = (key) => Math.min(2, Math.max(0, Math.round(Math.log10(CHANNEL_BY_KEY[key]?.scale ?? 1))));
const FLAG_STATUS = (f) => (!(f & 1) ? 'off' : f & 4 ? 'crit' : f & 2 ? 'warn' : 'ok');
const COND_STATUS = { normal: 'ok', yellow: 'warn', red: 'crit' };
const SEV_LEVEL = { warning: 'warn', warn: 'warn', critical: 'crit' };
const WARP_TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
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

// ---- station tiles -----------------------------------------------------------------------------------------
function Sub({ group, k, label, unit }) {
  const v = last(group, k);
  const s = levelOf(k, v);
  return (
    <span className="tile__sub" data-status={s}>
      <span className="label">{label}</span>
      <Num className="mono" value={v} dec={decOf(k)} />{unit && <small>{unit}</small>}
    </span>
  );
}

function EngineeringReadout() {
  const v = last('warp', 'reactionRate');
  return (
    <>
      <Readout label="Matter/antimatter reaction" value={v} unit="% rated" dec={0} status={levelOf('reactionRate', v)} spark={spark('warp', 'reactionRate')} band={bandOf('reactionRate')} />
      <div className="tile__subs"><Sub group="warp" k="chamberTemp" label="Chamber" unit="MK" /><Sub group="warp" k="dilithiumEff" label="Dilithium" unit="%" /></div>
    </>
  );
}

function LifeSupportReadout() {
  const r = getRing(SHIP, 'lifesupport');
  let deck = null, o2 = Infinity;
  for (let d = 1; d <= 12; d++) {
    const k = `o2_${String(d).padStart(2, '0')}`;
    const v = r?.last(k);
    if (v != null && v < o2) { o2 = v; deck = d; }
  }
  const keys = GROUP_CHANNELS.lifesupport ?? [];
  const status = r ? worst(keys.map((k) => levelOf(k, r.last(k)))) : 'off';
  const key = deck ? `o2_${String(deck).padStart(2, '0')}` : null;
  return (
    <>
      <Readout label={deck ? `Lowest oxygen · deck ${deck}` : 'Lowest oxygen'} value={deck ? o2 : null} unit="%" dec={1} status={key ? levelOf(key, o2) : 'off'} spark={key && spark('lifesupport', key)} band={key && bandOf(key)} />
      <div className="tile__subs">
        <span className="tile__sub" data-status={status}><span className="label">12 decks</span><b className="mono">{status === 'off' ? '—' : status === 'ok' ? 'NOMINAL' : status === 'warn' ? 'YELLOW' : 'RED'}</b></span>
        <Sub group="lifesupport" k="co2_01" label="Bridge CO₂" unit="ppm" />
      </div>
    </>
  );
}

function SickbayReadout() {
  const v = last('crewsummary', 'crewWatch');
  return (
    <>
      <Readout label="Crew on medical watch" value={v} dec={0} status={levelOf('crewWatch', v)} spark={spark('crewsummary', 'crewWatch')} />
      <div className="tile__subs"><Sub group="crewsummary" k="crewCritical" label="Critical" /><Sub group="crewsummary" k="crewAboard" label="Aboard" /></div>
    </>
  );
}

function ScienceReadout() {
  const n = last('sensors', 'contacts');
  const range = last('sensors', 'contactRange');
  const contacts = n > 0 && range < 1e6 ? [{ bearing: last('sensors', 'contactBearing') ?? 0, range: Math.min(1, (range ?? 0) / 400000), cloaked: last('sensors', 'contactSnr') < 10 }] : [];
  return (
    <div className="tile__scope">
      <SweepScope contacts={contacts} label="Short-range sensors" />
      <div className="tile__scope-read">
        <Readout label="Contacts" value={n} dec={0} status={n == null ? 'off' : 'ok'} />
        <Sub group="sensors" k="contactRange" label="Nearest" unit="km" />
        <Sub group="sensors" k="ionFlux" label="Ion flux" />
      </div>
    </div>
  );
}

function CommsReadout() {
  const v = last('comms', 'carrier');
  const hailing = last('comms', 'hailing') > 0;
  return (
    <>
      <Readout label="Subspace carrier" value={v} unit="dB" dec={1} status={levelOf('carrier', v)} spark={spark('comms', 'carrier')} band={bandOf('carrier')} />
      <div className="tile__subs">
        <Sub group="comms" k="delay" label="Delay" unit="s" />
        <span className="tile__sub" data-status={hailing ? 'ready' : 'ok'}><span className="label">Hailing</span><b className="mono">{hailing ? 'OPEN' : 'CLOSED'}</b></span>
      </div>
    </>
  );
}

function FleetReadout() {
  const ships = SOURCES.filter((s) => (s.kind ?? 'ship') === 'ship' && s.id !== SHIP).slice(0, 3);
  return (
    <ul className="fleet">
      {ships.map((s) => {
        const o = state.overview.get(s.id);
        const status = o ? (o.condition && o.condition !== 'normal' ? COND_STATUS[o.condition] : FLAG_STATUS(o.flags)) : 'off';
        return (
          <li key={s.id}>
            <Jewel status={status} label={`${s.name}: ${status === 'off' ? 'no signal' : o?.condition ?? 'online'}`} />
            <span className="fleet__name"><b className="mono">{s.code}</b><span>{s.name.replace('USS ', '')}</span></span>
            <span className="fleet__warp mono">{o?.warp != null ? `W${o.warp.toFixed(1)}` : status === 'off' ? 'NO SIGNAL' : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

const TILES = [
  { id: 'engineering', station: 'engineering', title: 'Engineering', division: 'ops', group: 'warp', Body: EngineeringReadout },
  { id: 'lifesupport', station: 'engineering', title: 'Life support', division: 'ops', group: 'lifesupport', Body: LifeSupportReadout },
  { id: 'sickbay', station: 'sickbay', title: 'Sickbay', division: 'science', group: 'crewsummary', Body: SickbayReadout },
  { id: 'science', station: 'science', title: 'Science', division: 'science', group: 'sensors', Body: ScienceReadout },
  { id: 'comms', station: 'comms', title: 'Communications', division: 'ops', group: 'comms', Body: CommsReadout },
  { id: 'fleet', station: 'fleet', title: 'Task force', division: 'fleet', group: null, Body: FleetReadout },
];
const RESTRICTED_TEXT = { warp: 'Engineering data: chief engineer and captain', lifesupport: 'Life support data: engineering, medical and captain', crewsummary: 'Crew counts', sensors: 'Sensor data: science, communications and captain', comms: 'Communications data: comms, science and captain' };

function Tile({ tile, user, index, onZoom }) {
  const st = stationById[tile.station];
  const sees = !tile.group || (user.groups.includes(tile.group) && GROUPS.includes(tile.group));
  const enters = canEnter(user, st);
  const status = !sees ? 'off' : tile.group ? tileStatus(tile.group) : 'ok';
  const ref = useRef(null);
  return (
    <button type="button" ref={ref} className={`tile tile--${tile.id}`} data-tour={`tile-${tile.id}`} data-locked={!enters || undefined}
      onClick={() => onZoom(st, ref.current)} aria-label={`${tile.title}: open the ${st.label} station${enters ? '' : ' (restricted)'}`}>
      <Monitor title={tile.title} division={tile.division} index={index} status={status} state={sees ? 'live' : 'restricted'}
        restricted={RESTRICTED_TEXT[tile.group]} meta={!enters && <Icon name="lock" className="tile__lock" title="Restricted station" />}>
        <tile.Body />
      </Monitor>
      <ButtonGrid rows={1} cols={16} seed={index + 3} className="tile__lamps" />
    </button>
  );
}
function tileStatus(group) {
  const r = getRing(SHIP, group);
  if (!r) return 'off';
  return worst((GROUP_CHANNELS[group] ?? []).map((k) => levelOf(k, r.last(k))).filter((s) => s !== 'off').concat('ok'));
}

// ---- helm console, chair, log, turbolift --------------------------------------------------------------------------
function Compass({ heading }) {
  return (
    <svg viewBox="0 0 120 120" className="compass" role="img" aria-label={`Heading ${heading == null ? 'unknown' : `${heading.toFixed(0)} degrees`}`}>
      <circle cx="60" cy="60" r="52" className="compass__ring" />
      <g style={{ transform: `rotate(${-(heading ?? 0)}deg)`, transformOrigin: '60px 60px', transition: 'transform 600ms var(--ease-in)' }}>
        {Array.from({ length: 36 }, (_, i) => (
          <line key={i} x1="60" y1={i % 9 === 0 ? 10 : 12} x2="60" y2={i % 9 === 0 ? 20 : 16} className={i % 9 === 0 ? 'compass__major' : 'compass__tick'} transform={`rotate(${i * 10} 60 60)`} />
        ))}
        {['000', '090', '180', '270'].map((t, i) => <text key={t} x="60" y="31" className="compass__label" transform={`rotate(${i * 90} 60 60)`}>{t}</text>)}
      </g>
      <path d="M60 36 L66 66 L60 61 L54 66 Z" className="compass__ship" />
    </svg>
  );
}

function HelmConsole({ ov }) {
  const warp = ov?.warp ?? last('helm', 'warpFactor');
  const heading = ov?.heading ?? last('helm', 'heading');
  const shield = ov?.shield ?? null;
  const shieldStatus = shield == null ? 'off' : shield < 25 ? 'crit' : shield < 50 ? 'warn' : 'ok';
  return (
    <section className="helm" data-tour="helm" aria-label="Helm and navigation">
      <header className="helm__title"><DivisionPill division="command" /><h3>Helm · Navigation</h3></header>
      <div className="helm__body">
        <div className="helm__warp">
          <ArcGauge value={warp} k="warpFactor" min={0} max={9} ticks={WARP_TICKS} dec={1} label="Warp factor" />
          <span className="label">Warp factor</span>
        </div>
        <div className="helm__nav">
          <Compass heading={heading} />
          <span className="helm__heading mono">{heading == null ? '—' : `${heading.toFixed(1).padStart(5, '0')}°`}</span>
          <span className="label">Heading</span>
        </div>
        <div className="helm__shield" data-status={shieldStatus}>
          <span className="label">Weakest shield</span>
          <span className="helm__shield-num"><Num value={shield} dec={0} /><small>%</small></span>
          <span className="helm__shield-word">{shieldStatus === 'crit' ? 'RED' : shieldStatus === 'warn' ? 'YELLOW' : shieldStatus === 'off' ? 'NO SIGNAL' : 'HOLDING'}</span>
        </div>
      </div>
      <ButtonGrid rows={2} cols={30} seed={41} className="helm__lamps" />
    </section>
  );
}

const VIEW_WORD = { forward: 'Forward', tactical: 'Tactical', exterior: 'Exterior' };

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
      <div className="chair__arm chair__arm--l" role="group" aria-label="Condition">
        <LitButton color="red" label="Red alert" keyCap="R" size="sm" lit={condition === 'red'} pending={cond.pending} disabled={!captain} title={tip} onClick={() => cond.send({ level: 'red' })} />
        <LitButton color="yellow" label="Yellow" keyCap="Y" size="sm" lit={condition === 'yellow'} disabled={!captain} title={tip} onClick={() => cond.send({ level: 'yellow' })} />
        <LitButton color="green" label="Stand down" keyCap="N" size="sm" lit={condition === 'normal'} disabled={!captain} title={tip} onClick={() => cond.send({ level: 'normal' })} />
      </div>
      <div className="chair__seat" aria-hidden="true"><i /><span className="chair__back" /></div>
      <div className="chair__arm chair__arm--r" role="group" aria-label="Orders">
        <LitButton color="blue" label="Hail" keyCap="H" size="sm" lit={hailing} pending={hail.pending || close.pending} disabled={!canHail} title={canHail ? undefined : 'Captain or communications officer'}
          onClick={() => (hailing ? close.send({}) : hail.send({ target: 'command' }))} />
        <LitButton color="amber" label="Shields" keyCap="⇧S" size="sm" pressed={up} pending={shields.pending} disabled={!captain} title={tip} onClick={() => shields.send({ up: !up })} />
        <LitButton color="white" label={VIEW_WORD[viewer.mode]} keyCap="V" size="sm" onClick={onViewer} title="Next viewscreen mode: forward, tactical, exterior" />
        <LitButton color="green" label="Scenario" size="sm" lit={!!running} disabled={!mayCommand(user, 'scenario.start')}
          title={mayCommand(user, 'scenario.start') ? 'Play an episode of the original series' : 'Captain or Starfleet Command'}
          onClick={onScenarios} />
      </div>
    </div>
  );
}

function CaptainsLog({ onOpen }) {
  const alerts = state.alerts.filter((a) => a.sourceId === SHIP || a.sourceId == null).slice(0, 8)
    .map((a) => ({ id: a.id, ts: a.ts, text: a.message, sev: a.severity, acked: !!a.ack, fresh: a.arrivedAt && Date.now() - a.arrivedAt < 4000 }));
  const lines = shipLog.slice(0, 8).map((l) => ({ id: l.id, ts: l.ts, text: l.text, sev: l.kind === 'command' ? (l.ok ? 'cmd' : 'bad') : 'log', fresh: Date.now() - l.ts < 4000 }));
  const rows = [...alerts, ...lines].sort((a, b) => b.ts - a.ts).slice(0, 6);
  return (
    <Monitor title="Captain's log" division="command" className="log" data-tour="log"
      meta={<><span className="mono">SD {stardate().toFixed(1)}</span><button type="button" className="linkbtn log__all" onClick={onOpen}>All alerts</button></>}>
      <ol className="log__list" aria-live="polite">
        {rows.map((r) => (
          <li key={r.id} className="log__row" data-sev={r.sev} data-fresh={r.fresh || undefined} data-acked={r.acked || undefined}>
            <span className="log__sd mono">{stardate(r.ts).toFixed(2)}</span>
            <LevelChip level={SEV_LEVEL[r.sev]} />
            <span className="log__text">{r.text}</span>
          </li>
        ))}
        {!rows.length && <li className="log__empty">All quiet. Alerts, orders and scenario steps appear here.</li>}
      </ol>
    </Monitor>
  );
}

function Turbolift({ onLift }) {
  return (
    <button type="button" className="liftdoor" data-tour="lift" onClick={onLift} aria-label="Turbolift: choose a station (Ctrl K)">
      <span className="liftdoor__doors" aria-hidden="true"><i /><i /></span>
      <span className="liftdoor__label"><span className="display">Turbolift</span><KeyCap>Ctrl K</KeyCap></span>
    </button>
  );
}

// The glass and its captions; the viewer inside is the shell's MainViewer, which lives on between visits.
function Viewscreen({ ov, viewer, user }) {
  const orbit = last('helm', 'orbitAlt') > 0 || !!ship.scene;
  return (
    <figure className="viewscreen" data-tour="viewscreen">
      <div className="viewscreen__glass" style={{ '--zoom': viewer.zoom }}>
        <div className="viewscreen__zoom">
          <div ref={viewerSlot} className="viewscreen__slot" />
        </div>
        <ScenarioStrip user={user} />
      </div>
      <figcaption className="viewscreen__caption">
        <Ticker />
        <span className="viewscreen__mode mono">{viewer.mode === 'forward' && orbit ? 'ORBIT' : VIEW_WORD[viewer.mode].toUpperCase()} ×{viewer.zoom} · {ov?.warp != null ? (ov.warp >= 0.5 ? `WARP ${ov.warp.toFixed(1)}` : 'IMPULSE') : 'NO SIGNAL'}</span>
      </figcaption>
    </figure>
  );
}

// ---- the bridge ------------------------------------------------------------------------------------------------
const W = 1600, H = 900;
const SUBSCRIBE = ['helm', 'warp', 'sensors', 'comms', 'lifesupport', 'crewsummary', 'shields'];

export default function Bridge({ powered, viewer, onViewer, onGo, onLift, user }) {
  useTick();
  const list = useMedia('(max-width: 899px)');
  const groups = SUBSCRIBE.filter((g) => GROUPS.includes(g) && user.groups.includes(g));
  const ready = useSubscription([SHIP], groups);
  useEffect(() => { if (ready) backfill(SHIP, groups).catch(() => {}); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const ov = state.overview.get(SHIP);
  const condition = conditionOf(SHIP);

  // fit the 1600 x 900 bridge into the space under the top bar
  const wrap = useRef(null);
  const [k, setK] = useState(0.9);
  useLayoutEffect(() => {
    if (list) return undefined;
    const el = wrap.current;
    const fit = () => setK(Math.min(el.clientWidth / W, el.clientHeight / H));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [list]);

  // power-up once per session: monitors switch on, grids light left to right, the viewscreen fades in
  const [boot, setBoot] = useState(() => { try { return sessionStorage.getItem(POWERED) !== '1'; } catch { return false; } });
  useEffect(() => {
    if (!boot || !powered) return undefined;
    try { sessionStorage.setItem(POWERED, '1'); } catch { /* private mode */ }
    const done = () => setBoot(false);
    const t = setTimeout(done, 2200);
    window.addEventListener('keydown', done, { once: true });
    window.addEventListener('pointerdown', done, { once: true });
    return () => { clearTimeout(t); window.removeEventListener('keydown', done); window.removeEventListener('pointerdown', done); };
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

  const parts = {
    viewscreen: <Viewscreen ov={ov} viewer={viewer} user={user} />,
    helm: <HelmConsole ov={ov} />,
    chair: <Chair user={user} condition={condition} viewer={viewer} onViewer={onViewer} onScenarios={() => setPicker(true)} />,
    log: <CaptainsLog onOpen={() => onGo(stationById.alerts)} />,
    lift: <Turbolift onLift={onLift} />,
    tiles: TILES.map((t, i) => <Tile key={t.id} tile={t} user={user} index={i + 1} onZoom={zoomTo} />),
  };
  const from = enterFrom.current;
  return (
    <div ref={wrap} className={`bridge${list ? ' bridge--list' : ''}`} data-boot={boot && powered ? 'on' : undefined}>
      {list ? (
        <div className="bridge__list">
          {parts.viewscreen}
          {parts.chair}
          {parts.helm}
          {parts.tiles}
          {parts.log}
          {parts.lift}
        </div>
      ) : (
        <div className="bridge__fit" style={{ width: W * k, height: H * k }}>
          <div className="bridge__scale" style={{ transform: `scale(${k})` }}>
          <div className={`bridge__stage${boot && powered ? ' power-on' : ''}${zoom ? ' is-zooming' : ''}${from && !zoom ? ' is-returning' : ''}`}
            style={{ '--zx': `${(zoom ?? from)?.x ?? 50}%`, '--zy': `${(zoom ?? from)?.y ?? 50}%` }}>
            <Room />
            <i className="beacon beacon--l" aria-hidden="true" />
            <i className="beacon beacon--r" aria-hidden="true" />
            {parts.viewscreen}
            {parts.tiles}
            {parts.helm}
            {parts.chair}
            {parts.log}
            {parts.lift}
          </div>
          </div>
        </div>
      )}
      {powered && !boot && <Tour />}
      {picker && <ScenarioPicker user={user} onClose={() => setPicker(false)} />}
    </div>
  );
}

// The room: the grey-green upper deck around the stations, the well with the captain's chair, the red railing.
function Room() {
  const cx = 800, cy = 590, rx = 470, ry = 238;
  const p = (a, sx = rx, sy = ry) => `${(cx + sx * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(cy + sy * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
  return (
    <svg className="room" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <radialGradient id="room-light" cx="50%" cy="10%" r="80%">
          <stop offset="0" stopColor="#2a3330" />
          <stop offset="0.55" stopColor="#141917" />
          <stop offset="1" stopColor="#070908" />
        </radialGradient>
        <radialGradient id="well" cx="50%" cy="40%" r="65%">
          <stop offset="0" stopColor="#15181a" />
          <stop offset="1" stopColor="#08090a" />
        </radialGradient>
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a4f" />
          <stop offset="0.5" stopColor="var(--railing)" />
          <stop offset="1" stopColor="#8f2d14" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#room-light)" className="room__wall" />
      {/* upper deck seams, radiating from the centre of the room */}
      {Array.from({ length: 16 }, (_, i) => 180 + i * 12).map((a) => (
        <line key={a} x1={p(a, rx + 24, ry + 14).split(' ')[0]} y1={p(a, rx + 24, ry + 14).split(' ')[1]} x2={p(a, rx + 640, ry + 420).split(' ')[0]} y2={p(a, rx + 640, ry + 420).split(' ')[1]} className="room__seam" />
      ))}
      <ellipse cx={cx} cy={cy} rx={rx + 22} ry={ry + 12} className="room__step" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#well)" />
      {[0.82, 0.62, 0.42].map((f) => <ellipse key={f} cx={cx} cy={cy + 12} rx={rx * f} ry={ry * f} className="room__ring" />)}
      {/* the railing: round the back and sides of the well, open at the front toward the viewscreen */}
      <path d={`M${p(-24)} A${rx} ${ry} 0 1 1 ${p(204)}`} className="room__rail-shadow" />
      <path d={`M${p(-24)} A${rx} ${ry} 0 1 1 ${p(204)}`} stroke="url(#rail)" className="room__rail" />
    </svg>
  );
}

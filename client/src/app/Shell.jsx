import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { commandWords, mayCommand, onCommandResult, sendCommand } from '../lib/commands.js';
import { useTick } from '../lib/hooks.js';
import { inField } from '../lib/keys.js';
import { conditionOf, loadShip } from '../lib/ship.js';
import { play, toggleSound } from '../lib/sound.js';
import { ackAlert, getRing, state } from '../lib/store.js';
import Bridge from '../pages/Bridge.jsx';
import MainViewer from './MainViewer.jsx';
import { ShortcutSheet, Turbolift } from './Overlays.jsx';
import StationRoute from './StationRoute.jsx';
import { PAGES, STATIONS, stationAt } from './stations.js';
import { TopBar } from './TopBar.jsx';
import './shell.css';

const MAGNIFY = [1, 2, 4, 8];
const VIEW_MODES = ['forward', 'tactical', 'exterior'];

/** The signed-in frame: top bar, alert bars, the station views and every keyboard shortcut. */
export default function Shell({ powered, aboard }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useTick();
  const [overlay, setOverlay] = useState(null); // 'lift' | 'keys' | null
  const [toast, setToast] = useState(null);
  const [viewer, setViewer] = useState({ mode: 'forward', zoom: 1 });
  const [standDown, setStandDown] = useState(false);
  const [lift, setLift] = useState(0); // bumps on every station change: replays the turbolift light

  useEffect(() => { loadShip(); }, []); // condition, scenario and the last log lines for a bridge that joins late

  // ---- condition: the server's, reflected on <html> so every surface follows it --------------------
  const condition = conditionOf(1);
  const prevCondition = useRef(condition);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.condition = condition;
    root.dataset.attention = condition === 'red' ? 'red-alert' : 'live';
    const prev = prevCondition.current;
    prevCondition.current = condition;
    if (prev === condition) return undefined;
    if (condition === 'red') play('red', 2);
    else if (condition === 'yellow') play('yellow');
    else { setStandDown(true); const t = setTimeout(() => setStandDown(false), 1000); return () => clearTimeout(t); }
    return undefined;
  }, [condition]);
  useEffect(() => () => { delete document.documentElement.dataset.condition; delete document.documentElement.dataset.attention; }, []);

  // a contact appearing on sensors (Balance of Terror's Romulan ship) puts the tactical view on the main viewer
  const contact = getRing(1, 'sensors')?.last('contacts') > 0;
  const hadContact = useRef(contact);
  useEffect(() => {
    if (contact && !hadContact.current) setViewer((v) => ({ ...v, mode: 'tactical' }));
    hadContact.current = contact;
  }, [contact]);

  // ---- feedback line for commands and refusals --------------------------------------------------------
  const say = useCallback((text, tone = 'info') => setToast({ text, tone, id: Math.random() }), []);
  useEffect(() => onCommandResult((r) => say(r.ok ? `${r.text ?? `${commandWords(r.type, r.payload)}, aye`} · ${r.rtt} ms` : `${commandWords(r.type, r.payload)}: ${r.error}`, r.ok ? 'ok' : 'bad')), [say]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  // ---- station changes ---------------------------------------------------------------------------------
  const current = stationAt(location.pathname)?.id ?? 'bridge';
  const go = useCallback((st) => {
    setOverlay(null);
    if (!st || location.pathname === st.path) return;
    play('station');
    navigate(st.path);
  }, [location.pathname, navigate]);
  useEffect(() => { setLift((n) => n + 1); }, [location.pathname]);

  // ---- keyboard (DESIGN.md, At the helm) ---------------------------------------------------------------
  // Two listeners on window. The capture one runs before anything else and owns the turbolift (Ctrl K) and the
  // G-then-letter jumps. The bubble one runs after every station's own keys (lib/keys.js useKeys listens on
  // document, which an event reaches first) and skips a key a station already took. No key fires twice.
  const order = useCallback((type, payload) => {
    if (!mayCommand(user, type)) { say(`${commandWords(type, payload)}: ${type.startsWith('comms.') ? 'captain or communications officer only' : 'captain only'}`, 'bad'); return; }
    sendCommand(type, payload);
  }, [user, say]);
  const gAt = useRef(0);
  useEffect(() => {
    const quiet = (e) => e.ctrlKey || e.metaKey || e.altKey || e.repeat || inField(e.target) || overlay || !aboard;
    const take = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onNav = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { take(e); setOverlay((o) => (o === 'lift' ? null : 'lift')); return; }
      if (quiet(e)) return;
      if (performance.now() - gAt.current < 1500) { // the letter after G is a destination, never a command
        gAt.current = 0;
        take(e);
        go(STATIONS.find((s) => s.key === e.key.toLowerCase()));
      } else if (e.key === 'g' || e.key === 'G') { gAt.current = performance.now(); take(e); }
    };
    const onKey = (e) => {
      if (e.defaultPrevented || quiet(e)) return;
      const k = e.key;
      if (k === 'Escape') { if (location.pathname !== '/bridge') go(STATIONS[0]); return; }
      const ov = state.overview.get(1);
      const warpNow = Math.round(ov?.warp ?? getRing(1, 'helm')?.last('warpFactor') ?? 0);
      switch (k) {
        case '?': setOverlay('keys'); return;
        case 'm': case 'M': toggleSound(); return;
        case 'r': case 'R': order('ship.condition', { level: 'red' }); return;
        case 'y': case 'Y': order('ship.condition', { level: 'yellow' }); return;
        case 'n': case 'N': order('ship.condition', { level: 'normal' }); return;
        case 'i': case 'I': order('helm.impulse', { percent: 100 }); return;
        case 'x': case 'X': order('helm.stop', {}); return;
        case 'S': if (e.shiftKey) order('tactical.shields', { up: !(getRing(1, 'shields')?.last('shieldsUp') > 0) }); return;
        case 'p': case 'P': if (e.shiftKey) order('tactical.torpedo', {}); else order('tactical.phasers', { bank: 'fore' }); return;
        case 'h': case 'H': if (getRing(1, 'comms')?.last('hailing') > 0) order('comms.close', {}); else order('comms.hail', { target: 'command' }); return;
        case 'v': case 'V': setViewer((v) => ({ ...v, mode: VIEW_MODES[(VIEW_MODES.indexOf(v.mode) + 1) % VIEW_MODES.length] })); return;
        case '+': case '=': setViewer((v) => ({ ...v, zoom: MAGNIFY[Math.min(3, MAGNIFY.indexOf(v.zoom) + 1)] })); return;
        case '-': case '_': setViewer((v) => ({ ...v, zoom: MAGNIFY[Math.max(0, MAGNIFY.indexOf(v.zoom) - 1)] })); return;
        // arrows steer only for a role that may: everyone else keeps them for scrolling
        case 'ArrowUp': if (mayCommand(user, 'helm.warp')) { e.preventDefault(); order('helm.warp', { factor: Math.min(9, warpNow + 1) }); } return;
        case 'ArrowDown': if (mayCommand(user, 'helm.warp')) { e.preventDefault(); order('helm.warp', { factor: Math.max(0, warpNow - 1) }); } return;
        case 'ArrowLeft': if (mayCommand(user, 'helm.heading')) { e.preventDefault(); order('helm.heading', { delta: -5 }); } return;
        case 'ArrowRight': if (mayCommand(user, 'helm.heading')) { e.preventDefault(); order('helm.heading', { delta: 5 }); } return;
        case 'a': case 'A': {
          const a = state.alerts.find((x) => !x.ack && x.sourceId === 1);
          if (!a) { say('No open alert to acknowledge'); return; }
          if (!user.canAck) { say('Your role cannot acknowledge alerts', 'bad'); return; }
          ackAlert(a.id).then((r) => say(r.ok ? `Acknowledged: ${a.message}` : 'Acknowledge refused', r.ok ? 'ok' : 'bad'));
          return;
        }
        default:
          if (/^[0-9]$/.test(k)) order('helm.warp', { factor: Number(k) });
      }
    };
    window.addEventListener('keydown', onNav, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onNav, true); window.removeEventListener('keydown', onKey); };
  }, [overlay, aboard, location.pathname, go, order, say, user]);

  const back = useCallback(() => go(STATIONS[0]), [go]);
  const nextView = useCallback(() => setViewer((v) => ({ ...v, mode: VIEW_MODES[(VIEW_MODES.indexOf(v.mode) + 1) % VIEW_MODES.length] })), []);
  return (
    <div className="shell">
      <div className="alertbar alertbar--top" aria-hidden="true" />
      <div className="alertbar alertbar--bottom" aria-hidden="true" />
      <div className="redwash" aria-hidden="true" />
      <TopBar user={user} condition={condition} standDown={standDown} onLift={() => setOverlay('lift')} onSignOut={() => logout()} />
      <div className="railing" aria-hidden="true" />
      <i key={lift} className="lift-light" aria-hidden="true" />
      {lift > 1 && location.pathname !== '/bridge' && <div key={`doors${lift}`} className="lift-doors" aria-hidden="true"><i /><i /></div>}
      <div key={location.pathname} className={`view ${location.pathname === '/bridge' ? 'view--bridge' : 'view--station'}`}>
        <Routes location={location}>
          <Route path="/bridge" element={<Bridge powered={powered} viewer={viewer} onViewer={nextView} onGo={go} onLift={() => setOverlay('lift')} user={user} />} />
          {[...STATIONS.slice(1), ...PAGES].map((st) => (
            <Route key={st.id} path={`${st.path}/*`} element={<StationRoute station={st} onBack={back} />} />
          ))}
          <Route path="*" element={<Navigate to="/bridge" replace />} />
        </Routes>
      </div>
      <MainViewer viewer={viewer} condition={condition} threeD={aboard} />
      {overlay === 'lift' && <Turbolift user={user} current={current} onGo={go} onClose={() => setOverlay(null)} />}
      {overlay === 'keys' && <ShortcutSheet onClose={() => setOverlay(null)} />}
      <div className="toast-slot" role="status" aria-live="polite">
        {toast && <div key={toast.id} className="toast" data-tone={toast.tone}>{toast.text}</div>}
      </div>
      <span className="sr-only" aria-live="assertive">{condition === 'red' ? 'Red alert' : condition === 'yellow' ? 'Yellow alert' : ''}</span>
    </div>
  );
}


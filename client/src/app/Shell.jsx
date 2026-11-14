import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { commandWords, mayCommand, onCommandResult, sendCommand } from '../lib/commands.js';
import { useTick } from '../lib/hooks.js';
import { conditionOf } from '../lib/ship.js';
import { play, toggleSound } from '../lib/sound.js';
import { ackAlert, getRing, state } from '../lib/store.js';
import Bridge from '../pages/Bridge.jsx';
import { ShortcutSheet, Turbolift } from './Overlays.jsx';
import StationRoute from './StationRoute.jsx';
import { PAGES, STATIONS, stationAt } from './stations.js';
import { TopBar } from './TopBar.jsx';
import './shell.css';

const MAGNIFY = [1, 2, 4, 8];
const VIEW_MODES = ['forward', 'tactical'];
const typing = (el) => el?.closest?.('input, textarea, select, [contenteditable="true"]');

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

  // ---- feedback line for commands and refusals --------------------------------------------------------
  const say = useCallback((text, tone = 'info') => setToast({ text, tone, id: Math.random() }), []);
  useEffect(() => onCommandResult((r) => say(r.ok ? `${commandWords(r.type, r.payload)}, aye · ${r.rtt} ms` : `${commandWords(r.type, r.payload)}: ${r.error}`, r.ok ? 'ok' : 'bad')), [say]);
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
  const order = useCallback((type, payload) => {
    if (!mayCommand(user, type)) { say(`${commandWords(type, payload)}: ${type.startsWith('comms.') ? 'captain or communications officer only' : 'captain only'}`, 'bad'); return; }
    sendCommand(type, payload);
  }, [user, say]);
  const gAt = useRef(0);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOverlay((o) => (o === 'lift' ? null : 'lift')); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || overlay) return;
      const k = e.key;
      if (k === 'Escape') { if (location.pathname !== '/bridge') go(STATIONS[0]); return; }
      if (performance.now() - gAt.current < 1500) {
        gAt.current = 0;
        const st = STATIONS.find((s) => s.key === k.toLowerCase());
        if (st) { e.preventDefault(); go(st); }
        return;
      }
      const ov = state.overview.get(1);
      const warpNow = Math.round(ov?.warp ?? getRing(1, 'helm')?.last('warpFactor') ?? 0);
      switch (k) {
        case 'g': case 'G': gAt.current = performance.now(); return;
        case '?': setOverlay('keys'); return;
        case 'm': case 'M': toggleSound(); return;
        case 'r': case 'R': order('ship.condition', { level: 'red' }); return;
        case 'y': case 'Y': order('ship.condition', { level: 'yellow' }); return;
        case 'n': case 'N': order('ship.condition', { level: 'normal' }); return;
        case 'i': case 'I': order('helm.impulse', { percent: 100 }); return;
        case 'x': case 'X': order('helm.stop', {}); return;
        case 'S': if (e.shiftKey) order('tactical.shields', { up: !(getRing(1, 'shields')?.last('shieldsUp') > 0) }); return;
        case 'p': order('tactical.phasers', { bank: 'fore' }); return;
        case 'P': order('tactical.torpedo', {}); return;
        case 'h': case 'H': order(getRing(1, 'comms')?.last('hailing') > 0 ? 'comms.close' : 'comms.hail', { target: 'command' }); return;
        case 'v': case 'V': setViewer((v) => ({ ...v, mode: VIEW_MODES[(VIEW_MODES.indexOf(v.mode) + 1) % VIEW_MODES.length] })); return;
        case '+': case '=': setViewer((v) => ({ ...v, zoom: MAGNIFY[Math.min(3, MAGNIFY.indexOf(v.zoom) + 1)] })); return;
        case '-': case '_': setViewer((v) => ({ ...v, zoom: MAGNIFY[Math.max(0, MAGNIFY.indexOf(v.zoom) - 1)] })); return;
        case 'ArrowUp': e.preventDefault(); order('helm.warp', { factor: Math.min(9, warpNow + 1) }); return;
        case 'ArrowDown': e.preventDefault(); order('helm.warp', { factor: Math.max(0, warpNow - 1) }); return;
        case 'ArrowLeft': e.preventDefault(); order('helm.heading', { delta: -5 }); return;
        case 'ArrowRight': e.preventDefault(); order('helm.heading', { delta: 5 }); return;
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, location.pathname, go, order, say, user]);

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
      <div key={location.pathname} className={`view${location.pathname === '/bridge' ? ' view--bridge' : ''}`}>
        <Routes location={location}>
          <Route path="/bridge" element={<Bridge powered={powered} aboard={aboard} viewer={viewer} onViewer={nextView} onGo={go} onLift={() => setOverlay('lift')} user={user} />} />
          {[...STATIONS.slice(1), ...PAGES].map((st) => (
            <Route key={st.id} path={`${st.path}/*`} element={<StationRoute station={st} onBack={back} />} />
          ))}
          <Route path="*" element={<Navigate to="/bridge" replace />} />
        </Routes>
      </div>
      {overlay === 'lift' && <Turbolift user={user} current={current} onGo={go} onClose={() => setOverlay(null)} />}
      {overlay === 'keys' && <ShortcutSheet onClose={() => setOverlay(null)} />}
      <div className="toast-slot" role="status" aria-live="polite">
        {toast && <div key={toast.id} className="toast" data-tone={toast.tone}>{toast.text}</div>}
      </div>
      <span className="sr-only" aria-live="assertive">{condition === 'red' ? 'Red alert' : condition === 'yellow' ? 'Yellow alert' : ''}</span>
    </div>
  );
}


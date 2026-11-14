import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { ship } from '../lib/ship.js';
import { Icon, KeyCap, LitButton, mayCommand, sendCommand, useCommand } from '../ui/index.js';

// The command a scenario waits for, as the presenter's button: label, lamp colour, key and who may press it.
const AWAIT = {
  'ship.condition': (p) => ({ label: { red: 'Red alert', yellow: 'Yellow alert', normal: 'Stand down' }[p.level] ?? 'Condition', color: p.level === 'red' ? 'red' : 'yellow', key: { red: 'R', yellow: 'Y', normal: 'N' }[p.level] }),
  'tactical.phasers': () => ({ label: 'Fire phasers', color: 'red', key: 'P' }),
  'tactical.torpedo': () => ({ label: 'Photon torpedo', color: 'red', key: '⇧P' }),
  'tactical.shields': (p) => ({ label: p.up ? 'Shields up' : 'Shields down', color: 'amber', key: '⇧S' }),
  'medical.inoculate': () => ({ label: 'Inoculate', color: 'blue' }),
  'medical.quarantine': (p) => ({ label: `Quarantine deck ${p.deck}`, color: 'blue' }),
  'engineering.coldRestart': () => ({ label: 'Cold restart', color: 'amber' }),
  'engineering.allocate': (p) => ({ label: `${p.preset ?? ''} power`, color: 'amber' }),
  'transporter.energize': () => ({ label: 'Energize', color: 'amber' }),
  'security.ventGas': (p) => ({ label: `Vent gas · deck ${p.deck}`, color: 'yellow' }),
  'comms.hail': () => ({ label: 'Hail', color: 'blue', key: 'H' }),
  'science.scan': () => ({ label: 'Scan', color: 'blue' }),
};
const WHO = { ship: 'the captain', helm: 'the captain', tactical: 'the captain', security: 'the captain', engineering: 'the chief engineer', transporter: 'the chief engineer', medical: 'the chief medical officer', comms: 'communications', science: 'the science officer' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Scenario progress across the top of the viewscreen, and the presenter's button for the command it waits for. */
export function ScenarioStrip({ user }) {
  const s = ship.scenario;
  const stop = useCommand('scenario.stop');
  const awaitType = s?.awaiting?.type;
  const act = useCommand(awaitType ?? 'none');
  const done = s && (s.state === 'ended' || s.state === 'stopped');
  const [hidden, setHidden] = useState(false);
  useEffect(() => { // an ended scenario lingers a few seconds, then the strip goes
    if (!done) { setHidden(false); return undefined; }
    const t = setTimeout(() => setHidden(true), 6000);
    return () => clearTimeout(t);
  }, [done, s?.id]);
  if (!s || hidden) return null;
  const a = s.awaiting;
  const { type, shipId, timeout, secondsLeft, ...payload } = a ?? {};
  const look = a && (AWAIT[type]?.(payload) ?? { label: type, color: 'white' });
  const canStop = mayCommand(user, 'scenario.stop') && !done;
  const pct = Math.min(100, ((s.t ?? 0) / (s.duration || 1)) * 100);
  return (
    <>
      <div className="scn" data-state={s.state}>
        <i className="scn__lamp" aria-hidden="true" />
        <span className="scn__title display">{s.title}</span>
        <span className="scn__state mono">{done ? (s.state === 'ended' ? 'COMPLETE' : 'STOPPED') : a ? 'AWAITING ORDERS' : `STEP ${Math.min(s.step + 1, s.steps)} / ${s.steps}`}</span>
        <span className="scn__bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        <span className="scn__time mono">{mmss(s.t ?? 0)} / {mmss(s.duration ?? 0)}</span>
        {canStop && <button type="button" className="scn__stop" onClick={() => stop.send({})} title="Stop the scenario and restore normal running">Stop</button>}
      </div>
      {a && (
        <div className="await" role="status">
          {mayCommand(user, type) ? (
            <LitButton color={look.color} size="lg" className="await__btn" label={look.label} keyCap={look.key} lit pending={act.pending}
              onClick={() => sendCommand(type, payload, shipId ?? 1)} />
          ) : (
            <p className="await__wait">Waiting for {WHO[type.split('.')[0]] ?? 'an officer'}: <b className="display">{look.label}</b></p>
          )}
          <span className="await__count mono" aria-label={`${secondsLeft} seconds left`}>{Math.max(0, Math.ceil(secondsLeft ?? timeout ?? 0))} s</span>
        </div>
      )}
    </>
  );
}

/** Picks one of the six episode scenarios and starts or stops it (captain and Starfleet Command). */
export function ScenarioPicker({ user, onClose }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);
  useEffect(() => { api('/api/scenarios').then((r) => setList(r.scenarios), (e) => setError(e.message)); }, []);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const running = ship.scenario && (ship.scenario.state === 'running' || ship.scenario.state === 'awaiting') ? ship.scenario : null;
  const may = mayCommand(user, 'scenario.start');
  const start = async (id) => {
    setBusy(id);
    const r = await sendCommand('scenario.start', { id });
    setBusy(null);
    if (r.ok) onClose(); else setError(r.error);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="lift scenarios" role="dialog" aria-modal="true" aria-label="Scenarios">
        <div className="lift__head">
          <Icon name="keyboard" />
          <span className="display">Scenarios</span>
          <button type="button" className="iconbtn" onClick={onClose} title="Close (Esc)"><Icon name="close" title="Close" /></button>
        </div>
        <p className="label">Six episodes of the original series, each a timed script the simulator plays. When one waits for an order, a lit button appears on every bridge.</p>
        {error && <p className="scenarios__error" role="alert">{error}</p>}
        {!list && !error && <p className="label">Loading scenarios…</p>}
        <ul className="scenarios__list">
          {list?.map((s) => {
            const on = running?.id === s.id;
            return (
              <li key={s.id} className="scenario" data-running={on || undefined}>
                <div className="scenario__head">
                  <b className="display">{s.title}</b>
                  <span className="mono label" style={{ whiteSpace: 'nowrap' }}>{s.episode} · {s.duration} s</span>
                </div>
                <p className="scenario__summary">{s.summary}</p>
                {s.shows && <p className="label">Shows: {Array.isArray(s.shows) ? s.shows.join(', ') : s.shows}</p>}
                <div className="scenario__act">
                  {on ? (
                    <LitButton color="red" size="sm" label="Stop" disabled={!may} onClick={() => sendCommand('scenario.stop', {})} />
                  ) : (
                    <LitButton color="green" size="sm" label={busy === s.id ? 'Starting' : 'Start'} pending={busy === s.id} disabled={!may || !!running || !!busy}
                      title={running ? 'One scenario at a time' : undefined} onClick={() => start(s.id)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!may && <p className="label">Only the captain and Starfleet Command start scenarios.</p>}
        <p className="label scenarios__keys"><KeyCap>Esc</KeyCap> closes</p>
      </div>
    </div>
  );
}

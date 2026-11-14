import { useEffect, useRef, useState } from 'react';
import { DivisionPill, Icon, KeyCap } from '../ui/index.js';
import { PAGES, STATIONS, canEnter } from './stations.js';

function useDialog(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return ref;
}

/** The turbolift: station picker on Ctrl+K. Arrow keys and Enter, or type to filter. */
export function Turbolift({ user, current, onGo, onClose }) {
  const ref = useDialog(onClose);
  const [q, setQ] = useState('');
  const all = [...STATIONS, ...PAGES];
  const list = all.filter((s) => s.label.toLowerCase().includes(q.toLowerCase()));
  const [sel, setSel] = useState(() => Math.max(0, list.findIndex((s) => s.id === current)));
  const pick = (st) => { if (st) onGo(st); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % Math.max(1, list.length)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + list.length) % Math.max(1, list.length)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(list[sel]); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="lift" role="dialog" aria-modal="true" aria-label="Turbolift: choose a station">
        <div className="lift__head">
          <Icon name="lift" />
          <span className="display">Turbolift</span>
          <KeyCap>Ctrl K</KeyCap>
          <button type="button" className="iconbtn" onClick={onClose} title="Close (Esc)"><Icon name="close" title="Close" /></button>
        </div>
        <input data-autofocus className="field" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
          placeholder="Deck or station" aria-label="Filter stations" aria-controls="lift-list" />
        <ul id="lift-list" className="lift__list" role="listbox" aria-label="Stations">
          {list.map((st, i) => {
            const locked = !canEnter(user, st) && !PAGES.includes(st);
            return (
              <li key={st.id} role="option" aria-selected={i === sel} className="lift__item" data-active={st.id === current || undefined}
                onMouseEnter={() => setSel(i)} onClick={() => pick(st)}>
                <DivisionPill division={st.division} />
                <span className="lift__name">{st.label}</span>
                {locked && <span className="lift__lock"><Icon name="lock" />{st.who}</span>}
                {st.key && <KeyCap>G {st.key.toUpperCase()}</KeyCap>}
              </li>
            );
          })}
          {!list.length && <li className="lift__empty">No station by that name.</li>}
        </ul>
      </div>
    </div>
  );
}

const KEYS = [
  ['0 – 9', 'Set warp factor; 0 drops to impulse', 'Captain'],
  ['↑ ↓', 'Warp factor up or down by one', 'Captain'],
  ['I', 'Full impulse', 'Captain'],
  ['X', 'All stop', 'Captain'],
  ['← →', 'Heading 5° to port or starboard', 'Captain'],
  ['Shift S', 'Shields up or down', 'Captain'],
  ['P', 'Fire phasers at the locked contact', 'Captain'],
  ['Shift P', 'Fire a photon torpedo', 'Captain'],
  ['R', 'Red alert', 'Captain'],
  ['Y', 'Yellow alert', 'Captain'],
  ['N', 'Stand down to normal', 'Captain'],
  ['H', 'Open or close hailing frequencies', 'Captain, communications'],
  ['V', 'Next viewscreen mode', 'Everyone'],
  ['+ −', 'Viewscreen magnification', 'Everyone'],
  ['G then B H E S C M F', 'Go to Bridge, Helm, Engineering, Science, Comms, Sickbay, Starfleet', 'Everyone'],
  ['Ctrl K', 'Turbolift: station picker', 'Everyone'],
  ['A', 'Acknowledge the newest alert', 'Roles that can see it'],
  ['M', 'Sound on or off', 'Everyone'],
  ['?', 'This sheet', 'Everyone'],
  ['Esc', 'Close a panel, or back to the bridge', 'Everyone'],
];

export function ShortcutSheet({ onClose }) {
  const ref = useDialog(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="lift__head">
          <Icon name="keyboard" />
          <span className="display">At the helm</span>
          <button type="button" data-autofocus className="iconbtn" onClick={onClose} title="Close (Esc)"><Icon name="close" title="Close" /></button>
        </div>
        <table className="keys">
          <tbody>
            {KEYS.map(([k, what, who]) => (
              <tr key={k}><td>{k.split(' ').map((x, i) => <KeyCap key={i}>{x}</KeyCap>)}</td><td>{what}</td><td className="label">{who}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="label sheet__foot">Shortcuts are ignored while you type in a field. Commands go to the server, which checks your role.</p>
      </div>
    </div>
  );
}

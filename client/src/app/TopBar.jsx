import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { DivisionPill, Delta, Icon, KeyCap, LitButton, ROLE_EMBLEM, play, toggleSound, useCommand, useSound } from '../ui/index.js';
import { stardate } from '../lib/ship.js';
import { state } from '../lib/store.js';
import { PAGES, STATIONS, canEnter } from './stations.js';

const WORD = { normal: 'Normal', yellow: 'Yellow alert', red: 'Red alert' };
const SHORT = { normal: 'Normal', yellow: 'Yellow', red: 'Red' }; // narrower desktops: the lamp colour says "alert
const ROLE_DIVISION = { captain: 'command', chief_engineer: 'ops', communications_officer: 'ops', science_officer: 'science', chief_medical_officer: 'science', starfleet_command: 'fleet' };
export const divisionOfRole = (role) => ROLE_DIVISION[role] ?? 'fleet';

// NORMAL, YELLOW ALERT or RED ALERT as a lit sign. The captain can open it to change condition.
function ConditionLamp({ condition, captain, standDown }) {
  const [open, setOpen] = useState(false);
  const cmd = useCommand('ship.condition');
  const order = (level) => { cmd.send({ level }); setOpen(false); };
  const word = standDown ? 'Condition normal' : WORD[condition];
  return (
    <div className="cond" data-level={standDown ? 'standdown' : condition}>
      <button type="button" className="cond__btn" onClick={() => captain && setOpen((o) => !o)} aria-expanded={captain ? open : undefined}
        aria-haspopup={captain ? 'true' : undefined} disabled={!captain} aria-label={word} title={captain ? 'Change condition' : 'Ship condition, set by the captain'}>
        <i className="cond__lamp" aria-hidden="true" />
        <span className="cond__word">
          <span className="cond__long" aria-hidden="true">{word}</span>
          <span className="cond__short" aria-hidden="true">{standDown ? 'Normal' : SHORT[condition]}</span>
        </span>
      </button>
      {open && (
        <div className="cond__menu" role="menu">
          <LitButton color="red" label="Red alert" keyCap="R" lit={condition === 'red'} pending={cmd.pending} onClick={() => order('red')} role="menuitem" />
          <LitButton color="yellow" label="Yellow alert" keyCap="Y" lit={condition === 'yellow'} onClick={() => order('yellow')} role="menuitem" />
          <LitButton color="green" label="Stand down" keyCap="N" lit={condition === 'normal'} onClick={() => order('normal')} role="menuitem" />
        </div>
      )}
    </div>
  );
}

// HELP: the tour, the shortcut sheet and the turbolift, which otherwise open only from the keyboard or on a first visit.
function Help({ onTour, onKeys, onLift }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    box.current?.querySelector('[role="menuitem"]')?.focus();
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector('button')?.focus(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={box} className="help" data-tour="help">
      <button type="button" className="tb-plate" aria-label="Help" aria-haspopup="menu" aria-expanded={open} title="Tour, keyboard shortcuts and turbolift"
        onClick={() => { play('press'); setOpen((o) => !o); }}>
        <span className="tb-plate__word">Help</span>
        <KeyCap>?</KeyCap>
      </button>
      {open && (
        <div className="help__menu" role="menu" aria-label="Help">
          <LitButton role="menuitem" color="blue" label="Replay the tour" onClick={pick(onTour)} />
          <LitButton role="menuitem" color="white" label="Keyboard shortcuts" keyCap="?" onClick={pick(onKeys)} />
          <LitButton role="menuitem" color="white" label="Turbolift" keyCap="Ctrl K" onClick={pick(onLift)} />
        </div>
      )}
    </div>
  );
}

export function TopBar({ user, condition, standDown, onLift, onKeys, onTour, onSignOut }) {
  const sound = useSound();
  const online = state.status === 'online';
  const rx = state.rx;
  // who may use a locked station, under its tab on hover and on keyboard focus (a title shows on hover only)
  const [hint, setHint] = useState(null);
  const showHint = (st) => (e) => { const r = e.currentTarget.getBoundingClientRect(); setHint({ text: st.who, x: r.left + r.width / 2 }); };
  const hideHint = () => setHint(null);
  return (
    <header className="topbar">
      <NavLink to="/bridge" className="wordmark" aria-label="Subspace, go to the bridge">
        <Delta emblem="command" />
        <span><b>NCC-1701</b><small>U.S.S. Enterprise</small></span>
      </NavLink>
      <nav className="tabs" aria-label="Stations" data-tour="lift">
        {[...STATIONS, ...PAGES].map((st) => {
          const locked = !canEnter(user, st);
          return (
            <NavLink key={st.id} to={st.path} className="tab" data-division={st.division} data-locked={locked || undefined} aria-label={locked ? `${st.label}, restricted: ${st.who}` : st.label}
              title={locked ? undefined : st.key ? `${st.label} (G then ${st.key.toUpperCase()})` : st.label}
              {...(locked && { onMouseEnter: showHint(st), onFocus: showHint(st), onMouseLeave: hideHint, onBlur: hideHint })}>
              <DivisionPill division={st.division} />
              <span className="tab__long">{st.label}</span>
              <span className="tab__short">{st.short}</span>
              {locked && <Icon name="lock" className="tab__lock" title="Restricted" />}
            </NavLink>
          );
        })}
      </nav>
      {hint && <div className="tab-hint" aria-hidden="true" style={{ left: hint.x }}>{hint.text}</div>}
      <div className="topbar__right">
        <ConditionLamp condition={condition} captain={user.role === 'captain'} standDown={standDown} />
        <div className="stat stat--date">
          <span className="label">Stardate</span>
          <b className="mono">{stardate().toFixed(1)}</b>
        </div>
        <div className="stat stat--rate" title="Readings the server accepted in the last second">
          <span className="label"><i className={`live-dot${online ? ' on' : ''}`} aria-hidden="true" />{online ? 'Live' : state.status === 'connecting' ? 'Connecting' : 'Offline'}</span>
          <b className="mono">{rx == null ? '—' : rx.toLocaleString('en-US')}<small> rd/s</small></b>
        </div>
        <Help onTour={onTour} onKeys={onKeys} onLift={onLift} />
        <button type="button" className="iconbtn" onClick={toggleSound} aria-pressed={sound} title={sound ? 'Sound on (M)' : 'Sound off (M)'}>
          <Icon name={sound ? 'soundOn' : 'soundOff'} title={sound ? 'Sound on' : 'Sound off'} />
          <KeyCap>M</KeyCap>
        </button>
        <div className="user" data-division={divisionOfRole(user.role)} title={`${user.label} (${user.username})`}>
          <Delta emblem={ROLE_EMBLEM[user.role] ?? 'fleet'} className="delta delta--sm" />
          <span className="user__who"><b>{user.label}</b><small className="mono">{user.username}</small></span>
          <button type="button" className="iconbtn" onClick={onSignOut} title="Sign out"><Icon name="signOut" title="Sign out" /></button>
        </div>
        <button type="button" className="iconbtn tabs-menu" onClick={onLift} title="Stations (Ctrl K)" data-tour="lift"><Icon name="menu" title="Stations" /></button>
      </div>
    </header>
  );
}

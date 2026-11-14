import { Component, lazy, Suspense, useEffect } from 'react';
import { CHANNEL_BY_KEY, GROUPS, GROUP_CHANNELS } from '@ncc/shared/schema.js';
import { useAuth } from '../lib/auth.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { bandOf, levelOf } from '../lib/limits.js';
import { backfill, getRing } from '../lib/store.js';
import { Delta, Icon, Jewel, LitButton, Monitor, Readout, StationLayout } from '../ui/index.js';
import { STATIONS, PAGES, canEnter, screenOf } from './stations.js';

// one lazy component per station file that exists (client/src/stations/<Name>.jsx)
const SCREENS = Object.fromEntries([...STATIONS, ...PAGES].filter((s) => s.screen && screenOf(s.screen)).map((s) => [s.id, lazy(screenOf(s.screen))]));

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="station-msg"><Jewel status="crit" label="Station fault" /><b className="display">Station fault</b><span>{this.state.error.message}</span></div>;
  }
}

/** A station the role may not use: the lock, who may, and the way back. The server refuses its data anyway. */
function Restricted({ station, onBack }) {
  return (
    <div className="restricted">
      <div className="restricted__panel">
        <Icon name="lock" className="restricted__lock" />
        <h1 className="display">{station.label}: restricted</h1>
        <p>{station.who}.</p>
        <p className="label">Your role does not open this station. The server checks the same rule on every request.</p>
        <LitButton color="white" label="Back to the bridge" keyCap="Esc" onClick={onBack} />
      </div>
    </div>
  );
}

// Until the station's own screen lands: monitors for each group the station shows, built from the registry.
const PLACEHOLDER_GROUPS = {
  helm: ['helm', 'shields', 'weapons'],
  engineering: ['warp', 'impulse', 'power', 'hull'],
  science: ['sensors', 'transporter'],
  comms: ['comms'],
  sickbay: ['crewsummary'],
  fleet: [],
  history: [],
  alerts: [],
};
function GroupMonitor({ group, index }) {
  useTick();
  const ring = getRing(1, group);
  const keys = GROUP_CHANNELS[group].slice(0, 6);
  return (
    <Monitor title={group} index={index} status="ok" style={{ gridColumn: 'span 6' }} state={ring ? 'live' : 'off'}>
      <div className="placeholder-grid">
        {keys.map((k) => {
          const c = CHANNEL_BY_KEY[k];
          const v = ring?.last(k);
          return <Readout key={k} size="sm" label={c.label} unit={c.unit} value={v} dec={Math.min(2, Math.round(Math.log10(c.scale)))} status={levelOf(k, v)} spark={ring?.window(60_000, [k])} band={bandOf(k)} />;
        })}
      </div>
    </Monitor>
  );
}
function Placeholder({ station }) {
  const { user } = useAuth();
  const groups = (PLACEHOLDER_GROUPS[station.id] ?? []).filter((g) => GROUPS.includes(g) && user.groups.includes(g));
  const ready = useSubscription(groups.length ? [1] : [], groups);
  useEffect(() => { if (ready) backfill(1, groups).catch(() => {}); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <StationLayout seed={station.id.length} jewels={groups.map((g) => ({ label: g, status: 'ok' }))}
      console={<span className="label">The {station.label.toLowerCase()} console arrives with the station screens.</span>}>
      {groups.length ? groups.map((g, i) => <GroupMonitor key={g} group={g} index={i} />) : (
        <Monitor title={station.label} style={{ gridColumn: '1 / -1' }} state="off" />
      )}
    </StationLayout>
  );
}

export default function StationRoute({ station, onBack }) {
  const { user } = useAuth();
  if (!PAGES.includes(station) && !canEnter(user, station)) return <Restricted station={station} onBack={onBack} />;
  const Screen = SCREENS[station.id];
  if (!Screen) return <Placeholder station={station} />;
  return (
    <Boundary>
      <Suspense fallback={<div className="station-msg"><Delta emblem="command" /><span className="display">Powering up {station.label}</span></div>}>
        <Screen station={station} />
      </Suspense>
    </Boundary>
  );
}

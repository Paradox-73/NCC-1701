import { Component, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Delta, Icon, Jewel, LitButton } from '../ui/index.js';
import { STATIONS, PAGES, canEnter, screenOf } from './stations.js';
import Tour from './Tour.jsx';
import { STATION_TOURS } from './tours.js';

// one lazy component per station file (client/src/stations/<Name>.jsx)
const SCREENS = Object.fromEntries([...STATIONS, ...PAGES].filter((s) => s.screen).map((s) => [s.id, lazy(screenOf(s.screen))]));

// a station file that failed to load (a tab left open across a redeploy) or a screen that crashed
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="station-msg"><Jewel status="crit" label="Station fault" /><b className="display">This station failed to load</b><LitButton color="white" label="Reload" onClick={() => location.reload()} /></div>;
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

/**
 * A station screen, or its restricted panel. `?ship=N` (a Starfleet ship card opens /history?ship=N) shows ship N of the
 * task force instead of the Enterprise, when the role sees that ship; another ship remounts the screen, so it starts over.
 */
export default function StationRoute({ station, onBack }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (!PAGES.includes(station) && !canEnter(user, station)) return <Restricted station={station} onBack={onBack} />;
  const Screen = SCREENS[station.id];
  const ship = Number(params.get('ship'));
  const shipId = user.ships?.includes(ship) ? ship : undefined;
  return (
    <Boundary>
      <Suspense fallback={<div className="station-msg"><Delta emblem="command" /><span className="display">Powering up {station.label}</span></div>}>
        <Screen key={shipId ?? 'own'} station={station} {...(shipId && { shipId })} />
        {STATION_TOURS[station.id] && <Tour key={station.id} steps={STATION_TOURS[station.id]} storageKey={`ncc.toured.${station.id}`} delay={900} />}
      </Suspense>
    </Boundary>
  );
}

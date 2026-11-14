import { useEffect, useMemo, useState } from 'react';
import { CHANNELS, GROUP_DEFS, GROUP_CHANNELS } from '@ncc/shared/schema.js';
import Chart from '../components/Chart.jsx';
import VirtualList from '../components/VirtualList.jsx';
import { useAuth } from '../lib/auth.jsx';
import { SERIES } from '../lib/chartTheme.js';
import { useSources } from '../lib/context.jsx';
import { useSubscription, useTick } from '../lib/hooks.js';
import { ackAlert, backfill, getRing, state, stats } from '../lib/store.js';

// PLACEHOLDER page: proves live data flows from a source through the server to the browser. Pick a source and a
// group; the latest values, one chart and the alert list all come from the registry, not from hard-coded names.
export default function Live() {
  const { user, logout } = useAuth();
  const { sources, error, loading } = useSources();
  const [sourceId, setSourceId] = useState(1);
  const groups = user.groups; // the groups this role may see, from the registry
  const [group, setGroup] = useState(groups[0]);
  useTick(); // re-render four times a second; the data itself lives in ring buffers
  const ready = useSubscription([sourceId], [group]);
  useEffect(() => { if (ready) backfill(sourceId, [group]).catch(() => {}); }, [ready, sourceId, group]);

  const ring = getRing(sourceId, group);
  const keys = GROUP_CHANNELS[group];
  const first = CHANNELS.find((c) => c.key === keys[0]);
  const series = useMemo(() => [{ label: first.label, color: SERIES[0], unit: first.unit, dec: 1 }], [first]);
  const getData = () => ring?.window(60_000, [first.key]) ?? null;
  const alerts = state.alerts.filter((a) => a.sourceId === sourceId);

  return (
    <main>
      <p>
        {user.username} ({user.label}) · server {state.status} · {stats.framesPerSec} frames/s · {state.rx ?? 0} readings/s{' '}
        <button onClick={() => logout()}>Sign out</button>
      </p>
      {loading && <p>Loading sources…</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        {sources.map((s) => {
          const live = state.overview.get(s.sourceId);
          return (
            <button key={s.sourceId} onClick={() => setSourceId(s.sourceId)} aria-pressed={s.sourceId === sourceId}>
              {s.code} {live?.flags & 1 ? '●' : '○'}{live?.flags & 4 ? ' critical' : live?.flags & 2 ? ' warning' : ''}
            </button>
          );
        })}
      </p>
      <p>
        {GROUP_DEFS.filter((g) => groups.includes(g.key)).map((g) => (
          <button key={g.key} onClick={() => setGroup(g.key)} aria-pressed={g.key === group}>{g.label}</button>
        ))}
      </p>
      <table>
        <tbody>
          {keys.map((k) => {
            const c = CHANNELS.find((x) => x.key === k);
            const v = ring?.last(k);
            return <tr key={k}><th>{c.label}</th><td className="mono">{v === undefined ? '–' : v.toFixed(Math.log10(c.scale) | 0)} {c.unit}</td></tr>;
          })}
        </tbody>
      </table>
      <Chart key={`${sourceId}:${group}`} series={series} getData={getData} x="time" height={180} title={`${first.label}, last minute`} />
      <h2>Alerts for this source</h2>
      <VirtualList
        items={alerts}
        rowHeight={28}
        label="Alerts"
        style={{ height: 140 }}
        empty={<p>No alerts.</p>}
        renderRow={(a) => (
          <div className="mono">
            {new Date(a.ts).toLocaleTimeString([], { hour12: false })} {a.severity} · {a.message}{' '}
            {a.ack ? `(acknowledged by ${a.ack.by})` : user.canAck && <button onClick={() => ackAlert(a.id)}>Acknowledge</button>}
          </div>
        )}
      />
    </main>
  );
}

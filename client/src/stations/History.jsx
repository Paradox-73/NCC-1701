import { useState } from 'react';
import { CHANNEL_BY_KEY, GROUP_CHANNELS, GROUP_DEFS, SOURCES, canSeeSource, kindOf } from '@ncc/shared/schema.js';
import Chart from '../components/Chart.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTick } from '../lib/hooks.js';
import { canSee, levelOf, monState, shipCode } from './parts/data.js';
import { useHistory, useHistoryData } from './parts/history.js';
import { ConsoleStrip, Headline, J, LitButton, Monitor, Readings, Station } from '../ui/index.js';
import { C, calmRange, decOf, fmt } from './parts/ui.jsx';

const RANGES = [['1 min', 60], ['5 min', 300], ['15 min', 900], ['1 hour', 3600]];

/** History merged with live (docs/PROTOCOL.md): stored samples from MongoDB, then the live stream, joined by sequence number. */
export default function History({ shipId = 1 }) {
  useTick();
  const { user } = useAuth();
  const sources = SOURCES.filter((s) => canSeeSource(user?.role, s.id));
  const [src, setSrc] = useState(sources.some((s) => s.id === shipId) ? shipId : sources[0]?.id);
  const source = SOURCES.find((s) => s.id === src);
  const groups = GROUP_DEFS.filter((g) => canSee(user, g.key) && (!g.kind || g.kind === kindOf(src)) && GROUP_CHANNELS[g.key]?.length);
  const first = groups.find((g) => g.key === 'warp') ?? groups.find((g) => g.key === 'helm') ?? groups[0];
  const [channel, setChannel] = useState(GROUP_CHANNELS[first?.key]?.includes('reactionRate') ? 'reactionRate' : GROUP_CHANNELS[first?.key]?.[0]);
  const ch = CHANNEL_BY_KEY[channel] && groups.some((g) => g.key === CHANNEL_BY_KEY[channel].group) ? channel : GROUP_CHANNELS[first?.key]?.[0];
  const [range, setRange] = useState(300);
  const m = CHANNEL_BY_KEY[ch];
  const { data, meta } = useHistory(src, ch, range, !!m);
  const getData = useHistoryData(data, [src, ch, range]);
  const d = data.current;
  const last = d.ys.length ? d.ys[d.ys.length - 1] : undefined;
  const level = m ? levelOf(ch, last) : null;
  const state = m ? monState(user, src, [m.group]) : 'restricted';
  const firstLive = d.seqs.find((q) => q > d.joinSeq);
  const desk = (
    <ConsoleStrip seed={71} jewels={[J('STORED', meta.status === 'error' ? 'crit' : null, meta.status === 'ready' ? 'live' : 'off'), J('LIVE', null, meta.live ? 'live' : 'off')]}>
      {RANGES.map(([l, v]) => <LitButton key={v} color="white" label={l} pressed={range === v} onClick={() => setRange(v)} />)}
    </ConsoleStrip>
  );
  if (!source || !groups.length) {
    return <Station name="History" division="fleet" ship={null} desk={desk}><Monitor title="History" state="restricted" className="st-c12" style={{ '--mh': '240px' }} restricted="Your role sees no channels." /></Station>;
  }

  // The 1966 set (DESIGN.md): the channel picker and the current reading on top, the chart below. The merge numbers
  // (stored, last stored and first live sequence, overlap dropped, refilled after a reconnect) are the second page of the reading monitor.
  const merge = [
    { label: 'Stored', value: fmt(meta.count, 0), unit: meta.downsampled ? 'thinned' : undefined }, { label: 'Last stored', value: d.joinSeq ? fmt(d.joinSeq, 0) : '—' },
    { label: 'First live', value: firstLive ? fmt(firstLive, 0) : '—' }, { label: 'Live since', value: fmt(meta.live, 0) },
    { label: 'Dropped', value: fmt(meta.dropped, 0) }, { label: 'Refilled', value: fmt(meta.filled, 0) },
  ];
  return (
    <Station name="History" division="fleet" ship={kindOf(src) === 'ship' ? src : null} rows="minmax(200px, auto) minmax(320px, 1fr)" desk={desk}
      end={kindOf(src) === 'ship' ? undefined : `${shipCode(src)} · ${source.name}`}>
      <Monitor title="Channel" meta="source · reading · range" className="st-c8" index={0}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 18px', alignItems: 'center', alignContent: 'center', height: '100%', padding: '10px 14px' }}>
          <label className="st-label st-field">Source
            <select className="st-select" value={src} onChange={(e) => setSrc(Number(e.target.value))}>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </label>
          <label className="st-label st-field">Reading
            <select className="st-select" value={ch} onChange={(e) => setChannel(e.target.value)}>
              {groups.map((g) => <optgroup key={g.key} label={g.label}>{GROUP_CHANNELS[g.key].map((k) => <option key={k} value={k}>{CHANNEL_BY_KEY[k].label}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="st-seg-ctl" role="radiogroup" aria-label="Time range">
            {RANGES.map(([l, v]) => <button key={v} type="button" role="radio" aria-checked={range === v} onClick={() => setRange(v)}>{l.toUpperCase()}</button>)}
          </div>
        </div>
      </Monitor>
      <Monitor title="Now" status={level ?? 'ok'} state={state} className="st-c4" index={1}
        views={[
          { label: 'Now', content: <Headline value={last} unit={m?.unit} dec={m ? decOf(ch) : 0} level={level} /> },
          { label: 'Merge', content: <Readings items={merge} /> },
        ]} />
      <Monitor title={m ? `${m.label}${m.unit ? ` (${m.unit})` : ''}` : 'Reading'} meta="grey stored · blue live" state={state} className="st-c12" index={2} data-tour="history-chart">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px 10px' }}>
          <Chart key={`${src}-${ch}-${range}`} fill x="time" unit={m?.unit} getData={getData} yRange={calmRange(ch)} wait={meta.status === 'error' ? 'Waiting for live readings' : 'Loading stored readings'}
            series={[{ label: 'Stored', color: C.mute, dec: decOf(ch), unit: m?.unit }, { label: 'Live', color: C.chart1, dec: decOf(ch), unit: m?.unit }]} />
          {meta.status === 'error' && <p className="st-label" role="status" style={{ margin: '6px 0 0' }}>Stored readings unavailable ({meta.error}); the chart shows the live stream only.</p>}
        </div>
      </Monitor>
    </Station>
  );
}

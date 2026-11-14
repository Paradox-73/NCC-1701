import { useState } from 'react';
import ViewscreenView from '../ViewscreenView.jsx';

// Test page for the viewscreen: scene, warp, alert, a hit button (static + shake for 600 ms) and a
// "jump to warp" button that eases from impulse to warp 8.

const css = {
  page: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gridTemplateRows: '100vh', height: '100vh', background: '#04060c', color: '#d8dee9', font: '13px/1.4 system-ui, sans-serif' },
  stage: { padding: 24, display: 'grid', placeItems: 'center', minWidth: 0 },
  screen: { width: '100%', maxWidth: 1100, aspectRatio: '16 / 9' },
  panel: { padding: 16, overflowY: 'auto', borderLeft: '1px solid #1c2333', background: '#0a0e17' },
  h: { margin: '14px 0 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#8a93a6' },
  row: { display: 'grid', gridTemplateColumns: '60px 1fr 34px', alignItems: 'center', gap: 8, margin: '4px 0' },
  btn: { margin: '4px 6px 0 0', padding: '5px 10px', background: '#151c2b', color: '#d8dee9', border: '1px solid #2a3449', borderRadius: 6, cursor: 'pointer' },
};

function Choice({ options, value, onChange }) {
  return options.map((o) => (
    <button key={o} style={{ ...css.btn, borderColor: value === o ? '#6cc6ff' : '#2a3449' }} onClick={() => onChange(o)}>{o}</button>
  ));
}

export default function ViewscreenDemo() {
  const q = new URLSearchParams(location.search);
  const [mode3d, setMode3d] = useState(q.get('view') || 'auto');
  const [mode, setMode] = useState(q.get('mode') || 'space');
  const [warp, setWarp] = useState(Number(q.get('warp') ?? 1));
  const [alert, setAlert] = useState(q.get('alert') || 'green');
  const [hit, setHit] = useState(false);

  const doHit = () => {
    setHit(true);
    setTimeout(() => setHit(false), 600);
  };

  return (
    <div style={css.page}>
      <div style={css.stage}>
        <div style={css.screen}>
          <ViewscreenView mode3d={mode3d} mode={mode} warp={warp} alert={alert} hit={hit} />
        </div>
      </div>
      <aside style={css.panel}>
        <div style={css.h}>View</div>
        <Choice options={['auto', '3d', '2d']} value={mode3d} onChange={setMode3d} />
        <div style={css.h}>Scene</div>
        <Choice options={['space', 'orbit', 'tactical']} value={mode} onChange={setMode} />
        <div style={css.h}>Alert</div>
        <Choice options={['green', 'yellow', 'red']} value={alert} onChange={setAlert} />
        <div style={css.h}>Warp</div>
        <label style={css.row}>
          <span>warp</span>
          <input type="range" style={{ width: '100%', minWidth: 0 }} min={0} max={9} step={0.1} value={warp} onChange={(e) => setWarp(Number(e.target.value))} />
          <span style={{ textAlign: 'right' }}>{warp}</span>
        </label>
        <button style={css.btn} onClick={() => setWarp(0)}>full stop</button>
        <button style={css.btn} onClick={() => setWarp(8)}>jump to warp 8</button>
        <div style={css.h}>Battle</div>
        <button style={css.btn} onClick={doHit}>take a hit</button>
      </aside>
    </div>
  );
}

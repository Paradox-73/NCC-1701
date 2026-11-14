import { useState } from 'react';
import StarshipView from '../StarshipView.jsx';

// Test page for the ship: every prop on a slider, plus buttons for the things that are easier to see
// as an event (a shield hit, everything at once).

const SHIELD_KEYS = ['fore', 'aft', 'port', 'starboard'];
const DAMAGE_KEYS = ['saucer', 'engineering', 'portNacelle', 'starboardNacelle'];

const css = {
  page: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gridTemplateRows: '100vh', height: '100vh', margin: 0, background: '#04060c', color: '#d8dee9', font: '13px/1.4 system-ui, sans-serif' },
  panel: { padding: 16, overflowY: 'auto', borderLeft: '1px solid #1c2333', background: '#0a0e17' },
  h: { margin: '14px 0 6px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#8a93a6' },
  row: { display: 'grid', gridTemplateColumns: '92px 1fr 34px', alignItems: 'center', gap: 8, margin: '4px 0' },
  btn: { margin: '4px 6px 0 0', padding: '5px 10px', background: '#151c2b', color: '#d8dee9', border: '1px solid #2a3449', borderRadius: 6, cursor: 'pointer' },
};

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <label style={css.row}>
      <span>{label}</span>
      <input type="range" style={{ width: '100%', minWidth: 0 }} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </label>
  );
}

export default function StarshipDemo() {
  const [warp, setWarp] = useState(3);
  const [alert, setAlert] = useState('green');
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('mode') || 'auto');
  const [shields, setShields] = useState({ fore: 100, aft: 100, port: 100, starboard: 100 });
  const [damage, setDamage] = useState({ saucer: 0, engineering: 0, portNacelle: 0, starboardNacelle: 0 });

  const hit = (k) => setShields((s) => ({ ...s, [k]: Math.max(0, s[k] - 15) }));
  const battle = () => {
    setAlert('red');
    setWarp(6);
    setShields({ fore: 40, aft: 85, port: 22, starboard: 70 });
    setDamage({ saucer: 0.2, engineering: 0.1, portNacelle: 0.8, starboardNacelle: 0 });
  };
  const reset = () => {
    setAlert('green');
    setWarp(3);
    setShields({ fore: 100, aft: 100, port: 100, starboard: 100 });
    setDamage({ saucer: 0, engineering: 0, portNacelle: 0, starboardNacelle: 0 });
  };

  return (
    <div style={css.page}>
      <StarshipView mode={mode} warp={warp} alert={alert} shields={shields} damage={damage} />
      <aside style={css.panel}>
        <div style={css.h}>View</div>
        {['auto', '3d', '2d'].map((m) => (
          <button key={m} style={{ ...css.btn, borderColor: mode === m ? '#6cc6ff' : '#2a3449' }} onClick={() => setMode(m)}>{m}</button>
        ))}

        <div style={css.h}>Alert</div>
        {['green', 'yellow', 'red'].map((a) => (
          <button key={a} style={{ ...css.btn, borderColor: alert === a ? '#6cc6ff' : '#2a3449' }} onClick={() => setAlert(a)}>{a}</button>
        ))}

        <div style={css.h}>Warp</div>
        <Slider label="warp" value={warp} min={0} max={9} step={0.1} onChange={setWarp} />

        <div style={css.h}>Shields</div>
        {SHIELD_KEYS.map((k) => (
          <Slider key={k} label={k} value={shields[k]} min={0} max={100} step={1} onChange={(v) => setShields((s) => ({ ...s, [k]: v }))} />
        ))}
        {SHIELD_KEYS.map((k) => (
          <button key={k} style={css.btn} onClick={() => hit(k)}>hit {k}</button>
        ))}

        <div style={css.h}>Damage</div>
        {DAMAGE_KEYS.map((k) => (
          <Slider key={k} label={k} value={damage[k]} min={0} max={1} step={0.05} onChange={(v) => setDamage((d) => ({ ...d, [k]: v }))} />
        ))}

        <div style={css.h}>Presets</div>
        <button style={css.btn} onClick={battle}>battle</button>
        <button style={css.btn} onClick={reset}>reset</button>
      </aside>
    </div>
  );
}

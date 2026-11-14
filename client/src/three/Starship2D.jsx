// Flat top-down ship for when 3D is off (no WebGL, reduced motion, or while the 3D chunk loads).
// Same props as the 3D model, drawn as SVG, no animation loop.

const HULL = [201, 204, 211];
const HURT = [179, 38, 30];
const ALERT = { green: '#3fae6a', yellow: '#e0b23a', red: '#e04a3a' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const tint = (d) => {
  const k = clamp(d ?? 0, 0, 1) * 0.85;
  return `rgb(${HULL.map((c, i) => Math.round(c + (HURT[i] - c) * k)).join(',')})`;
};

// Quarter arcs of an ellipse around the ship (fore is up on screen, port is left).
function arc(start, end) {
  const rx = 92, ry = 150, cx = 100, cy = 160;
  const p = (a) => `${cx + rx * Math.cos(a)} ${cy + ry * Math.sin(a)}`;
  return `M ${p(start)} A ${rx} ${ry} 0 0 1 ${p(end)}`;
}
const Q = Math.PI / 4;
const ARCS = {
  fore: arc(-3 * Q, -Q),
  starboard: arc(-Q, Q),
  aft: arc(Q, 3 * Q),
  port: arc(3 * Q, 5 * Q),
};

export default function Starship2D({ warp = 0, shields, damage, alert = 'green', className, style }) {
  const w = clamp(warp, 0, 9) / 9;
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#04060c', ...style }}>
      <svg viewBox="0 0 200 320" style={{ position: 'absolute', inset: '4%', width: '92%', height: '92%' }} role="img" aria-label={`Ship status, ${alert} alert, warp ${clamp(warp, 0, 9).toFixed(1)}`}>
        <rect x="2" y="2" width="196" height="316" rx="10" fill="none" stroke={ALERT[alert] ?? ALERT.green} strokeOpacity="0.5" />
        {Object.entries(ARCS).map(([k, d]) => {
          const v = clamp(shields?.[k] ?? 100, 0, 100);
          return <path key={k} d={d} fill="none" stroke={v < 30 ? '#ff6b5a' : '#6cc6ff'} strokeWidth="3" strokeOpacity={0.15 + (v / 100) * 0.7} strokeLinecap="round" />;
        })}
        {/* pylons */}
        <path d="M100 205 L62 238 M100 205 L138 238" stroke={tint(damage?.engineering)} strokeWidth="5" />
        {/* nacelles: port on the left, starboard on the right */}
        <rect x="52" y="200" width="20" height="100" rx="9" fill={tint(damage?.portNacelle)} />
        <rect x="128" y="200" width="20" height="100" rx="9" fill={tint(damage?.starboardNacelle)} />
        <circle cx="62" cy="204" r="8" fill="#ff5a2a" fillOpacity={0.25 + 0.75 * w} />
        <circle cx="138" cy="204" r="8" fill="#ff5a2a" fillOpacity={0.25 + 0.75 * w} />
        {/* engineering hull + neck */}
        <rect x="94" y="120" width="12" height="50" fill={tint(damage?.engineering)} />
        <ellipse cx="100" cy="205" rx="16" ry="58" fill={tint(damage?.engineering)} />
        <circle cx="100" cy="150" r="6" fill="#ffae42" fillOpacity={0.5 + 0.5 * w} />
        {/* saucer */}
        <circle cx="100" cy="82" r="62" fill={tint(damage?.saucer)} />
        <circle cx="100" cy="82" r="10" fill="#9aa0aa" />
      </svg>
    </div>
  );
}

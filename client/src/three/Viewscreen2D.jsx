import { useMemo } from 'react';
import { ViewscreenOverlay } from './ViewscreenOverlay.jsx';

// Flat viewscreen for no WebGL / reduced motion / while the 3D chunk loads. Same props as Viewscreen.jsx,
// drawn as SVG with no animation: warp shows as radial lines whose length follows the warp factor.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

function useStars() {
  return useMemo(() => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 140 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = 12 + rnd() * 190;
      return { a, r, b: 0.3 + rnd() * 0.7 };
    });
  }, []);
}

export default function Viewscreen2D({ warp = 0, mode = 'space', alert = 'green', hit = false, contact, className, style }) {
  const stars = useStars();
  const w = clamp(warp, 0, 9);
  const streak = mode === 'orbit' ? 0 : w * 7; // px of line per star
  const cx = 160;
  const cy = 90;
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 14, background: '#020308', ...style }}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img"
        aria-label={`Viewscreen, ${mode}, warp ${w.toFixed(1)}, ${alert} alert`}>
        {mode !== 'tactical' &&
          stars.map((s, i) => {
            const x = cx + Math.cos(s.a) * s.r;
            const y = cy + Math.sin(s.a) * s.r * 0.75;
            if (streak < 1) return <circle key={i} cx={x} cy={y} r={0.6} fill="#fff" fillOpacity={s.b} />;
            const k = streak * (s.r / 200);
            return <line key={i} x1={x} y1={y} x2={x + Math.cos(s.a) * k} y2={y + Math.sin(s.a) * k * 0.75} stroke="#cfe2ff" strokeOpacity={s.b} strokeWidth="0.7" strokeLinecap="round" />;
          })}
        {mode === 'orbit' && (
          <>
            <defs>
              <radialGradient id="vs-planet" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#4f8f9f" />
                <stop offset="0.6" stopColor="#2f5f4a" />
                <stop offset="1" stopColor="#0b1a24" />
              </radialGradient>
            </defs>
            <circle cx="150" cy="330" r="200" fill="#6cb6ff" fillOpacity="0.18" />
            <circle cx="150" cy="330" r="194" fill="url(#vs-planet)" />
          </>
        )}
        {mode === 'tactical' && (
          <g>
            {[30, 58, 86].map((r) => <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="#3d6a8f" strokeOpacity="0.6" strokeWidth="0.6" />)}
            <line x1={cx} y1="0" x2={cx} y2="180" stroke="#1d3550" strokeWidth="0.5" />
            <line x1="0" y1={cy} x2="320" y2={cy} stroke="#1d3550" strokeWidth="0.5" />
            {/* own ship, fore up */}
            <path d={`M${cx} ${cy - 9} L${cx + 6} ${cy + 7} L${cx} ${cy + 4} L${cx - 6} ${cy + 7} Z`} fill="#c9ccd3" />
            {/* contact: ship-relative x/z, port is +x so it goes left */}
            <circle cx={cx - (contact?.x ?? -7) * 4.7} cy={cy - (contact?.z ?? 9) * 4.7} r="3" fill={alert === 'red' ? '#ff5a4a' : '#ffd36a'} />
          </g>
        )}
      </svg>
      <ViewscreenOverlay alert={alert} hit={hit} still />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { onFrame } from '../lib/raf.js';

// DOM layer on top of the viewscreen (3D or 2D): alert tint, a bezel shadow, and TV static while hit.
// Static runs on the app's shared animation loop and only while it's visible.

const TINT = {
  green: null,
  yellow: 'rgba(255, 196, 64, 0.10)',
  red: 'rgba(255, 40, 30, 0.16)',
};

const KEYFRAMES = `@keyframes vs-red-pulse { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }`;

export function ViewscreenOverlay({ alert = 'green', hit = false, still = false }) {
  const canvas = useRef(null);
  const [staticOn, setStaticOn] = useState(false);

  // static stays on while hit is true, plus a short tail after it ends
  useEffect(() => {
    if (hit) {
      setStaticOn(true);
      return undefined;
    }
    const t = setTimeout(() => setStaticOn(false), 350);
    return () => clearTimeout(t);
  }, [hit]);

  useEffect(() => {
    if (!staticOn || still) return undefined;
    const el = canvas.current;
    const ctx = el.getContext('2d');
    const img = ctx.createImageData(el.width, el.height);
    const d = img.data;
    let frame = 0;
    return onFrame(() => {
      if (frame++ % 2) return; // 30 fps is plenty for noise
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      el.style.opacity = String(0.18 + Math.random() * 0.3);
      el.style.transform = `translateY(${((Math.random() - 0.5) * 6) | 0}px)`;
    });
  }, [staticOn, still]);

  const tint = TINT[alert];
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <style>{KEYFRAMES}</style>
      {tint && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: tint,
            mixBlendMode: 'screen',
            animation: alert === 'red' && !still ? 'vs-red-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
      )}
      {staticOn && (
        <canvas
          ref={canvas}
          width={160}
          height={90}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', mixBlendMode: 'screen', opacity: still ? 0.25 : 0.3 }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: 'inset 0 0 60px rgba(0,0,0,0.85), inset 0 0 0 2px rgba(120,150,190,0.25)' }} />
    </div>
  );
}

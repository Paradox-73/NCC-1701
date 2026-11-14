import { lazy, Suspense, useEffect, useState } from 'react';
import Starship2D from './Starship2D.jsx';

// What the rest of the app imports. The 3D code (three, r3f, drei) is a separate chunk that only loads
// when this component renders in 3D mode, so pages without the ship don't pay for it.
const Starship3D = lazy(() => import('./Starship.jsx'));

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

const REDUCED = '(prefers-reduced-motion: reduce)';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.(REDUCED).matches);
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED);
    if (!query) return;
    const on = (e) => setReduced(e.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return reduced;
}

// mode: 'auto' (3D when the device can), '3d' or '2d'
export default function StarshipView({ mode = 'auto', ...props }) {
  const [webgl] = useState(hasWebGL);
  const reduced = useReducedMotion();
  const use3D = webgl && (mode === '3d' || (mode === 'auto' && !reduced));
  if (!use3D) return <Starship2D {...props} />;
  return (
    <Suspense fallback={<Starship2D {...props} />}>
      <Starship3D {...props} />
    </Suspense>
  );
}

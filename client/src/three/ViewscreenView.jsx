import { lazy, Suspense, useState } from 'react';
import Viewscreen2D from './Viewscreen2D.jsx';
import { ErrorBoundary, hasWebGL, useReducedMotion } from './StarshipView.jsx';

// What the app imports for the main viewscreen. Same pattern as StarshipView: the 3D chunk only loads
// when this renders in 3D, and the flat SVG version covers no WebGL, reduced motion, loading and a chunk that fails.
const Viewscreen3D = lazy(() => import('./Viewscreen.jsx'));

// mode3d: 'auto' (3D when the device can), '3d' or '2d'. `mode` is the scene (space / orbit / tactical).
export default function ViewscreenView({ mode3d = 'auto', ...props }) {
  const [webgl] = useState(hasWebGL);
  const reduced = useReducedMotion();
  const use3D = webgl && (mode3d === '3d' || (mode3d === 'auto' && !reduced));
  const flat = <Viewscreen2D {...props} />;
  if (!use3D) return flat;
  return (
    <ErrorBoundary fallback={flat}>
      <Suspense fallback={flat}>
        <Viewscreen3D {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

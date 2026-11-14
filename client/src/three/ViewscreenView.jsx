import { lazy, Suspense, useState } from 'react';
import Viewscreen2D from './Viewscreen2D.jsx';
import { hasWebGL, useReducedMotion } from './StarshipView.jsx';

// What the app imports for the main viewscreen. Same pattern as StarshipView: the 3D chunk only loads
// when this renders in 3D, and the flat SVG version covers no WebGL, reduced motion and loading.
const Viewscreen3D = lazy(() => import('./Viewscreen.jsx'));

// mode3d: 'auto' (3D when the device can), '3d' or '2d'. `mode` is the scene (space / orbit / tactical).
export default function ViewscreenView({ mode3d = 'auto', ...props }) {
  const [webgl] = useState(hasWebGL);
  const reduced = useReducedMotion();
  const use3D = webgl && (mode3d === '3d' || (mode3d === 'auto' && !reduced));
  if (!use3D) return <Viewscreen2D {...props} />;
  return (
    <Suspense fallback={<Viewscreen2D {...props} />}>
      <Viewscreen3D {...props} />
    </Suspense>
  );
}

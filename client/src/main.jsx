import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/michroma/latin-400.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import App from './App.jsx';
import { hasWebGL } from './three/StarshipView.jsx';
import './index.css';
import './ui/ui.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Warm the 3D chunk and the ship model once the first screen is up, so the bridge doesn't hitch on them
// (~230 ms on an Iris Xe when the model decodes on first view). Skipped without WebGL: the 2D views need neither.
if (hasWebGL()) {
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
  idle(() => import('./three/Starship.jsx').then((m) => m.preloadShip()).catch(() => {}), { timeout: 4000 });
}

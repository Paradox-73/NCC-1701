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

// After a redeploy, a tab left open asks for code files the server no longer has. Reload once to get the new ones. A
// second failure within a minute is left to the fallbacks (the flat ship and viewscreen, "This station failed to
// load"), so a file that is really missing cannot reload the page in a loop.
window.addEventListener('vite:preloadError', () => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('ncc.reloadedAt')) < 60_000) return;
    sessionStorage.setItem('ncc.reloadedAt', String(Date.now()));
  } catch { return; } // no storage, no way to tell a loop: leave it to the fallbacks
  location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Warm the 3D chunk and the ship model once the first screen is up, so the bridge doesn't hitch on them
// (~230 ms on an Iris Xe when the model decodes on first view). Skipped without WebGL or with reduced motion: the
// 2D views those get need neither.
if (hasWebGL() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
  idle(() => import('./three/Starship.jsx').then((m) => m.preloadShip()).catch(() => {}), { timeout: 4000 });
}

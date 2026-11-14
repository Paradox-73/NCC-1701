import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ViewscreenDemo from './ViewscreenDemo.jsx';

document.body.style.margin = '0';
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ViewscreenDemo />
  </StrictMode>,
);

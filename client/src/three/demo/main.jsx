import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StarshipDemo from './StarshipDemo.jsx';

document.body.style.margin = '0';
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StarshipDemo />
  </StrictMode>,
);

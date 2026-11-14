import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone for now: the starship demo page is the only entry until the app shell lands on main.
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { starship: 'starship-demo.html' } } },
  server: { open: '/starship-demo.html' },
});

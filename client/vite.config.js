import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_PORT lets a second dev server run beside the default one; the default matches CORS_ORIGIN in .env.example.
const port = Number(process.env.VITE_PORT) || 5173;

// Two entries: the app (index.html) and the standalone starship + viewscreen demos (starship-demo.html, viewscreen-demo.html, also served by the dev server).
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', starship: 'starship-demo.html', viewscreen: 'viewscreen-demo.html' } } },
  server: { port, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd())] } },
});

import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_PORT lets a second dev server run beside the default one; the default matches CORS_ORIGIN in .env.example.
const port = Number(process.env.VITE_PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd())] } },
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

// In development, Express (server.ts) embeds Vite as middleware on port 3000.
// There is NO separate Vite dev server and therefore NO proxy needed.
// The proxy block has been removed to prevent a self-referential loop where
// Vite would proxy /api back to itself.
//
// To start dev: npm run dev  →  NODE_ENV=development tsx server.ts
// Everything (API + HMR + React) is served from http://localhost:3000

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Only expose VITE_* prefixed vars to the browser bundle
      'import.meta.env.VITE_NVIDIA_API_KEY': JSON.stringify(env.VITE_NVIDIA_API_KEY ?? ''),
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL ?? ''),
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      // NO proxy — Vite runs as Express middleware in dev, not standalone
    },
  };
});

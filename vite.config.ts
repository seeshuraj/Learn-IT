import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

// Dev architecture:
//   Express (API)  → http://localhost:3000
//   Vite  (React)  → http://localhost:5173  (proxies /api/* to :3000)
//
// Start with:  npm run dev
// Which runs:  concurrently "cross-env NODE_ENV=development tsx server.ts" "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // Forward ALL VITE_* env vars into the client bundle.
  // IMPORTANT: every VITE_* var used by src/ MUST appear here, otherwise
  // Vite bakes it as `undefined` in the production build even if the var
  // is set in Vercel's environment variables panel.
  const clientEnvDefines = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith('VITE_'))
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  );

  return {
    plugins: [react(), tailwindcss()],
    define: {
      ...clientEnvDefines,
      // Explicit fallbacks for the three vars most critical to auth.
      // These are overridden by clientEnvDefines when the real values exist.
      'import.meta.env.VITE_SUPABASE_URL':      JSON.stringify(env.VITE_SUPABASE_URL      ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ''),
      'import.meta.env.VITE_API_BASE_URL':       JSON.stringify(env.VITE_API_BASE_URL       ?? ''),
      'import.meta.env.VITE_NVIDIA_API_KEY':     JSON.stringify(env.VITE_NVIDIA_API_KEY     ?? ''),
      'import.meta.env.VITE_HCAPTCHA_SITE_KEY':  JSON.stringify(env.VITE_HCAPTCHA_SITE_KEY  ?? ''),
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    server: {
      port: 5173,
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Forward all /api requests to the Express server on :3000
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});

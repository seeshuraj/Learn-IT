import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import clientEnvAllowlist from './scripts/client-env-allowlist.json';

// Dev architecture:
//   Express (API)  → http://localhost:3000
//   Vite  (React)  → http://localhost:5173  (proxies /api/* to :3000)
//
// Start with:  npm run dev
// Which runs:  concurrently "cross-env NODE_ENV=development tsx server.ts" "vite"

// The only variables allowed into the browser bundle (single source of truth,
// shared with scripts/check-client-env.mjs). Everything else is server-only
// and must never carry the VITE_ prefix.
const CLIENT_ENV_ALLOWLIST: readonly string[] = clientEnvAllowlist;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // Vite inlines every VITE_* variable wherever code reads `import.meta.env`
  // as a whole object, so an allowlisted `define` alone is not enough: a stray
  // VITE_* secret in the environment would still ship. Fail the build instead.
  // VITE_VERCEL_* are non-secret system variables (commit SHA, branch URL, …)
  // that Vercel injects into every Vite build; they are not ours to remove.
  const forbidden = Object.keys(env).filter(
    (key) =>
      key.startsWith('VITE_') &&
      !key.startsWith('VITE_VERCEL_') &&
      !CLIENT_ENV_ALLOWLIST.includes(key),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `[vite] Refusing to build: non-allowlisted client env var(s) set: ${forbidden.join(', ')}. ` +
      'VITE_* values are public. Remove them from the environment (e.g. Vercel → Settings → ' +
      'Environment Variables) and keep server secrets without the VITE_ prefix.',
    );
  }

  const clientEnvDefines = Object.fromEntries(
    CLIENT_ENV_ALLOWLIST.map((key) => [`import.meta.env.${key}`, JSON.stringify(env[key] ?? '')]),
  );

  return {
    plugins: [react(), tailwindcss()],
    define: clientEnvDefines,
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    build: {
      // Raise the chunk size warning threshold slightly (default 500 kB)
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Split the monolithic bundle into focused, cacheable chunks.
          // This also resolves the supabaseClient dynamic/static import conflict
          // by forcing supabase into its own isolated chunk.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor':    ['framer-motion', 'motion', 'lucide-react', 'recharts'],
            'supabase':     ['@supabase/supabase-js'],
            'utils':        ['zod', 'clsx', 'tailwind-merge', 'sonner'],
            'markdown':     ['react-markdown'],
          },
        },
      },
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

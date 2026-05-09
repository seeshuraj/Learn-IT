// Build script: bundle server.ts -> dist-server/server.js using esbuild
import { build } from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist-server', { recursive: true });

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist-server/server.js',
  // Keep native modules external so esbuild doesn't try to bundle .node binaries
  external: [
    'better-sqlite3',
    'mammoth',
    'pdf-parse',
    'multer',
    // keep all node built-ins external
    'fs', 'path', 'url', 'module', 'os', 'crypto', 'stream', 'http', 'https',
    'net', 'tls', 'zlib', 'events', 'util', 'buffer', 'child_process',
  ],
  banner: {
    js: '// LearnIT server bundle',
  },
});

console.log('✅ dist-server/server.js built successfully');

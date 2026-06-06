// Build script: bundle server.ts -> dist-server/server.js using esbuild
import { build } from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist-server', { recursive: true });

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',        // Render ships Node 24; node22 is the closest stable esbuild target
  format: 'esm',
  outfile: 'dist-server/server.js',
  // Keep ALL node_modules external — many are CJS and use dynamic require() internally
  // which breaks when bundled into an ESM output file.
  packages: 'external',
  banner: {
    js: '// LearnIT server bundle',
  },
});

console.log('✅ dist-server/server.js built successfully');

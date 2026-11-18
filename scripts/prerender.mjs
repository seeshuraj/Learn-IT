// Prerender the public landing page into dist/index.html.
//
// The app is a single-page app, so without this every URL serves an empty
// <div id="root">. Search engines that don't run JavaScript (and link
// previews) would see no text at all. This renders <LandingPage/> to HTML at
// build time and puts it inside #root. On load, React's createRoot replaces it.
//
// A small inline script in index.html hides the prerendered page before first
// paint for signed-in visitors and for any path other than "/" or "/landing",
// so nobody sees the landing page flash on their way to the app.
//
// Runs after `vite build` (see package.json "build").

import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const HTML = 'dist/index.html';
const TMP = 'dist-prerender';
const MARKER = '<div id="root"></div>';

const entry = `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { StaticRouter } from 'react-router-dom';
  import LandingPage from './src/pages/LandingPage.tsx';
  export default () => renderToString(
    React.createElement(StaticRouter, { location: '/' }, React.createElement(LandingPage))
  );
`;

mkdirSync(TMP, { recursive: true });
const outfile = path.join(TMP, 'landing.mjs');
try {
  await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'prerender-entry.tsx' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    jsx: 'automatic',
    outfile,
    logLevel: 'warning',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    // react-dom/server is CommonJS and requires Node built-ins (util, stream).
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });

  const { default: render } = await import(pathToFileURL(path.resolve(outfile)).href);
  const markup = render();
  if (!markup.includes('<h1')) throw new Error('Prerendered landing page has no <h1>');

  const html = readFileSync(HTML, 'utf8');
  if (!html.includes(MARKER)) throw new Error(`${HTML} has no ${MARKER}`);
  writeFileSync(HTML, html.replace(MARKER, `<div id="root"><div id="prerender">${markup}</div></div>`));
  console.log(`✅ Prerendered landing page into ${HTML} (${(markup.length / 1024).toFixed(1)} kB)`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

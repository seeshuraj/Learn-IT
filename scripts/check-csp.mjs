// Build guard: the Content-Security-Policy in vercel.json must allow what the
// built app actually needs, or production breaks silently (blank page, failed
// logins). Checks that
//   * every inline executable <script> in dist/index.html is allowed by hash;
//   * the API and Supabase origins baked into the bundle are in connect-src.
// Run after `vite build` and the prerender step.
import fs from 'node:fs';
import crypto from 'node:crypto';

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const csp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy')?.value;
if (!csp) { console.error('❌ vercel.json has no Content-Security-Policy header'); process.exit(1); }
const directive = name => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) ?? '').split(/\s+/).slice(1);

const problems = [];
const html = fs.readFileSync('dist/index.html', 'utf8');
const scriptSrc = directive('script-src');
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/type=["']application\/ld\+json["']/.test(m[1])) continue;   // data block, not executed
  const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
  if (!scriptSrc.includes(hash)) problems.push(`inline script in index.html is not allowed: add ${hash} to script-src`);
}

const connectSrc = directive('connect-src');
for (const name of ['VITE_API_BASE_URL', 'VITE_SUPABASE_URL']) {
  const value = process.env[name];
  if (!value) continue;   // dev builds and the e2e stack run without the production values
  const origin = new URL(value).origin;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && !connectSrc.includes(origin))
    problems.push(`${name} origin ${origin} is not in connect-src`);
}

if (problems.length) {
  console.error('❌ Content-Security-Policy does not match the build:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('✅ Content-Security-Policy matches the build');

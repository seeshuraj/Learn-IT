#!/usr/bin/env node
/**
 * check-client-env.mjs — fails if browser code references a VITE_* variable
 * outside the allowlist, or talks to an AI provider directly.
 *
 * Runs as `prebuild`, so every `npm run build` (including Vercel) enforces it.
 * Server code (src/server) is excluded: it runs on Render, not in the browser.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const allowlist = new Set(
  JSON.parse(readFileSync(join(ROOT, 'scripts/client-env-allowlist.json'), 'utf8')),
);

const CLIENT_ROOTS = ['src', 'index.html'];
const EXCLUDED_DIRS = new Set([join(ROOT, 'src', 'server')]);
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|html)$/;

// Provider endpoints and key shapes that must never appear in client code.
const FORBIDDEN_PATTERNS = [
  { re: /integrate\.api\.nvidia\.com/, why: 'direct NVIDIA NIM call (route AI through the backend)' },
  { re: /nvapi-[A-Za-z0-9_-]{8,}/, why: 'NVIDIA API key literal' },
  { re: /sk-[A-Za-z0-9]{20,}/, why: 'provider secret key literal' },
  { re: /SERVICE_ROLE/, why: 'service-role reference in client code' },
];

function* walk(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory()) {
    if (EXCLUDED_DIRS.has(path)) return;
    for (const entry of readdirSync(path)) yield* walk(join(path, entry));
  } else if (EXTENSIONS.test(path)) {
    yield path;
  }
}

const problems = [];
for (const root of CLIENT_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const where = `${relative(ROOT, file)}:${i + 1}`;
      for (const [name] of line.matchAll(/\bVITE_[A-Z0-9_]+\b/g)) {
        if (!allowlist.has(name)) problems.push(`${where}  non-allowlisted client env var ${name}`);
      }
      for (const { re, why } of FORBIDDEN_PATTERNS) {
        if (re.test(line)) problems.push(`${where}  ${why}`);
      }
    });
  }
}

if (problems.length > 0) {
  console.error('✗ check-client-env failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nAllowed client env vars: ${[...allowlist].join(', ')}`);
  process.exit(1);
}
console.log(`✓ check-client-env: no forbidden client env vars or provider calls`);

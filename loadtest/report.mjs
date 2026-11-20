// Prints a short table from k6's --summary-export JSON. No tokens or personal
// data are in the summary.
import { readFileSync } from 'node:fs';

const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const m = s.metrics;
const fmt = v => (v == null ? '-' : `${Math.round(v)}`);

const rows = Object.entries(m)
  .filter(([k]) => k.startsWith('http_req_duration{name:'))
  .map(([k, v]) => ({ name: k.slice('http_req_duration{name:'.length, -1), ...v }))
  .sort((a, b) => (b['p(95)'] ?? 0) - (a['p(95)'] ?? 0));

const reqs = m.http_reqs ?? {};
const failed = m.http_req_failed ?? {};
const all = m.http_req_duration ?? {};
console.log('\n=== LearnIT load test ===');
console.log(`Requests: ${reqs.count} (${(reqs.rate ?? 0).toFixed(1)}/s)   Failed: ${((failed.value ?? failed.rate ?? 0) * 100).toFixed(2)}%   Peak users: ${m.vus_max?.max ?? m.vus_max?.value}`);
console.log(`All requests (ms): median ${fmt(all.med)}  p95 ${fmt(all['p(95)'])}  p99 ${fmt(all['p(99)'])}  max ${fmt(all.max)}`);
console.log('\nEndpoint                 median    p95    p99    max');
for (const r of rows) {
  console.log(`${r.name.padEnd(24)} ${fmt(r.med).padStart(6)} ${fmt(r['p(95)']).padStart(6)} ${fmt(r['p(99)']).padStart(6)} ${fmt(r.max).padStart(6)}`);
}
const checks = Object.entries(s.root_group?.checks ?? {}).concat(
  Object.values(s.root_group?.groups ?? {}).flatMap(g => Object.entries(g.checks ?? {})));
const bad = checks.filter(([, c]) => c.fails > 0).map(([n, c]) => `${n}: ${c.fails} failed of ${c.passes + c.fails}`);
console.log(bad.length ? `\nFailed checks:\n  ${bad.join('\n  ')}` : '\nAll checks passed.');
// summary-export marks a threshold true when it was crossed; newer formats use { ok }.
const passed = v => (typeof v === 'object' && v !== null ? v.ok !== false : v === false);
console.log('\nPass bars:\n  ' + Object.entries(m).filter(([k, v]) => v.thresholds && !k.includes('{name:'))
  .flatMap(([k, v]) => Object.entries(v.thresholds).map(([t, r]) => `${passed(r) ? 'PASS' : 'FAIL'}  ${k} ${t}`)).join('\n  '));

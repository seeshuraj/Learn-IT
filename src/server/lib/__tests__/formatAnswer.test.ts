import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latexToText, normalizeMath } from '../../../shared/formatAnswer.js';

test('inline math from the KD-tree answer becomes readable text', () => {
  assert.equal(normalizeMath('Total time is **$O(N \\log N)$**.'), 'Total time is **O(N log N)**.');
  assert.equal(normalizeMath('height $h = \\lceil \\log_2 N \\rceil$'), 'height h = ⌈ log_2 N ⌉');
  assert.equal(normalizeMath('typically $K \\le 20$'), 'typically K ≤ 20');
  assert.equal(normalizeMath('$T(N) = 2T(N/2) + O(N)$'), 'T(N) = 2T(N/2) + O(N)');
  assert.equal(normalizeMath('send $\\rightarrow$ gather'), 'send → gather');
  assert.equal(normalizeMath('$\\approx N/P$ points'), '≈ N/P points');
});

test('display math, fractions, roots and text commands', () => {
  assert.equal(normalizeMath('$$\\frac{n(n+1)}{2}$$'), '(n(n+1))/2');
  assert.equal(latexToText('\\sqrt{x^{2} + y^{2}}'), '√(x^2 + y^2)');
  assert.equal(latexToText('\\text{if } x \\in S'), 'if x ∈ S');
  assert.equal(normalizeMath('\\(a \\times b\\)'), 'a × b');
});

test('currency, code spans and code blocks are left untouched', () => {
  assert.equal(normalizeMath('It costs $5 and $10 later.'), 'It costs $5 and $10 later.');
  assert.equal(normalizeMath('Use `$PATH` and `$x$` as is.'), 'Use `$PATH` and `$x$` as is.');
  const block = '```bash\necho "$HOME" $x$\n```';
  assert.equal(normalizeMath(block), block);
});

test('plain text without math is unchanged', () => {
  const s = 'A **KD-tree** splits space.\n\n- point one\n- point two';
  assert.equal(normalizeMath(s), s);
});

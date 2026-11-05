/**
 * formatAnswer.ts — make model answers readable in a renderer that supports
 * basic Markdown but not math.
 *
 * Models sometimes emit LaTeX despite being asked not to ("$O(N \log N)$").
 * normalizeMath() turns inline/display math into plain Unicode text and leaves
 * code spans, code blocks and currency ("$5 and $10") untouched.
 *
 * Pure and dependency-free: shared by the client and the server tests.
 */

const COMMANDS: Record<string, string> = {
  log: 'log', ln: 'ln', exp: 'exp', min: 'min', max: 'max', sin: 'sin', cos: 'cos',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '~',
  times: '×', cdot: '·', div: '÷', pm: '±',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
  infty: '∞', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  sum: 'Σ', prod: 'Π', forall: '∀', exists: '∃', partial: '∂', nabla: '∇',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', Sigma: 'Σ', phi: 'φ', omega: 'ω', Omega: 'Ω',
  ldots: '…', cdots: '⋯', dots: '…',
};

/** Convert the body of a LaTeX math span to readable plain text. */
export function latexToText(src: string): string {
  // Innermost first: x^{2} → x^2 so outer \frac{}/\sqrt{} see no nested braces.
  let s = src.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '_$1');
  // \frac{a}{b} → a/b (wrap multi-token parts in parentheses)
  const part = (x: string) => (/^[\w.]+$/.test(x) ? x : `(${x})`);
  for (let i = 0; i < 5 && /\\frac\{/.test(s); i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${part(a)}/${part(b)}`);
  }
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|mathcal|operatorname)\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)(?=[()[\]|.\\{}])/g, '');
  s = s.replace(/\\[,;:! ]/g, ' ');
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (name in COMMANDS ? COMMANDS[name] : m.slice(1)));
  s = s.replace(/\\([{}$%&_#])/g, '$1');
  s = s.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '_$1');
  s = s.replace(/[{}]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Replace $…$ / $$…$$ / \(…\) / \[…\] math in prose; code is left alone. */
export function normalizeMath(text: string): string {
  // Split out fenced blocks and inline code so they are never rewritten.
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((segment, i) => {
    if (i % 2 === 1) return segment;
    return segment
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => latexToText(m))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => latexToText(m))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => latexToText(m))
      // Inline $x$: no space just inside the delimiters and no digit right
      // after the closing $, so "$5 and $10" stays currency.
      .replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, m) => latexToText(m));
  }).join('');
}

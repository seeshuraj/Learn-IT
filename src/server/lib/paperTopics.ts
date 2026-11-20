import { stripReasoning } from './llm.js';

export interface PaperTopic {
  topic: string;
  /** Share of the paper's marks, 0–100, or null when the model gave none. */
  weight: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  /** Question references as the model wrote them ("Q3", "7(b)"); resolved against the paper later. */
  questions: string[];
}

const MAX_TOPICS = 20;

/** The first complete JSON value starting at `start` ('[' or '{'), or null. Strings are respected. */
function balancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Every JSON array or object in the text that parses, in order. */
function jsonValues(text: string): unknown[] {
  const found: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' && text[i] !== '{') continue;
    const candidate = balancedJson(text, i);
    if (!candidate) continue;
    try {
      found.push(JSON.parse(candidate));
      i += candidate.length - 1;
    } catch { /* not JSON from here: try the next bracket */ }
  }
  return found;
}

function toWeight(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function toDifficulty(v: unknown): PaperTopic['difficulty'] {
  const d = String(v ?? '').trim().toLowerCase();
  return d === 'easy' || d === 'medium' || d === 'hard' ? d : null;
}

/** The first value among `names`, matching keys by their letters only ("Weight (%)" is "weight"). */
function pick(o: Record<string, unknown>, names: string[]): unknown {
  const byLetters = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) byLetters.set(k.toLowerCase().replace(/[^a-z]/g, ''), v);
  for (const n of names) if (byLetters.has(n)) return byLetters.get(n);
  return undefined;
}

function toRefs(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' || typeof v === 'number' ? String(v).split(/[,;/]|\band\b/) : [];
  return list.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 30);
}

function toTopic(item: unknown): PaperTopic | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const name = String(pick(o, ['topic', 'topicname', 'name', 'title']) ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return null;
  return {
    topic: name,
    weight: toWeight(pick(o, ['weight', 'weightage', 'percentage', 'percent', 'marksshare', 'share'])),
    difficulty: toDifficulty(pick(o, ['difficulty', 'difficultylevel', 'level'])),
    questions: toRefs(pick(o, ['questions', 'questionnumbers', 'question', 'questionno', 'qnos', 'qs'])),
  };
}

/**
 * The topics in a model's answer about a question paper. Tolerates reasoning
 * blocks, code fences, words around the JSON and a `{ "topics": [...] }`
 * wrapper; drops items without a name; never throws.
 */
export function parsePaperTopics(raw: string): PaperTopic[] {
  const text = stripReasoning(String(raw ?? '')).replace(/```[a-z]*/gi, '');
  for (const value of jsonValues(text)) {
    const list = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as any).topics) ? (value as any).topics : null;
    if (!list) continue;
    const seen = new Set<string>();
    const topics: PaperTopic[] = [];
    for (const item of list) {
      const t = toTopic(item);
      if (!t || seen.has(t.topic.toLowerCase())) continue;
      seen.add(t.topic.toLowerCase());
      topics.push(t);
      if (topics.length === MAX_TOPICS) break;
    }
    if (topics.length) return topics;
  }
  return [];
}

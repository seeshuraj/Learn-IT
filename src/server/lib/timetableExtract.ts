/**
 * Reads an exam timetable from an image, a PDF or an unusually laid-out
 * spreadsheet with Claude, returning one RawEntry per exam.
 *
 * Only the timetable goes to the model (no student data). The admin reviews
 * every row before anything is published, so a misread is caught there.
 * Usage is metered through the same hooks as the other AI features.
 */

import type { RawEntry } from './timetable.js';
import type { LlmUsage } from './llm.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_ROWS = 600;

export type TimetableSource =
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'text'; text: string };   // a spreadsheet dumped as CSV

export interface ExtractDeps {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  beforeCall?: () => Promise<void>;
  onUsage?: (u: LlmUsage) => void;
}

export class TimetableReadError extends Error {
  constructor(message: string) { super(message); this.name = 'TimetableReadError'; }
}

const TOOL = {
  name: 'record_exams',
  description: 'Record every exam in the timetable, one entry per exam per department/year.',
  input_schema: {
    type: 'object',
    properties: {
      exams: {
        type: 'array',
        maxItems: MAX_ROWS,
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Exam date exactly as printed, or as YYYY-MM-DD if unambiguous' },
            session: { type: 'string', description: 'FN or AN if the timetable uses sessions' },
            time: { type: 'string', description: 'Time range as printed, e.g. "10.00 AM - 1.00 PM"' },
            course_code: { type: 'string', description: 'Subject/course code, e.g. CS3401' },
            course_name: { type: 'string', description: 'Subject/course name' },
            department: { type: 'string', description: 'Department or branch, e.g. CSE' },
            year: { type: 'string', description: 'Year of study, e.g. II' },
            semester: { type: 'string', description: 'Semester, e.g. IV' },
            venue: { type: 'string', description: 'Hall or room, if given' },
          },
          required: ['date'],
        },
      },
      note: { type: 'string', description: 'Anything unclear (unreadable cells, assumptions). Empty if none.' },
    },
    required: ['exams'],
  },
} as const;

const INSTRUCTIONS = `This is a college exam timetable. Record every exam in it with the record_exams tool.
- One entry per exam, per department and year. If one subject is written for several departments, make one entry for each department.
- If the layout is a grid (dates down the side, departments or years across the top), read each filled cell as one exam.
- Copy codes, names and dates as printed. Do not invent values: leave a field out if it isn't in the timetable.
- If a heading gives the department, year or semester for a whole table, apply it to each exam in that table.
- Dates in India are written day first (12/11/2026 is 12 November).`;

export function buildRequest(src: TimetableSource, model: string) {
  const content: unknown[] = [];
  if (src.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: src.mediaType, data: src.base64 } });
  if (src.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.base64 } });
  content.push({ type: 'text', text: src.kind === 'text' ? `${INSTRUCTIONS}\n\nTimetable (CSV):\n${src.text.slice(0, 60_000)}` : INSTRUCTIONS });
  return {
    model,
    max_tokens: 16_000,
    temperature: 0,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  };
}

/** Turn the model's tool call into RawEntry rows (row = position, 1-based). */
export function readToolOutput(body: any): { rows: RawEntry[]; note: string | null; truncated: boolean } {
  const call = Array.isArray(body?.content) ? body.content.find((c: any) => c?.type === 'tool_use' && c?.name === TOOL.name) : null;
  if (!call) throw new TimetableReadError("The timetable couldn't be read. Try a clearer image or an Excel file.");
  const exams: any[] = Array.isArray(call.input?.exams) ? call.input.exams.slice(0, MAX_ROWS) : [];
  const rows: RawEntry[] = exams.map((e, i) => ({
    row: i + 1,
    date: e?.date, session: e?.session, time: e?.time,
    course_code: e?.course_code, course_name: e?.course_name,
    department: e?.department, year: e?.year, semester: e?.semester, venue: e?.venue,
  }));
  const note = typeof call.input?.note === 'string' && call.input.note.trim() ? call.input.note.trim().slice(0, 1000) : null;
  return { rows, note, truncated: body?.stop_reason === 'max_tokens' };
}

export async function extractTimetable(src: TimetableSource, deps: ExtractDeps) {
  await deps.beforeCall?.();
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 120_000);
  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': deps.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(buildRequest(src, deps.model)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const body: any = await res.json().catch(() => null);
  const usage = body?.usage ?? {};
  deps.onUsage?.({
    model: `anthropic:${deps.model}`,
    promptTokens: Number(usage.input_tokens) || 0,
    completionTokens: Number(usage.output_tokens) || 0,
    estimated: !usage.input_tokens,
    latencyMs: Date.now() - started,
    status: res.ok ? 'ok' : 'error',
    stream: false,
  });
  if (!res.ok) {
    // 4xx other than rate limits won't succeed on retry (bad file, too large).
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    const err = new Error(`Claude ${res.status}`);
    if (permanent) throw new TimetableReadError("This file couldn't be read. Try a clearer image, a PDF under 10 pages, or an Excel file.");
    throw err;
  }
  return readToolOutput(body);
}

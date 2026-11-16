import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, readToolOutput, extractTimetable, TimetableReadError } from '../timetableExtract.js';
import { entryProblems } from '../timetable.js';

test('request: image/PDF/text forced through the tool', () => {
  const img = buildRequest({ kind: 'image', mediaType: 'image/png', base64: 'AAA' }, 'm');
  assert.equal((img.messages[0].content as any[])[0].type, 'image');
  assert.deepEqual(img.tool_choice, { type: 'tool', name: 'record_exams' });
  const pdf = buildRequest({ kind: 'pdf', base64: 'AAA' }, 'm');
  assert.equal((pdf.messages[0].content as any[])[0].type, 'document');
  const txt = buildRequest({ kind: 'text', text: 'Date,CSE\n12/11,CS3401' }, 'm');
  assert.match((txt.messages[0].content as any[])[0].text, /Timetable \(CSV\):\nDate,CSE/);
});

test('response: rows numbered, note and truncation passed on', () => {
  const out = readToolOutput({
    stop_reason: 'max_tokens',
    content: [{ type: 'tool_use', name: 'record_exams', input: { exams: [{ date: '12/11/2026', course_code: 'CS3401' }, { date: '13/11/2026' }], note: ' Row 4 smudged ' } }],
  });
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[1].row, 2);
  assert.equal(out.note, 'Row 4 smudged');
  assert.equal(out.truncated, true);
  assert.throws(() => readToolOutput({ content: [{ type: 'text', text: 'sorry' }] }), TimetableReadError);
});

test('call: usage metered; bad file is a permanent error, overload is retryable', async () => {
  const usage: any[] = [];
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  const ok = await extractTimetable({ kind: 'text', text: 'x' }, {
    apiKey: 'k', model: 'm', onUsage: u => usage.push(u),
    fetch: reply(200, { usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: 'tool_use', name: 'record_exams', input: { exams: [] } }] }) as any,
  });
  assert.equal(ok.rows.length, 0);
  assert.equal(usage[0].promptTokens, 900);
  assert.equal(usage[0].model, 'anthropic:m');
  await assert.rejects(extractTimetable({ kind: 'text', text: 'x' }, { apiKey: 'k', model: 'm', fetch: reply(400, {}) as any }), TimetableReadError);
  await assert.rejects(extractTimetable({ kind: 'text', text: 'x' }, { apiKey: 'k', model: 'm', fetch: reply(529, {}) as any }),
    (e: any) => !(e instanceof TimetableReadError));
});

test('row problems shown to the admin', () => {
  assert.deepEqual(entryProblems({ exam_date: null, course_id: 1, department_id: null, year_of_study: null }), ['Date missing']);
  assert.match(entryProblems({ exam_date: '2026-12-01', course_id: null, department_id: 2, year_of_study: 3 })[0], /no professor/);
  assert.match(entryProblems({ exam_date: '2026-12-01', course_id: null, department_id: null, year_of_study: 3 })[0], /nobody/);
  assert.deepEqual(entryProblems({ exam_date: '2026-12-01', course_id: 4, department_id: null, year_of_study: null }), []);
});

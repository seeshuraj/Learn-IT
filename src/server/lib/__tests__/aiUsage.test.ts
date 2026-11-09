import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  featureForPath, aiContextMiddleware, currentAiContext, setAiCourse,
  AiUsageRecorder, AiBudgetGuard, AiBudgetExceeded, monthStart, defaultBudgetFromEnv,
} from '../aiUsage.js';
import { createNimChat, estimateTokens } from '../llm.js';

const usage = { model: 'm', promptTokens: 10, completionTokens: 5, estimated: false, latencyMs: 12, status: 'ok' as const, stream: false };
const ctx = { institutionId: 'inst-a', userId: 7, feature: 'tutor_chat', courseId: 3 };

test('features are derived from the API path', () => {
  assert.equal(featureForPath('/api/ai/chat/stream'), 'tutor_chat');
  assert.equal(featureForPath('/api/ai/analytics-summary?x=1'), 'analytics_summary');
  assert.equal(featureForPath('/api/submissions/4/ai-grade'), 'grading');
  assert.equal(featureForPath('/api/roadmaps/generate'), 'roadmap');
  assert.equal(featureForPath('/api/unit-exams/2/analyse'), 'exam_analysis');
  assert.equal(featureForPath('/api/courses'), 'other');
});

test('context follows the request through async work and picks up the course', async () => {
  const req: any = { originalUrl: '/api/ai/chat', auth: { institutionId: 'inst-a', legacyUserId: 7 } };
  let seen: unknown;
  await new Promise<void>(resolve => aiContextMiddleware(req, {} as any, async () => {
    await new Promise(r => setTimeout(r, 1));
    setAiCourse(3);
    seen = currentAiContext();
    resolve();
  }));
  assert.deepEqual(seen, ctx);
  assert.equal(currentAiContext(), null, 'no context outside a request');
});

test('requests without a signed-in college are not attributed', async () => {
  let seen: unknown = 'unset';
  await new Promise<void>(resolve => aiContextMiddleware({ originalUrl: '/api/ai/chat' } as any, {} as any, () => {
    seen = currentAiContext(); resolve();
  }));
  assert.equal(seen, null);
});

test('recorder batches rows into one insert and survives DB errors', async () => {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const db = { async query(sql: string, params?: unknown[]) { inserts.push({ sql, params: params ?? [] }); return { rows: [] }; } };
  const rec = new AiUsageRecorder(db, { flushMs: 10_000, maxBatch: 3 });
  rec.record(ctx, usage);
  rec.record(ctx, { ...usage, status: 'error', promptTokens: 0, completionTokens: 0 });
  assert.equal(inserts.length, 0);
  rec.record(ctx, usage);   // reaches maxBatch
  await rec.flush();
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params.length, 30);
  assert.match(inserts[0].sql, /INSERT INTO ai_usage_events/);
  assert.deepEqual(inserts[0].params.slice(0, 10), ['inst-a', 7, 3, 'tutor_chat', 'm', 10, 5, false, 12, 'ok']);

  const broken = new AiUsageRecorder({ async query() { throw new Error('db down'); } }, { maxBatch: 1 });
  broken.record(ctx, usage);
  await broken.flush();   // must not throw
  assert.equal(broken.pending, 0);
});

test('budget guard: unlimited, within, exceeded, in-memory top-up and monthly reset', async () => {
  let budget: number | null = null;
  let used = 0;
  let queries = 0;
  const db = { async query() { queries++; return { rows: [{ budget, used }] }; } };
  let now = Date.UTC(2026, 10, 20, 12);
  const guard = new AiBudgetGuard(db, { defaultBudget: null, cacheMs: 60_000, now: () => now });

  await guard.check('inst-a');                       // no budget anywhere: unlimited
  budget = 1_000; used = 900; now += 61_000;
  await guard.check('inst-a');                       // 900 < 1000
  guard.add('inst-a', 150);                          // 1050 >= 1000 without a reload
  await assert.rejects(guard.check('inst-a'), AiBudgetExceeded);
  assert.equal(queries, 2, 'cached between reloads');

  used = 0; now = Date.UTC(2026, 11, 1, 0, 0, 5);    // new month reloads immediately
  await guard.check('inst-a');
  assert.deepEqual(await guard.status('inst-a'), { budget: 1000, used: 0 });
});

test('the env default applies when a college has no allowance of its own', async () => {
  const db = { async query() { return { rows: [{ budget: null, used: 600 }] }; } };
  const guard = new AiBudgetGuard(db, { defaultBudget: 500 });
  await assert.rejects(guard.check('inst-b'), (e: any) => e.status === 429 && /allowance/.test(e.message));
  assert.equal(defaultBudgetFromEnv({ AI_MONTHLY_TOKEN_BUDGET: '2000000' }), 2_000_000);
  assert.equal(defaultBudgetFromEnv({ AI_MONTHLY_TOKEN_BUDGET: '0' }), null);
  assert.equal(defaultBudgetFromEnv({}), null);
  assert.equal(monthStart(Date.UTC(2026, 1, 28, 23)).toISOString(), '2026-02-01T00:00:00.000Z');
});

test('LLM client reports provider token counts, estimates when absent, and lets beforeCall refuse', async () => {
  const seen: any[] = [];
  let withUsage = true;
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const payload: any = { choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }] };
    if (withUsage) payload.usage = { prompt_tokens: 42, completion_tokens: 3 };
    void body;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  let refuse = false;
  const client = createNimChat({
    apiKey: 'k', models: ['a/model'], isProduction: true, fetchImpl,
    onUsage: u => seen.push(u),
    beforeCall: () => { if (refuse) throw new AiBudgetExceeded(); },
  });
  const messages = [{ role: 'user', content: 'x'.repeat(40) }];
  assert.equal(await client.chat(messages), 'hello there');
  assert.equal(seen[0].promptTokens, 42);
  assert.equal(seen[0].estimated, false);
  assert.equal(seen[0].status, 'ok');

  withUsage = false;
  await client.chat(messages);
  assert.equal(seen[1].estimated, true);
  assert.equal(seen[1].promptTokens, estimateTokens('x'.repeat(40)));
  assert.equal(seen[1].completionTokens, estimateTokens('hello there'));

  refuse = true;
  await assert.rejects(client.chat(messages), AiBudgetExceeded);
  assert.equal(seen.length, 2, 'refused calls are not metered');
});

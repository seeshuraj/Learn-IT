import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNimChat, chatModelsFromEnv, modelRequestExtras, stripReasoning, DEFAULT_CHAT_MODELS, isDegradedModelResponse,
  claudeFallbackFromEnv, toClaudeMessages, DEFAULT_CLAUDE_MODEL, retryAfterMs, nimBaseFromEnv,
} from '../llm.js';

/** fetch stub routing by path; `chat` decides per requested model. */
function fakeNim(chat: (model: string, body: any) => [number, unknown], listed?: string[]) {
  const calls: { path: string; body?: any }[] = [];
  const impl = (async (url: string, init: any) => {
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    const [status, payload] = path === '/models'
      ? (listed ? [200, { data: listed.map(id => ({ id })) }] : [500, 'boom'])
      : chat(body.model, body);
    if (payload === HANG) {
      // Never answer; reject like fetch does when the AbortSignal fires.
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => {
        const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e);
      }));
    }
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls, chatCalls: () => calls.filter(c => c.path === '/chat/completions') };
}

const HANG = Symbol('hang');
const answer = (content: string | null, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });
const msgs = [{ role: 'user', content: 'hi' }];

test('candidate list: env override first, defaults after, no duplicates; retired model gone', () => {
  assert.deepEqual(chatModelsFromEnv({}), DEFAULT_CHAT_MODELS);
  const m = chatModelsFromEnv({ NVIDIA_CHAT_MODEL: 'a/x, openai/gpt-oss-20b' });
  assert.equal(m[0], 'a/x');
  assert.equal(m.filter(x => x === 'openai/gpt-oss-20b').length, 1);
  assert.ok(!DEFAULT_CHAT_MODELS.includes('meta/llama-3.3-70b-instruct'));
  // Retired on NVIDIA (404) as of 2026-11-11.
  assert.ok(!DEFAULT_CHAT_MODELS.includes('nvidia/nemotron-3-super-120b-a12b'));
  assert.ok(!DEFAULT_CHAT_MODELS.includes('nvidia/nemotron-nano-3-30b-a3b'));
  assert.ok(DEFAULT_CHAT_MODELS.length >= 5, 'enough fallbacks that one provider outage is survivable');
});

test('a retired model (410) fails over to the next and the working one is reused', async () => {
  const nim = fakeNim(model => model === 'm1' ? [410, { title: 'Gone' }] : [200, answer('ok from ' + model)]);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: nim.impl });
  assert.equal(await c.chat(msgs), 'ok from m2');
  assert.equal(await c.chat(msgs), 'ok from m2');
  assert.deepEqual(nim.chatCalls().map(x => x.body.model), ['m1', 'm2', 'm2']);
  assert.equal(c.currentModel(), 'm2');
});

test('a rate limit (429) does not fail over: it applies to the key, not the model', async () => {
  const nim = fakeNim(() => [429, 'rate limited']);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: nim.impl });
  await assert.rejects(c.chat(msgs), /NVIDIA NIM 429/);
  assert.equal(nim.chatCalls().length, 1);
});

test('when every candidate is retired the error says so and names the env var', async () => {
  const nim = fakeNim(() => [404, 'not found']);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: nim.impl });
  await assert.rejects(c.chat(msgs), /No chat model answered \(tried: m1, m2\).*NVIDIA_CHAT_MODEL or CLAUDE_API/);
});

test('discovery keeps only listed models; a failed discovery keeps all candidates', async () => {
  const listedNim = fakeNim(model => [200, answer(model)], ['m2', 'other']);
  const c1 = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: listedNim.impl });
  assert.deepEqual(await c1.discover(), ['m2']);
  assert.equal(await c1.chat(msgs), 'm2');

  const failingNim = fakeNim(model => [200, answer(model)]);   // /models → 500
  const c2 = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: failingNim.impl });
  assert.deepEqual(await c2.discover(), ['m1', 'm2']);
});

test('reasoning models get their no-thinking fields; others get none', async () => {
  assert.deepEqual(modelRequestExtras('nvidia/nemotron-3-super-120b-a12b'), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(modelRequestExtras('openai/gpt-oss-20b'), { reasoning_effort: 'low' });
  assert.deepEqual(modelRequestExtras('meta/llama-3.2-11b-vision-instruct'), {});
  const nim = fakeNim(() => [200, answer('ok')]);
  const c = createNimChat({ apiKey: 'k', models: ['openai/gpt-oss-20b'], isProduction: true, fetchImpl: nim.impl });
  await c.chat(msgs, { maxTokens: 300, temperature: 0.1 });
  const body = nim.chatCalls()[0].body;
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 300);
  assert.equal(body.temperature, 0.1);
});

test('hidden reasoning is stripped and an empty answer is an error, not a blank reply', async () => {
  assert.equal(stripReasoning('<think>secret plan</think>\nThe answer.'), 'The answer.');
  const nim = fakeNim(() => [200, answer(null, 'length')]);
  const c = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: nim.impl });
  await assert.rejects(c.chat(msgs), /empty answer \(length\)/);
});

test('without a key: production refuses, development returns a labelled mock', async () => {
  const prod = createNimChat({ apiKey: undefined, models: ['m1'], isProduction: true });
  await assert.rejects(prod.chat(msgs), /NVIDIA_API_KEY is not set/);
  const dev = createNimChat({ apiKey: undefined, models: ['m1'], isProduction: false });
  assert.match(await dev.chat(msgs), /^\[Mock AI\]/);
});

test('a model that hangs times out, is benched, and the call fails over within the deadline', async () => {
  let t = 0;
  const nim = fakeNim(model => model === 'slow' ? [200, HANG] : [200, answer('ok from ' + model)]);
  const c = createNimChat({
    apiKey: 'k', models: ['slow', 'fast'], isProduction: true, fetchImpl: nim.impl, now: () => t,
  });
  assert.equal(await c.chat(msgs, { timeoutMs: 20 }), 'ok from fast');
  // Benched: the next call goes straight to the working model.
  assert.equal(await c.chat(msgs, { timeoutMs: 20 }), 'ok from fast');
  assert.deepEqual(nim.chatCalls().map(x => x.body.model), ['slow', 'fast', 'fast']);
  // After the cooldown the preferred (working) model is still used first.
  t += 11 * 60_000;
  assert.equal(await c.chat(msgs, { timeoutMs: 20 }), 'ok from fast');
});

test('5xx from a model fails over; 429 does not', async () => {
  const nim = fakeNim(model => model === 'flaky' ? [503, 'overloaded'] : [200, answer(model)]);
  const c = createNimChat({ apiKey: 'k', models: ['flaky', 'good'], isProduction: true, fetchImpl: nim.impl });
  assert.equal(await c.chat(msgs), 'good');
  const limited = fakeNim(() => [429, 'slow down']);
  const c2 = createNimChat({ apiKey: 'k', models: ['a', 'b'], isProduction: true, fetchImpl: limited.impl });
  await assert.rejects(c2.chat(msgs), /429/);
  assert.equal(limited.chatCalls().length, 1);
});

test('the overall deadline stops failover instead of chaining long waits', async () => {
  let t = 0;
  const nim = fakeNim(() => { t += 30_000; return [503, 'down']; });
  const c = createNimChat({
    apiKey: 'k', models: ['a', 'b', 'c'], isProduction: true, fetchImpl: nim.impl, now: () => t, deadlineMs: 50_000,
  });
  await assert.rejects(c.chat(msgs), /tried: a, b\)/);
  assert.equal(nim.chatCalls().length, 2);
});

test('probe keeps responders first in preference order and benches the rest', async () => {
  const nim = fakeNim(model =>
    model === 'best-but-hangs' ? [410, 'gone'] : model === 'broken' ? [503, 'x'] : [200, answer('ok')]);
  const c = createNimChat({
    apiKey: 'k', models: ['best-but-hangs', 'broken', 'second', 'third'], isProduction: true, fetchImpl: nim.impl,
  });
  const results = await c.probe();
  assert.deepEqual(results.map(r => [r.model, r.ok]),
    [['best-but-hangs', false], ['broken', false], ['second', true], ['third', true]]);
  assert.equal(c.currentModel(), 'second');
  assert.equal(await c.chat(msgs), 'ok');
  assert.equal(nim.chatCalls().at(-1)!.body.model, 'second');
  assert.equal(nim.chatCalls()[0].body.max_tokens, 128);
});

// ── streaming ────────────────────────────────────────────────────────────────
import { visibleSoFar, ChatAborted } from '../llm.js';

const sse = (pieces: string[]) => pieces.map(p =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n';

/** A streamed Response whose body yields `chunks`, optionally hanging or erroring after them. */
function streamResponse(chunks: string[], after: 'end' | 'hang' | 'error' = 'end', signal?: AbortSignal) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (after === 'end') controller.close();
      // Error after delivery (erroring synchronously would discard queued chunks).
      if (after === 'error') setTimeout(() => controller.error(new Error('socket reset')), 5);
      if (after === 'hang') signal?.addEventListener('abort', () => {
        const e = new Error('This operation was aborted'); e.name = 'AbortError'; controller.error(e);
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function fakeStreamNim(route: (model: string, signal: AbortSignal) => Response | 'hang' | number) {
  const models: string[] = [];
  const impl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    models.push(body.model);
    assert.equal(body.stream, true);
    const r = route(body.model, init.signal);
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => {
        const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e);
      }));
    }
    if (typeof r === 'number') return new Response('x', { status: r });
    return r;
  }) as unknown as typeof fetch;
  return { impl, models };
}

test('visibleSoFar hides reasoning and holds back a partial <think> tag', () => {
  assert.equal(visibleSoFar('<think>plan</think>\nAnswer'), 'Answer');
  assert.equal(visibleSoFar('<think>still planning'), '');
  assert.equal(visibleSoFar('Answer so far <thi'), 'Answer so far ');
  assert.equal(visibleSoFar('a < b'), 'a < b');
});

test('streams visible deltas in order and returns the full answer', async () => {
  const nim = fakeStreamNim(() => streamResponse([sse(['<think>hmm', '</think>', 'KD-trees ', 'split ', 'space.'])]));
  const c = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: nim.impl });
  const deltas: string[] = [];
  const r = await c.chatStream(msgs, {}, { onDelta: d => deltas.push(d) });
  assert.equal(r.text, 'KD-trees split space.');
  assert.equal(deltas.join(''), r.text);
  assert.ok(!deltas.join('').includes('hmm'));
  assert.equal(r.model, 'm1');
});

test('handles SSE lines split across network chunks', async () => {
  const whole = sse(['Hello', ' world']);
  const nim = fakeStreamNim(() => streamResponse([whole.slice(0, 17), whole.slice(17, 40), whole.slice(40)]));
  const c = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: nim.impl });
  const deltas: string[] = [];
  assert.equal((await c.chatStream(msgs, {}, { onDelta: d => deltas.push(d) })).text, 'Hello world');
});

test('fails over before the first token: retired model, then a model that never answers', async () => {
  const nim = fakeStreamNim(model =>
    model === 'gone' ? 410 : model === 'silent' ? 'hang' : streamResponse([sse(['ok'])]));
  const c = createNimChat({ apiKey: 'k', models: ['gone', 'silent', 'good'], isProduction: true, fetchImpl: nim.impl });
  const r = await c.chatStream(msgs, { timeoutMs: 20 }, { onDelta: () => {} });
  assert.equal(r.text, 'ok');
  assert.deepEqual(nim.models, ['gone', 'silent', 'good']);
  // Both failures are remembered: the next call goes straight to the good model.
  await c.chatStream(msgs, { timeoutMs: 20 }, { onDelta: () => {} });
  assert.deepEqual(nim.models.slice(3), ['good']);
});

test('a model that sends only reasoning and then stalls counts as no answer and fails over', async () => {
  const nim = fakeStreamNim((model, signal) =>
    model === 'thinker' ? streamResponse([sse(['<think>forever']).replace('data: [DONE]\n\n', '')], 'hang', signal)
                        : streamResponse([sse(['ok'])]));
  const c = createNimChat({ apiKey: 'k', models: ['thinker', 'good'], isProduction: true, fetchImpl: nim.impl });
  assert.equal((await c.chatStream(msgs, { timeoutMs: 20 }, { onDelta: () => {} })).text, 'ok');
});

test('after the first visible token, errors propagate instead of switching models mid-answer', async () => {
  const partial = sse(['Partial ']).replace('data: [DONE]\n\n', '');
  const nim = fakeStreamNim(() => streamResponse([partial], 'error'));
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: nim.impl });
  const deltas: string[] = [];
  await assert.rejects(c.chatStream(msgs, {}, { onDelta: d => deltas.push(d) }), /socket reset/);
  assert.deepEqual(deltas, ['Partial ']);
  assert.deepEqual(nim.models, ['m1']);
});

test('a caller abort (user closed the chat) stops the stream without failover', async () => {
  const outer = new AbortController();
  const nim = fakeStreamNim((_m, signal) => {
    setTimeout(() => outer.abort(), 5);
    return streamResponse([sse(['Start ']).replace('data: [DONE]\n\n', '')], 'hang', signal);
  });
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: nim.impl });
  await assert.rejects(c.chatStream(msgs, {}, { onDelta: () => {}, signal: outer.signal }), (e: unknown) => e instanceof ChatAborted);
  assert.deepEqual(nim.models, ['m1']);
});

test('a model NVIDIA reports as DEGRADED fails over to the next one', async () => {
  const nim = fakeNim(model => model === 'a/degraded'
    ? [400, { status: 400, title: 'Bad Request', detail: "Function id '48c6': DEGRADED function cannot be invoked" }]
    : [200, answer('fine')]);
  const c = createNimChat({ apiKey: 'k', models: ['a/degraded', 'b/ok'], isProduction: true, fetchImpl: nim.impl });
  assert.equal(await c.chat(msgs), 'fine');
  assert.deepEqual(nim.chatCalls().map(x => x.body.model), ['a/degraded', 'b/ok']);
});

test('ordinary 400s are still real errors, not failover', () => {
  assert.ok(isDegradedModelResponse(400, '{"detail":"Function id \'x\': DEGRADED function cannot be invoked"}'));
  assert.ok(!isDegradedModelResponse(400, '{"detail":"max_tokens must be positive"}'));
  assert.ok(!isDegradedModelResponse(503, 'DEGRADED'));
});

// ── Paid Claude fallback ─────────────────────────────────────────────────────

const claude = { apiKey: 'ck', model: 'claude-haiku-5-5' };

/** fetch stub that answers NVIDIA by `nim(model)` and Anthropic by `anth(body)`. */
function twoProviders(nim: (model: string) => [number, unknown] | 'hang', anth: (body: any) => [number, unknown]) {
  const calls: { host: string; model: string; headers: any; body: any }[] = [];
  const impl = (async (url: string, init: any) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ host: u.host, model: body?.model, headers: init.headers, body });
    const r = u.host === 'api.anthropic.com' ? anth(body) : nim(body.model);
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => {
        const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e);
      }));
    }
    const [status, payload] = r;
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const claudeAnswer = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 4 } });

test('claudeFallbackFromEnv: off without a key; CLAUDE_API or ANTHROPIC_API_KEY; model override', () => {
  assert.equal(claudeFallbackFromEnv({}), null);
  assert.equal(claudeFallbackFromEnv({ CLAUDE_API: '  ' }), null);
  assert.deepEqual(claudeFallbackFromEnv({ CLAUDE_API: 'k' }), { apiKey: 'k', model: DEFAULT_CLAUDE_MODEL });
  assert.deepEqual(claudeFallbackFromEnv({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-sonnet-5-5' }), { apiKey: 'k', model: 'claude-sonnet-5-5' });
});

test('toClaudeMessages: system lifted out, roles merged, conversation starts with the user', () => {
  assert.deepEqual(toClaudeMessages([
    { role: 'system', content: 'S1' }, { role: 'system', content: 'S2' },
    { role: 'assistant', content: 'Hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
  ]), {
    system: 'S1\n\nS2',
    messages: [{ role: 'user', content: '(continue)' }, { role: 'assistant', content: 'Hi' }, { role: 'user', content: 'a\n\nb' }],
  });
  assert.deepEqual(toClaudeMessages([{ role: 'user', content: 'q' }]), { messages: [{ role: 'user', content: 'q' }] });
});

test('Claude answers only after every NVIDIA model fails, with real token counts, and is not kept as preferred', async () => {
  const usage: any[] = [];
  let nimUp = false;
  const p = twoProviders(m => nimUp ? [200, answer(`ok from ${m}`)] : [503, 'down'], () => [200, claudeAnswer('from claude')]);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: p.impl, claude, onUsage: u => usage.push(u) });
  assert.equal(await c.chat([{ role: 'system', content: 'be brief' }, ...msgs]), 'from claude');
  assert.deepEqual(p.calls.map(x => x.model), ['m1', 'm2', 'claude-haiku-5-5']);
  const req = p.calls[2];
  assert.equal(req.headers['x-api-key'], 'ck');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.body.system, 'be brief');
  assert.equal(usage[0].model, 'anthropic:claude-haiku-5-5');
  assert.equal(usage[0].promptTokens, 30);
  assert.equal(usage[0].estimated, false);
  assert.equal(c.currentModel(), 'm1', 'paid fallback never becomes the default');

  // NVIDIA recovers after its cooldown: the next call goes back to it, not Claude.
  nimUp = true;
  const c2 = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: p.impl, claude });
  assert.equal(await c2.chat(msgs), 'ok from m1');
});

test('slow NVIDIA attempts leave time for Claude inside the deadline', async () => {
  const p = twoProviders(() => 'hang', () => [200, claudeAnswer('rescued')]);
  // 22.5 s deadline with 20 s reserved: NVIDIA may only use the first ~2.5 s.
  const c = createNimChat({ apiKey: 'k', models: ['slow1', 'slow2'], isProduction: true, fetchImpl: p.impl, claude, deadlineMs: 22_500 });
  assert.equal(await c.chat(msgs, { timeoutMs: 100 }), 'rescued');
  assert.deepEqual(p.calls.map(x => x.model), ['slow1', 'slow2', 'claude-haiku-5-5']);

  // With no reserve to spare, NVIDIA is skipped rather than starving Claude.
  const p2 = twoProviders(() => 'hang', () => [200, claudeAnswer('rescued')]);
  const c2 = createNimChat({ apiKey: 'k', models: ['slow1'], isProduction: true, fetchImpl: p2.impl, claude, deadlineMs: 21_000 });
  assert.equal(await c2.chat(msgs, { timeoutMs: 100 }), 'rescued');
  assert.deepEqual(p2.calls.map(x => x.model), ['claude-haiku-5-5']);
});

test('Claude overload (529) is a failure, a bad key disables it, and 400s are real errors', async () => {
  let status = 529;
  const p = twoProviders(() => [404, 'gone'], () => [status, { type: 'error' }]);
  const c = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: p.impl, claude });
  await assert.rejects(c.chat(msgs), /No chat model answered.*anthropic:claude-haiku-5-5/);

  status = 401;
  const c2 = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: p.impl, claude });
  await assert.rejects(c2.chat(msgs), /No chat model answered/);
  const before = p.calls.length;
  await assert.rejects(c2.chat(msgs), /No chat model answered/);
  assert.equal(p.calls.length, before, 'dead model and rejected key are both skipped');

  status = 400;
  const c3 = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: p.impl, claude });
  await assert.rejects(c3.chat(msgs), /Claude 400/);
});

test('probe and discovery never touch Claude, and it stays last', async () => {
  const p = twoProviders(m => m === 'm2' ? [200, answer('ok')] : [503, 'x'], () => [200, claudeAnswer('no')]);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: p.impl, claude });
  const results = await c.probe();
  assert.deepEqual(results.map(r => r.model).sort(), ['m1', 'm2']);
  assert.ok(!p.calls.some(x => x.host === 'api.anthropic.com'));
  assert.equal(c.currentModel(), 'm2');
});

test('with only a Claude key, Claude serves every call', async () => {
  const p = twoProviders(() => [500, 'unused'], () => [200, claudeAnswer('only claude')]);
  const c = createNimChat({ apiKey: undefined, models: ['m1'], isProduction: true, fetchImpl: p.impl, claude });
  assert.equal(await c.chat(msgs), 'only claude');
  assert.ok(p.calls.every(x => x.host === 'api.anthropic.com'));
});

test('Claude streaming: text deltas in order, real token counts, mid-stream error after text propagates', async () => {
  const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
  const okStream = [
    ev({ type: 'message_start', message: { usage: { input_tokens: 50 } } }),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'KD-trees ' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'split space.' } }),
    ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } }),
    ev({ type: 'message_stop' }),
  ].join('');
  const usage: any[] = [];
  let mode: 'ok' | 'overloaded' | 'broken' = 'ok';
  const impl = (async (url: string, init: any) => {
    if (new URL(url).host !== 'api.anthropic.com') return new Response('x', { status: 503 });
    assert.equal(JSON.parse(init.body).stream, true);
    if (mode === 'overloaded') return streamResponse([ev({ type: 'error', error: { type: 'overloaded_error' } })]);
    if (mode === 'broken') return streamResponse([okStream.split('message_delta')[0].replace(/event: x\ndata: $/, ''), ev({ type: 'error', error: { type: 'api_error' } })]);
    return streamResponse([okStream.slice(0, 90), okStream.slice(90)]);
  }) as unknown as typeof fetch;
  const c = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: impl, claude, onUsage: u => usage.push(u) });
  const deltas: string[] = [];
  const r = await c.chatStream(msgs, {}, { onDelta: d => deltas.push(d) });
  assert.equal(r.text, 'KD-trees split space.');
  assert.equal(deltas.join(''), r.text);
  assert.equal(r.model, 'anthropic:claude-haiku-5-5');
  assert.deepEqual([usage[0].promptTokens, usage[0].completionTokens, usage[0].estimated], [50, 6, false]);

  mode = 'overloaded';
  await assert.rejects(c.chatStream(msgs, {}, { onDelta: () => {} }), /No chat model answered/);
  mode = 'broken';
  const c2 = createNimChat({ apiKey: 'k', models: ['m1'], isProduction: true, fetchImpl: impl, claude });
  await assert.rejects(c2.chatStream(msgs, {}, { onDelta: () => {} }), /stream error \(api_error\)/);
});

// ── NVIDIA rate limits and endpoint ──────────────────────────────────────────

test('retryAfterMs: seconds or HTTP date, bounded, 30 s default', () => {
  const now = Date.UTC(2026, 10, 14, 0, 0, 0);
  assert.equal(retryAfterMs(null, now), 30_000);
  assert.equal(retryAfterMs('12', now), 12_000);
  assert.equal(retryAfterMs('1', now), 5_000, 'at least 5 s');
  assert.equal(retryAfterMs('9999', now), 300_000, 'at most 5 min');
  assert.equal(retryAfterMs(new Date(now + 20_000).toUTCString(), now), 20_000);
});

test('NVIDIA_BASE_URL: default hosted API, trailing slash trimmed, https required', () => {
  assert.equal(nimBaseFromEnv({}), 'https://integrate.api.nvidia.com/v1');
  assert.equal(nimBaseFromEnv({ NVIDIA_BASE_URL: 'https://nim.partner.example/v1/' }), 'https://nim.partner.example/v1');
  assert.equal(nimBaseFromEnv({ NVIDIA_BASE_URL: 'http://localhost:8000/v1' }), 'http://localhost:8000/v1');
  assert.throws(() => nimBaseFromEnv({ NVIDIA_BASE_URL: 'http://nim.example/v1' }), /https/);
  assert.throws(() => nimBaseFromEnv({ NVIDIA_BASE_URL: 'not a url' }));
});

test('NVIDIA 429 pauses every NVIDIA model and Claude answers until Retry-After passes', async () => {
  let t = 1_000_000;
  const p = twoProviders(() => [429, 'Too Many Requests'], () => [200, claudeAnswer('from claude')]);
  // Retry-After header: wrap the stub to add it.
  const impl = (async (url: string, init: any) => {
    const res = await (p.impl as any)(url, init);
    if (res.status !== 429) return res;
    return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '20' } });
  }) as unknown as typeof fetch;
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2', 'm3'], isProduction: true, fetchImpl: impl, claude, now: () => t });
  assert.equal(await c.chat(msgs), 'from claude');
  assert.deepEqual(p.calls.map(x => x.model), ['m1', 'claude-haiku-5-5'], 'other NVIDIA models skipped: the limit is per key');

  t += 10_000;   // still inside Retry-After
  await c.chat(msgs);
  assert.deepEqual(p.calls.slice(2).map(x => x.model), ['claude-haiku-5-5'], 'NVIDIA not even tried while paused');

  t += 15_000;   // past Retry-After: NVIDIA first again
  await c.chat(msgs);
  assert.equal(p.calls[3].model, 'm1');
});

test('without the Claude fallback a 429 is returned, not retried on other NVIDIA models', async () => {
  const p = twoProviders(() => [429, 'Too Many Requests'], () => [500, 'unused']);
  const c = createNimChat({ apiKey: 'k', models: ['m1', 'm2'], isProduction: true, fetchImpl: p.impl });
  await assert.rejects(c.chat(msgs), /429/);
  assert.deepEqual(p.calls.map(x => x.model), ['m1']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNimChat, chatModelsFromEnv, modelRequestExtras, stripReasoning, DEFAULT_CHAT_MODELS, isDegradedModelResponse,
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
  await assert.rejects(c.chat(msgs), /No NVIDIA chat model answered \(tried: m1, m2\).*NVIDIA_CHAT_MODEL/);
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

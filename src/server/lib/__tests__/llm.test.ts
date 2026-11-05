import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNimChat, chatModelsFromEnv, modelRequestExtras, stripReasoning, DEFAULT_CHAT_MODELS,
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

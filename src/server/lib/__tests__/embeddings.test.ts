import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNimEmbedder, embedModelFromEnv, cosineSim, reembedStaleChunks,
  DEFAULT_EMBED_MODEL, DEV_RANDOM_MODEL, EMBED_BATCH_SIZE, Embedder,
} from '../embeddings.js';

type Call = { body: any };

/** fetch stub: `respond` gets the parsed body and returns [status, json|text]. */
function fakeFetch(respond: (body: any, n: number) => [number, unknown]) {
  const calls: Call[] = [];
  const impl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ body });
    const [status, payload] = respond(body, calls.length);
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const vectorsFor = (inputs: string[]) => ({
  // Deliberately out of order: the client must sort by index.
  data: inputs.map((_, i) => ({ index: i, embedding: [i + 1, 0.5] })).reverse(),
});

test('model defaults to the supported NIM model and is overridable by env', () => {
  assert.equal(embedModelFromEnv({}), DEFAULT_EMBED_MODEL);
  assert.equal(embedModelFromEnv({ NVIDIA_EMBED_MODEL: '  nvidia/other  ' }), 'nvidia/other');
  assert.notEqual(DEFAULT_EMBED_MODEL, 'nvidia/nv-embedqa-e5-v5');
});

test('embeds in batches, keeps input order, sends model and input_type', async () => {
  const { impl, calls } = fakeFetch(body => [200, vectorsFor(body.input)]);
  const e = createNimEmbedder({ apiKey: 'k', model: 'm', isProduction: true, fetchImpl: impl });
  const texts = Array.from({ length: EMBED_BATCH_SIZE + 3 }, (_, i) => `t${i}`);
  const out = await e.embed(texts, 'query');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.input.length, EMBED_BATCH_SIZE);
  assert.equal(calls[0].body.model, 'm');
  assert.equal(calls[0].body.input_type, 'query');
  assert.equal(out.length, texts.length);
  assert.deepEqual(out[0], [1, 0.5]);
  assert.deepEqual(out[EMBED_BATCH_SIZE], [1, 0.5]);   // first item of batch 2
  assert.equal(e.model, 'm');
});

test('retries without input_type when the model rejects it, then stops sending it', async () => {
  const { impl, calls } = fakeFetch(body =>
    'input_type' in body ? [400, { detail: 'input_type is not supported' }] : [200, vectorsFor(body.input)]);
  const e = createNimEmbedder({ apiKey: 'k', model: 'm', isProduction: true, fetchImpl: impl });
  assert.equal((await e.embed(['a'])).length, 1);
  assert.equal((await e.embed(['b'])).length, 1);
  assert.deepEqual(calls.map(c => 'input_type' in c.body), [true, false, false]);
});

test('an end-of-life model surfaces as an error, not empty vectors', async () => {
  const { impl } = fakeFetch(() => [410, { title: 'Gone', detail: 'reached its end of life' }]);
  const e = createNimEmbedder({ apiKey: 'k', model: 'old', isProduction: true, fetchImpl: impl });
  await assert.rejects(e.embed(['a']), /NVIDIA Embed 410/);
});

test('rejects short or malformed responses', async () => {
  const short = fakeFetch(() => [200, { data: [] }]);
  const e1 = createNimEmbedder({ apiKey: 'k', model: 'm', isProduction: true, fetchImpl: short.impl });
  await assert.rejects(e1.embed(['a']), /0 vectors for 1 inputs/);
  const bad = fakeFetch(() => [200, { data: [{ index: 0, embedding: ['x'] }] }]);
  const e2 = createNimEmbedder({ apiKey: 'k', model: 'm', isProduction: true, fetchImpl: bad.impl });
  await assert.rejects(e2.embed(['a']), /malformed vector/);
});

test('without a key: production fails, development tags vectors as dev-random', async () => {
  const prod = createNimEmbedder({ apiKey: undefined, model: 'm', isProduction: true });
  await assert.rejects(prod.embed(['a']), /NVIDIA_API_KEY is not set/);
  const dev = createNimEmbedder({ apiKey: undefined, model: 'm', isProduction: false });
  assert.equal(dev.model, DEV_RANDOM_MODEL);
  assert.equal((await dev.embed(['a', 'b'])).length, 2);
});

test('cosine similarity never compares vectors of different dimensions', () => {
  assert.ok(Math.abs(cosineSim([1, 0], [1, 0]) - 1) < 1e-6);
  assert.equal(cosineSim([1, 0], [1, 0, 0]), -1);
  assert.equal(cosineSim([], []), -1);
});

// ── reembedStaleChunks against an in-memory note_chunks table ────────────────
function fakePool(rows: { id: number; chunk_text: string; embedding_model: string | null; embedding?: string }[],
                  { lockFree = true } = {}) {
  let released = 0;
  const client = {
    async query(sql: string, p: any[] = []) {
      const s = sql.replace(/\s+/g, ' ');
      if (s.includes('pg_try_advisory_lock')) return { rows: [{ ok: lockFree }] };
      if (s.includes('pg_advisory_unlock')) return { rows: [{}] };
      if (s.startsWith('SELECT id, chunk_text FROM note_chunks')) {
        const stale = rows.filter(r => r.embedding_model !== p[0] && r.chunk_text).slice(0, p[1]);
        return { rows: stale.map(r => ({ id: r.id, chunk_text: r.chunk_text })) };
      }
      if (s.startsWith('UPDATE note_chunks')) {
        const [model, ids, embs] = p;
        ids.forEach((id: number, i: number) => {
          const r = rows.find(x => x.id === id)!;
          r.embedding_model = model; r.embedding = embs[i];
        });
        return { rows: [], rowCount: ids.length };
      }
      throw new Error(`unexpected query: ${s}`);
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client } as any, released: () => released };
}

const fakeEmbedder = (model: string, fail = false): Embedder & { calls: number } => ({
  model, calls: 0,
  async embed(texts) {
    this.calls++;
    if (fail) throw new Error('NVIDIA Embed 500');
    return texts.map(() => [1, 2, 3]);
  },
});

test('re-embeds only stale chunks, in batches, and is a no-op once current', async () => {
  const rows = Array.from({ length: EMBED_BATCH_SIZE + 5 }, (_, i) => ({
    id: i + 1, chunk_text: `c${i}`, embedding_model: i < 3 ? 'new' : 'nvidia/nv-embedqa-e5-v5',
  }));
  rows.push({ id: 999, chunk_text: '', embedding_model: null });   // empty text is skipped
  const { pool, released } = fakePool(rows);
  const emb = fakeEmbedder('new');
  assert.equal(await reembedStaleChunks(pool, emb), EMBED_BATCH_SIZE + 2);
  assert.equal(emb.calls, 2);
  assert.ok(rows.filter(r => r.chunk_text).every(r => r.embedding_model === 'new'));
  assert.equal(await reembedStaleChunks(pool, emb), 0);
  assert.equal(released(), 2);
});

test('re-embed respects the per-run cap, the advisory lock, and never throws', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, chunk_text: `c${i}`, embedding_model: null }));
  assert.equal(await reembedStaleChunks(fakePool(rows).pool, fakeEmbedder('new'), 4), 4);

  const locked = fakePool(rows.map(r => ({ ...r, embedding_model: null })), { lockFree: false });
  assert.equal(await reembedStaleChunks(locked.pool, fakeEmbedder('new')), 0);
  assert.equal(locked.released(), 1);

  const failing = fakePool(rows.map(r => ({ ...r, embedding_model: null })));
  assert.equal(await reembedStaleChunks(failing.pool, fakeEmbedder('new', true)), 0);
  assert.equal(failing.released(), 1);
});

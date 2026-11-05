/**
 * embeddings.ts — NVIDIA NIM text embeddings and stale-chunk re-embedding.
 *
 * Every stored chunk records the model that produced its vector
 * (note_chunks.embedding_model). Vectors from different models live in
 * different spaces, so retrieval only compares chunks embedded by the
 * current model, and reembedStaleChunks() brings older chunks up to date.
 * Switching models (e.g. after an NVIDIA end-of-life notice) is therefore a
 * config change: set NVIDIA_EMBED_MODEL and redeploy.
 */

import type pkg from 'pg';
import { log, errorFields } from './log.js';

type Pool = InstanceType<typeof pkg.Pool>;

// nv-embedqa-e5-v5 reached end of life on 2026-08-25 (HTTP 410).
export const DEFAULT_EMBED_MODEL = 'nvidia/nemotron-3-embed-1b';
export const EMBED_BATCH_SIZE    = 32;
const NIM_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';

/** Model tag for development vectors, so a later real key re-embeds them. */
export const DEV_RANDOM_MODEL = 'dev-random';

export type InputType = 'passage' | 'query';

export interface Embedder {
  /** Tag stored in note_chunks.embedding_model for vectors from this embedder. */
  readonly model: string;
  embed(texts: string[], inputType?: InputType): Promise<number[][]>;
}

export function embedModelFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.NVIDIA_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;
}

interface EmbedderOptions {
  apiKey: string | undefined;
  model: string;
  isProduction: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createNimEmbedder(opts: EmbedderOptions): Embedder {
  const doFetch = opts.fetchImpl ?? fetch;

  if (!opts.apiKey) {
    return {
      model: DEV_RANDOM_MODEL,
      async embed(texts) {
        // Random vectors would silently corrupt retrieval, so production
        // fails loudly instead.
        if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot generate embeddings');
        return texts.map(() => Array.from({ length: 384 }, () => Math.random() - 0.5));
      },
    };
  }

  // Asymmetric retrieval models want input_type; a model that rejects it is
  // detected on the first 400 and the field is dropped from then on.
  let sendInputType = true;

  async function post(batch: string[], inputType: InputType) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45000);
    try {
      return await doFetch(NIM_EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          input: batch,
          encoding_format: 'float',
          truncate: 'END',
          ...(sendInputType ? { input_type: inputType } : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function embedBatch(batch: string[], inputType: InputType): Promise<number[][]> {
    let res = await post(batch, inputType);
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && sendInputType && /input_type/i.test(body)) {
        sendInputType = false;
        log.warn('embedding model rejects input_type; retrying without it', { model: opts.model });
        res = await post(batch, inputType);
        if (!res.ok) throw await embedError(res);
      } else {
        log.error('nim embed request failed', { status: res.status, model: opts.model });
        throw new Error(`NVIDIA Embed ${res.status}: ${body.slice(0, 300)}`);
      }
    }
    const data = await res.json() as { data?: { index?: number; embedding?: unknown }[] };
    const items = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (items.length !== batch.length) {
      throw new Error(`NVIDIA Embed returned ${items.length} vectors for ${batch.length} inputs`);
    }
    return items.map(item => {
      const v = item.embedding;
      if (!Array.isArray(v) || v.length === 0 || !v.every(x => typeof x === 'number' && Number.isFinite(x))) {
        throw new Error('NVIDIA Embed returned a malformed vector');
      }
      return v as number[];
    });
  }

  async function embedError(res: Response) {
    const body = await res.text();
    log.error('nim embed request failed', { status: res.status, model: opts.model });
    return new Error(`NVIDIA Embed ${res.status}: ${body.slice(0, 300)}`);
  }

  return {
    model: opts.model,
    async embed(texts, inputType = 'passage') {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        out.push(...await embedBatch(texts.slice(i, i + EMBED_BATCH_SIZE), inputType));
      }
      return out;
    },
  };
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

let reembedRunning = false;
const REEMBED_LOCK = 'learnit.reembed_stale_chunks';

/**
 * Re-embed chunks whose vectors came from a different model. Idempotent and
 * safe to call on every startup / cron tick: a no-op once everything is
 * current, guarded against overlap in-process and across instances by an
 * advisory lock, and capped per run to bound API cost.
 *
 * Returns the number of chunks re-embedded.
 */
export async function reembedStaleChunks(pool: Pool, embedder: Embedder, maxChunks = 2000): Promise<number> {
  if (reembedRunning) return 0;
  reembedRunning = true;
  const client = await pool.connect();
  let done = 0;
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [REEMBED_LOCK]);
    if (!lock?.ok) return 0;
    try {
      while (done < maxChunks) {
        const { rows } = await client.query(
          `SELECT id, chunk_text FROM note_chunks
           WHERE embedding_model IS DISTINCT FROM $1 AND coalesce(chunk_text, '') <> ''
           ORDER BY id
           LIMIT $2`,
          [embedder.model, Math.min(EMBED_BATCH_SIZE, maxChunks - done)]
        );
        if (!rows.length) break;
        const vectors = await embedder.embed(rows.map((r: any) => r.chunk_text), 'passage');
        await client.query(
          `UPDATE note_chunks nc
           SET embedding = v.embedding, embedding_model = $1
           FROM unnest($2::int[], $3::text[]) AS v(id, embedding)
           WHERE nc.id = v.id`,
          [embedder.model, rows.map((r: any) => r.id), vectors.map(v => JSON.stringify(v))]
        );
        done += rows.length;
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [REEMBED_LOCK]);
    }
    if (done) log.info('re-embedded stale chunks', { count: done, model: embedder.model });
    return done;
  } catch (err) {
    log.error('re-embedding stale chunks failed (non-fatal)', { done, model: embedder.model, ...errorFields(err) });
    return done;
  } finally {
    client.release();
    reembedRunning = false;
  }
}

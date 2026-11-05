/**
 * llm.ts — NVIDIA NIM chat completions with model failover.
 *
 * NVIDIA retires hosted models with little notice (meta/llama-3.3-70b-instruct
 * returned HTTP 410 from 2026-08-26) and availability differs by account. So
 * instead of one hard-coded id:
 *
 *  - candidates = NVIDIA_CHAT_MODEL (if set), then DEFAULT_CHAT_MODELS;
 *  - at startup, GET /v1/models (no inference cost) drops candidates the key
 *    cannot see;
 *  - at startup, probe() sends each remaining candidate one tiny prompt and
 *    keeps only those that answer, in preference order (a model can be listed
 *    yet never respond: nemotron-3-super timed out at 60 s on 2026-11-05);
 *  - at call time a 404/410 marks the model dead; a timeout or 5xx benches it
 *    for COOLDOWN_MS; either way the call moves to the next candidate within
 *    an overall deadline. 429 (rate limit) never switches models.
 *
 * Reasoning models spend max_tokens on hidden reasoning, so each known model
 * gets the request fields that keep its answer short and visible.
 */

import { log } from './log.js';

const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

/** Preference order; quality first, then availability. Verify with GET /v1/models. */
export const DEFAULT_CHAT_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b',
  'openai/gpt-oss-20b',
  'nvidia/nemotron-3-ultra-550b-a55b',
];

export interface ChatMessage { role: string; content: string }
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Per-model attempt timeout (default ATTEMPT_TIMEOUT_MS). */
  timeoutMs?: number;
}

export const ATTEMPT_TIMEOUT_MS = 25_000;
export const CALL_DEADLINE_MS   = 50_000;
export const COOLDOWN_MS        = 10 * 60_000;
export type ChatFn = (messages: ChatMessage[], opts?: ChatOptions) => Promise<string>;

export interface StreamHandlers {
  /** Called with each new piece of visible answer text, in order. */
  onDelta(text: string): void;
  /** Aborts the upstream request (e.g. the user closed the chat). */
  signal?: AbortSignal;
}
export interface StreamResult { model: string; text: string }

/** Idle gap allowed between chunks once an answer has started streaming. */
export const STREAM_IDLE_MS = 30_000;

export interface ChatClient {
  chat: ChatFn;
  /**
   * Streaming chat. Fails over like chat() until the first visible token;
   * after that the answer is committed to that model and errors propagate.
   */
  chatStream(messages: ChatMessage[], opts: ChatOptions, handlers: StreamHandlers): Promise<StreamResult>;
  /** Narrow the candidates to models listed for this key. Safe to skip or fail. */
  discover(): Promise<string[]>;
  /** Send each candidate a tiny prompt; keep responders first, in preference order. */
  probe(): Promise<ProbeResult[]>;
  /** Model currently preferred (the last one that answered, else the first live candidate). */
  currentModel(): string | null;
}

export function chatModelsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.NVIDIA_CHAT_MODEL?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  return [...new Set([...override, ...DEFAULT_CHAT_MODELS])];
}

/** Extra request fields per model family (unknown fields can be rejected, so only where needed). */
export function modelRequestExtras(model: string): Record<string, unknown> {
  if (model.startsWith('nvidia/nemotron-3')) return { chat_template_kwargs: { enable_thinking: false } };
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low' };
  return {};
}

/** Some models inline their reasoning; never show it to users. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export interface ProbeResult { model: string; ok: boolean; ms: number; error?: string }

/** The model cannot serve this call; `permanent` = retired (404/410). */
/**
 * The visible part of a partially streamed answer: complete <think> blocks
 * removed, anything after an unclosed <think> withheld, and a trailing
 * partial "<think" tag held back until the next chunk decides it.
 */
export function visibleSoFar(full: string): string {
  let out = full.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open !== -1) out = out.slice(0, open);
  for (let k = Math.min('<think>'.length - 1, out.length); k > 0; k--) {
    if ('<think>'.startsWith(out.slice(-k).toLowerCase())) { out = out.slice(0, -k); break; }
  }
  return out.replace(/^\s+/, '');
}

/** Thrown when the caller aborted (client disconnected); never retried. */
export class ChatAborted extends Error {
  constructor() { super('chat aborted by caller'); this.name = 'ChatAborted'; }
}

class ModelUnavailable extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message); }
}

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

interface ChatClientOptions {
  apiKey: string | undefined;
  models: string[];
  isProduction: boolean;
  fetchImpl?: typeof fetch;
  /** Overall budget for one chat() call across failovers. */
  deadlineMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export function createNimChat(opts: ChatClientOptions): ChatClient {
  const doFetch = opts.fetchImpl ?? fetch;
  let candidates = [...opts.models];
  const dead = new Set<string>();
  const benchedUntil = new Map<string, number>();
  const now = opts.now ?? Date.now;
  let preferred: string | null = null;

  async function request(path: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(`${NIM_BASE}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function callModel(model: string, messages: ChatMessage[], o: ChatOptions, timeoutMs: number): Promise<string> {
    let res: Response;
    try {
      res = await request('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages,
          temperature: o.temperature ?? 0.4,
          max_tokens: o.maxTokens ?? 1024,
          ...modelRequestExtras(model),
        }),
      }, timeoutMs);
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new ModelUnavailable(`${model} timed out after ${timeoutMs} ms`, false);
      throw err;
    }
    if (res.status === 404 || res.status === 410) {
      throw new ModelUnavailable(`${model} retired (${res.status})`, true);
    }
    if (TRANSIENT_STATUSES.has(res.status)) {
      await res.text().catch(() => '');
      throw new ModelUnavailable(`${model} failed (${res.status})`, false);
    }
    if (!res.ok) {
      const body = await res.text();
      log.error('nim chat request failed', { status: res.status, model });
      throw new Error(`NVIDIA NIM ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const content = stripReasoning(choice?.message?.content ?? '');
    if (!content) {
      // Reasoning used the whole budget, or the model returned nothing usable.
      log.error('nim chat returned no content', { model, finishReason: choice?.finish_reason });
      throw new Error(`NVIDIA NIM returned an empty answer (${choice?.finish_reason ?? 'unknown'})`);
    }
    return content;
  }

  /** Live candidates: preferred first, then preference order; benched models last. */
  function attemptOrder(): string[] {
    const live = [preferred, ...candidates]
      .filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !dead.has(m));
    const t = now();
    const ready   = live.filter(m => (benchedUntil.get(m) ?? 0) <= t);
    const benched = live.filter(m => (benchedUntil.get(m) ?? 0) > t);
    return [...ready, ...benched];   // benched ones only if nothing else answers
  }

  function markUnavailable(model: string, err: ModelUnavailable) {
    if (err.permanent) dead.add(model);
    else benchedUntil.set(model, now() + COOLDOWN_MS);
    if (preferred === model) preferred = null;
    log.warn('chat model unavailable; trying next', { model, reason: err.message, permanent: err.permanent });
  }

  const chat: ChatFn = async (messages, o = {}) => {
    if (!opts.apiKey) {
      if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot call the chat model');
      return '[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.';
    }
    // Long generations (grading, roadmaps) get a longer attempt; keep room for one fallback.
    const attemptMs = o.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const deadline = now() + (opts.deadlineMs ?? Math.max(CALL_DEADLINE_MS, attemptMs + ATTEMPT_TIMEOUT_MS));
    const order = attemptOrder();
    const tried: string[] = [];
    for (const model of order) {
      const remaining = deadline - now();
      if (remaining < 2_000) break;
      tried.push(model);
      try {
        const answer = await callModel(model, messages, o, Math.min(attemptMs, remaining));
        if (preferred !== model) log.info('chat model selected', { model });
        preferred = model;
        benchedUntil.delete(model);
        return answer;
      } catch (err) {
        if (!(err instanceof ModelUnavailable)) throw err;
        markUnavailable(model, err);
      }
    }
    throw new Error(`No NVIDIA chat model answered (tried: ${tried.join(', ') || 'none'}). Set NVIDIA_CHAT_MODEL.`);
  };

  async function streamModel(
    model: string, messages: ChatMessage[], o: ChatOptions, firstTokenMs: number, h: StreamHandlers,
  ): Promise<StreamResult> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    h.signal?.addEventListener('abort', onOuterAbort, { once: true });
    let started = false;
    let timer = setTimeout(() => controller.abort(), firstTokenMs);
    const fail = (err: any): never => {
      if (h.signal?.aborted) throw new ChatAborted();
      if (err?.name === 'AbortError') {
        if (!started) throw new ModelUnavailable(`${model} gave no answer within ${firstTokenMs} ms`, false);
        throw new Error(`NVIDIA NIM stream from ${model} stalled`);
      }
      throw err;
    };
    try {
      let res: Response;
      try {
        res = await doFetch(`${NIM_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: o.temperature ?? 0.4,
            max_tokens: o.maxTokens ?? 1024,
            stream: true,
            ...modelRequestExtras(model),
          }),
          signal: controller.signal,
        });
      } catch (err) { return fail(err); }
      if (res.status === 404 || res.status === 410) throw new ModelUnavailable(`${model} retired (${res.status})`, true);
      if (TRANSIENT_STATUSES.has(res.status)) {
        await res.text().catch(() => '');
        throw new ModelUnavailable(`${model} failed (${res.status})`, false);
      }
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        log.error('nim chat stream request failed', { status: res.status, model });
        throw new Error(`NVIDIA NIM ${res.status}: ${body.slice(0, 300)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', full = '', emitted = '', finished = false;
      const emit = (visible: string) => {
        if (visible.length > emitted.length && visible.startsWith(emitted)) {
          const piece = visible.slice(emitted.length);
          emitted = visible;
          if (!started) started = true;
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
          h.onDelta(piece);
        }
      };
      while (!finished) {
        const chunk = await reader.read().catch((err: unknown) => fail(err));
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { finished = true; break; }
          let event: any;
          try { event = JSON.parse(payload); } catch { continue; }
          const piece = event.choices?.[0]?.delta?.content;
          if (typeof piece === 'string' && piece) {
            full += piece;
            emit(visibleSoFar(full));
          }
        }
      }
      if (finished) await reader.cancel().catch(() => {});
      const text = stripReasoning(full);
      emit(text);   // flush anything held back (e.g. a literal trailing "<")
      if (!text) {
        log.error('nim chat stream returned no content', { model });
        throw new Error('NVIDIA NIM returned an empty answer');
      }
      return { model, text };
    } finally {
      clearTimeout(timer);
      h.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  async function chatStream(messages: ChatMessage[], o: ChatOptions, h: StreamHandlers): Promise<StreamResult> {
    if (!opts.apiKey) {
      if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot call the chat model');
      const mock = '[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.';
      h.onDelta(mock);
      return { model: 'mock', text: mock };
    }
    const attemptMs = o.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const deadline = now() + (opts.deadlineMs ?? Math.max(CALL_DEADLINE_MS, attemptMs + ATTEMPT_TIMEOUT_MS));
    const tried: string[] = [];
    for (const model of attemptOrder()) {
      const remaining = deadline - now();
      if (remaining < 2_000) break;
      tried.push(model);
      try {
        const result = await streamModel(model, messages, o, Math.min(attemptMs, remaining), h);
        if (preferred !== model) log.info('chat model selected', { model });
        preferred = model;
        benchedUntil.delete(model);
        return result;
      } catch (err) {
        // Only a model that produced nothing visible can be replaced.
        if (!(err instanceof ModelUnavailable)) throw err;
        markUnavailable(model, err);
      }
    }
    throw new Error(`No NVIDIA chat model answered (tried: ${tried.join(', ') || 'none'}). Set NVIDIA_CHAT_MODEL.`);
  }

  async function probe(): Promise<ProbeResult[]> {
    if (!opts.apiKey) return [];
    const ping: ChatMessage[] = [{ role: 'user', content: 'Reply with the single word: ok' }];
    const results = await Promise.all(candidates.filter(m => !dead.has(m)).map(async (model): Promise<ProbeResult> => {
      const start = now();
      try {
        await callModel(model, ping, { temperature: 0, maxTokens: 128 }, ATTEMPT_TIMEOUT_MS);
        return { model, ok: true, ms: now() - start };
      } catch (err: any) {
        if (err instanceof ModelUnavailable) markUnavailable(model, err);
        return { model, ok: false, ms: now() - start, error: String(err?.message ?? err).slice(0, 120) };
      }
    }));
    const ok = new Set(results.filter(r => r.ok).map(r => r.model));
    if (ok.size) {
      // Responders keep their preference order; the rest stay as fallbacks.
      candidates = [...candidates.filter(m => ok.has(m)), ...candidates.filter(m => !ok.has(m))];
      preferred = candidates[0];
      for (const m of ok) benchedUntil.delete(m);
      log.info('chat model probe', { selected: preferred, results });
    } else {
      log.error('chat model probe: no candidate answered', { results });
    }
    return results;
  }

  async function discover(): Promise<string[]> {
    if (!opts.apiKey) return candidates;
    try {
      const res = await request('/models', { method: 'GET' }, 15000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data?: { id?: string }[] };
      const listed = new Set((data.data ?? []).map(m => m.id).filter(Boolean));
      const available = candidates.filter(m => listed.has(m));
      if (available.length) {
        candidates = available;
        log.info('chat models available', { models: available });
      } else {
        log.error('none of the configured chat models are listed for this key', { configured: candidates });
      }
    } catch (err: any) {
      // Discovery is advisory: keep all candidates and rely on call-time failover.
      log.warn('chat model discovery failed', { reason: err?.message });
    }
    return candidates;
  }

  return {
    chat,
    chatStream,
    discover,
    probe,
    currentModel: () => preferred ?? candidates.find(m => !dead.has(m)) ?? null,
  };
}

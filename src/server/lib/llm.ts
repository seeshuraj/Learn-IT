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
 *    an overall deadline. A 429 never switches to another NVIDIA model (the
 *    limit is per key, shared by every model); with the Claude fallback
 *    configured, NVIDIA is paused for the Retry-After window and Claude
 *    answers instead, otherwise the 429 is returned.
 *  - NVIDIA_BASE_URL points chat (and embeddings) at a partner or self-hosted
 *    NIM endpoint with the same OpenAI-compatible API; default is the hosted
 *    build.nvidia.com API (about 40 requests/minute per key).
 *
 * Reasoning models spend max_tokens on hidden reasoning, so each known model
 * gets the request fields that keep its answer short and visible.
 *
 * Paid fallback: when CLAUDE_API (or ANTHROPIC_API_KEY) is set, Claude is the
 * last candidate. It is only called when no NVIDIA model is ready, gets a
 * reserved slice of each call's deadline so slow NVIDIA attempts can't starve
 * it, and never becomes the preferred model, so the next call goes back to
 * NVIDIA first. It is not probed at startup (that would cost money).
 */

import { log } from './log.js';

/** OpenAI-compatible NVIDIA endpoint: hosted API by default, or a partner / self-hosted NIM. */
export function nimBaseFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.NVIDIA_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return 'https://integrate.api.nvidia.com/v1';
  const url = new URL(raw);   // throws on a malformed value at startup, not per request
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('NVIDIA_BASE_URL must use https');
  }
  return raw;
}
const NIM_BASE = nimBaseFromEnv();
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

/** Candidate ids for the paid fallback carry this prefix; everything else is NVIDIA. */
export const CLAUDE_PREFIX = 'anthropic:';
/** Cheapest current Claude tier; override with CLAUDE_MODEL. */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';
/** Part of each call's deadline kept back for the paid fallback. */
export const FALLBACK_RESERVE_MS = 20_000;

export const isClaudeModel = (model: string) => model.startsWith(CLAUDE_PREFIX);

export interface ClaudeFallback { apiKey: string; model: string }

/** CLAUDE_API (or ANTHROPIC_API_KEY) enables the fallback; CLAUDE_MODEL picks the model. */
export function claudeFallbackFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeFallback | null {
  const apiKey = (env.CLAUDE_API || env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return null;
  return { apiKey, model: (env.CLAUDE_MODEL || '').trim() || DEFAULT_CLAUDE_MODEL };
}

/**
 * Claude takes the system prompt separately and wants user/assistant turns
 * that alternate, starting with the user. Consecutive same-role turns are joined.
 */
export function toClaudeMessages(messages: ChatMessage[]): { system?: string; messages: { role: 'user' | 'assistant'; content: string }[] } {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system' || !m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = turns.at(-1);
    if (last && last.role === role) last.content += `\n\n${m.content}`;
    else turns.push({ role, content: m.content });
  }
  if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', content: '(continue)' });
  return { ...(system ? { system } : {}), messages: turns };
}

/**
 * Preference order: fast, inexpensive models first (most traffic is tutoring
 * and short summaries), larger ones as fallbacks. The startup probe moves the
 * ones that actually answer to the front, so a model NVIDIA retires or
 * overloads costs nothing. Verify against GET /v1/models when editing.
 * (2026-11-11: nemotron-3-super and nemotron-nano-3 return 404.)
 */
export const DEFAULT_CHAT_MODELS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'z-ai/glm-5.3-flash',
  'minimaxai/minimax-m3.1-flash',
  'deepseek-ai/deepseek-v4.1-flash',
  'google/gemma-4-31b-it',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'openai/gpt-oss-20b',
];

/**
 * NVIDIA answers 400 with "DEGRADED" (or similar) when a hosted model's
 * function is unhealthy. That is a provider-side outage of that one model,
 * not a bad request, so it should fail over like a 503.
 */
export function isDegradedModelResponse(status: number, body: string): boolean {
  return status === 400 && /DEGRAD|function id .* (is )?(not ready|unavailable|inactive)/i.test(body);
}

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
  constructor(message: string, readonly permanent: boolean, readonly rateLimitedForMs = 0) { super(message); }
}

/** Retry-After in ms (seconds or HTTP date), bounded to 5 s – 5 min; 30 s when absent. */
export function retryAfterMs(header: string | null, nowMs = Date.now()): number {
  let ms = 30_000;
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) ms = secs * 1000;
    else if (!Number.isNaN(Date.parse(header))) ms = Date.parse(header) - nowMs;
  }
  return Math.min(300_000, Math.max(5_000, ms));
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
  /**
   * Runs before every chat()/chatStream() call; throw to refuse the call
   * (e.g. a college's monthly AI allowance is used up). Not run for probes.
   */
  beforeCall?: () => void | Promise<void>;
  /** Reports each finished chat()/chatStream() call, success or failure. */
  onUsage?: (usage: LlmUsage) => void;
  /** Paid last-resort model (see the header comment). */
  claude?: ClaudeFallback | null;
}

export interface LlmUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** True when the provider didn't report token counts and they were estimated from text length. */
  estimated: boolean;
  latencyMs: number;
  status: 'ok' | 'error';
  stream: boolean;
}

/** Rough token count (~4 characters per token) for when the provider reports none. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const promptText = (messages: ChatMessage[]) => messages.map(m => m.content).join('\n');

export function createNimChat(opts: ChatClientOptions): ChatClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const claudeId = opts.claude ? `${CLAUDE_PREFIX}${opts.claude.model}` : null;
  // Without an NVIDIA key only the paid fallback can answer.
  const nimModels = opts.apiKey ? opts.models.filter(m => !isClaudeModel(m)) : [];
  let candidates = [...nimModels, ...(claudeId ? [claudeId] : [])];
  const hasProvider = !!opts.apiKey || !!claudeId;
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

  interface ModelAnswer { content: string; promptTokens?: number; completionTokens?: number }

  /** URL, headers and body for one model; `stream` adds the provider's streaming flag. */
  function buildRequest(model: string, messages: ChatMessage[], o: ChatOptions, stream: boolean): { url: string; headers: Record<string, string>; body: string } {
    if (isClaudeModel(model)) {
      return {
        url: `${ANTHROPIC_BASE}/messages`,
        headers: { 'Content-Type': 'application/json', 'x-api-key': opts.claude!.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({
          model: model.slice(CLAUDE_PREFIX.length),
          ...toClaudeMessages(messages),
          temperature: o.temperature ?? 0.4,
          max_tokens: o.maxTokens ?? 1024,
          ...(stream ? { stream: true } : {}),
        }),
      };
    }
    return {
      url: `${NIM_BASE}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: o.temperature ?? 0.4,
        max_tokens: o.maxTokens ?? 1024,
        ...(stream ? { stream: true } : {}),
        ...modelRequestExtras(model),
      }),
    };
  }

  /**
   * Maps a non-2xx response to failover or a hard error. Claude also fails
   * over on 529 (overloaded) and is dropped for the process on 401/403 (bad
   * key), so a wrong key is one log line rather than an error on every call.
   */
  async function rejectResponse(model: string, res: Response, stream: boolean): Promise<never> {
    const body = await res.text().catch(() => '');
    const claude = isClaudeModel(model);
    if (res.status === 404 || res.status === 410) throw new ModelUnavailable(`${model} retired (${res.status})`, true);
    if (claude && (res.status === 401 || res.status === 403)) {
      log.error('claude fallback rejected the API key; disabled until restart', { status: res.status });
      throw new ModelUnavailable(`${model} key rejected (${res.status})`, true);
    }
    if (!claude && res.status === 429 && opts.claude) {
      // The NVIDIA limit is per key across all models: pause NVIDIA, let Claude answer.
      throw new ModelUnavailable(`${model} rate limited (429)`, false, retryAfterMs(res.headers.get('retry-after'), now()));
    }
    if (TRANSIENT_STATUSES.has(res.status) || (claude && res.status === 529)) {
      throw new ModelUnavailable(`${model} failed (${res.status})`, false);
    }
    if (!claude && isDegradedModelResponse(res.status, body)) throw new ModelUnavailable(`${model} degraded (${res.status})`, false);
    const provider = claude ? 'Claude' : 'NVIDIA NIM';
    log.error(stream ? 'chat stream request failed' : 'chat request failed', { status: res.status, model });
    throw new Error(`${provider} ${res.status}: ${body.slice(0, 300)}`);
  }

  function report(u: Omit<LlmUsage, 'latencyMs'>, start: number) {
    try { opts.onUsage?.({ ...u, latencyMs: now() - start }); }
    catch (e: any) { log.warn('usage hook failed', { reason: e?.message }); }
  }

  async function callModel(model: string, messages: ChatMessage[], o: ChatOptions, timeoutMs: number): Promise<ModelAnswer> {
    const { url, headers, body } = buildRequest(model, messages, o, false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    let data: any;
    try {
      res = await doFetch(url, { method: 'POST', headers, body, signal: controller.signal });
      if (!res.ok) await rejectResponse(model, res, false);
      data = await res.json();
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new ModelUnavailable(`${model} timed out after ${timeoutMs} ms`, false);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (isClaudeModel(model)) {
      const content = (data.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim();
      if (!content) {
        log.error('claude returned no content', { model, stopReason: data.stop_reason });
        throw new Error(`Claude returned an empty answer (${data.stop_reason ?? 'unknown'})`);
      }
      const u = data.usage ?? {};
      return {
        content,
        promptTokens: Number.isFinite(u.input_tokens) ? u.input_tokens : undefined,
        completionTokens: Number.isFinite(u.output_tokens) ? u.output_tokens : undefined,
      };
    }
    const choice = data.choices?.[0];
    const content = stripReasoning(choice?.message?.content ?? '');
    if (!content) {
      // Reasoning used the whole budget, or the model returned nothing usable.
      log.error('nim chat returned no content', { model, finishReason: choice?.finish_reason });
      throw new Error(`NVIDIA NIM returned an empty answer (${choice?.finish_reason ?? 'unknown'})`);
    }
    const usage = data.usage ?? {};
    return {
      content,
      promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : undefined,
      completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : undefined,
    };
  }

  /** Live candidates: preferred first, then preference order; benched models last. */
  /** Until when NVIDIA is paused after a 429 (only used with the Claude fallback). */
  let nimPausedUntil = 0;

  function attemptOrder(): string[] {
    const live = [preferred, ...candidates]
      .filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !dead.has(m));
    const t = now();
    // While NVIDIA is rate limited, don't spend the deadline on it at all.
    if (t < nimPausedUntil && claudeId && !dead.has(claudeId)) return [claudeId];
    const ready   = live.filter(m => (benchedUntil.get(m) ?? 0) <= t);
    const benched = live.filter(m => (benchedUntil.get(m) ?? 0) > t);
    return [...ready, ...benched];   // benched ones only if nothing else answers
  }

  function markUnavailable(model: string, err: ModelUnavailable) {
    if (err.rateLimitedForMs > 0) {
      nimPausedUntil = Math.max(nimPausedUntil, now() + err.rateLimitedForMs);
      log.warn('nvidia rate limited; using paid fallback', { model, pauseMs: err.rateLimitedForMs });
      return;
    }
    if (err.permanent) dead.add(model);
    else benchedUntil.set(model, now() + COOLDOWN_MS);
    if (preferred === model) preferred = null;
    log.warn('chat model unavailable; trying next', { model, reason: err.message, permanent: err.permanent });
  }

  /**
   * Time allowed for one attempt. While the paid fallback is still ahead in
   * the order, NVIDIA attempts leave FALLBACK_RESERVE_MS of the deadline for it.
   * Returns 0 when the attempt should be skipped.
   */
  function attemptBudget(model: string, attemptMs: number, remaining: number, claudeAhead: boolean): number {
    const usable = !isClaudeModel(model) && claudeAhead ? remaining - FALLBACK_RESERVE_MS : remaining;
    return usable < 2_000 ? 0 : Math.min(attemptMs, usable);
  }

  /** The paid fallback answers this call only; NVIDIA stays first for the next one. */
  function noteAnswered(model: string) {
    benchedUntil.delete(model);
    if (isClaudeModel(model)) {
      log.warn('answered by paid fallback; no NVIDIA model was available', { model });
      return;
    }
    if (preferred !== model) log.info('chat model selected', { model });
    preferred = model;
  }

  const noModelError = (tried: string[]) => new Error(
    `No chat model answered (tried: ${tried.join(', ') || 'none'}). Set NVIDIA_CHAT_MODEL${claudeId ? '' : ' or CLAUDE_API'}.`,
  );

  const chat: ChatFn = async (messages, o = {}) => {
    if (!hasProvider) {
      if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot call the chat model');
      return '[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.';
    }
    await opts.beforeCall?.();
    const start = now();
    // Long generations (grading, roadmaps) get a longer attempt; keep room for one fallback.
    const attemptMs = o.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const deadline = start + (opts.deadlineMs ?? Math.max(CALL_DEADLINE_MS, attemptMs + ATTEMPT_TIMEOUT_MS));
    const order = attemptOrder();
    const tried: string[] = [];
    const failed = () => report({
      model: tried.at(-1) ?? 'none', promptTokens: 0, completionTokens: 0, estimated: false, status: 'error', stream: false,
    }, start);
    for (const [i, model] of order.entries()) {
      if (!isClaudeModel(model) && now() < nimPausedUntil) continue;   // 429 earlier in this call
      const remaining = deadline - now();
      if (remaining < 2_000) break;
      const budget = attemptBudget(model, attemptMs, remaining, order.slice(i + 1).some(isClaudeModel));
      if (!budget) continue;
      tried.push(model);
      try {
        const answer = await callModel(model, messages, o, budget);
        noteAnswered(model);
        const estimated = answer.promptTokens === undefined || answer.completionTokens === undefined;
        report({
          model,
          promptTokens: answer.promptTokens ?? estimateTokens(promptText(messages)),
          completionTokens: answer.completionTokens ?? estimateTokens(answer.content),
          estimated, status: 'ok', stream: false,
        }, start);
        return answer.content;
      } catch (err) {
        if (!(err instanceof ModelUnavailable)) { failed(); throw err; }
        markUnavailable(model, err);
      }
    }
    failed();
    throw noModelError(tried);
  };

  async function streamModel(
    model: string, messages: ChatMessage[], o: ChatOptions, firstTokenMs: number, h: StreamHandlers,
  ): Promise<StreamResult & { promptTokens?: number; completionTokens?: number }> {
    const claude = isClaudeModel(model);
    const provider = claude ? 'Claude' : 'NVIDIA NIM';
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    h.signal?.addEventListener('abort', onOuterAbort, { once: true });
    let started = false;
    let timer = setTimeout(() => controller.abort(), firstTokenMs);
    const fail = (err: any): never => {
      if (h.signal?.aborted) throw new ChatAborted();
      if (err?.name === 'AbortError') {
        if (!started) throw new ModelUnavailable(`${model} gave no answer within ${firstTokenMs} ms`, false);
        throw new Error(`${provider} stream from ${model} stalled`);
      }
      throw err;
    };
    try {
      let res: Response;
      const { url, headers, body } = buildRequest(model, messages, o, true);
      try {
        res = await doFetch(url, { method: 'POST', headers, body, signal: controller.signal });
      } catch (err) { return fail(err); }
      if (!res.ok) await rejectResponse(model, res, true);
      if (!res.body) throw new Error(`${provider} returned no stream body`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', full = '', emitted = '', finished = false;
      let promptTokens: number | undefined, completionTokens: number | undefined;
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
          let piece: unknown;
          if (claude) {
            if (event.type === 'message_start') promptTokens = event.message?.usage?.input_tokens;
            else if (event.type === 'message_delta') completionTokens = event.usage?.output_tokens;
            else if (event.type === 'message_stop') { finished = true; break; }
            else if (event.type === 'error') {
              const reason = `${model} stream error (${event.error?.type ?? 'unknown'})`;
              if (!started) throw new ModelUnavailable(reason, false);
              throw new Error(reason);
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') piece = event.delta.text;
          } else {
            piece = event.choices?.[0]?.delta?.content;
          }
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
        log.error('chat stream returned no content', { model });
        throw new Error(`${provider} returned an empty answer`);
      }
      return { model, text, promptTokens, completionTokens };
    } finally {
      clearTimeout(timer);
      h.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  async function chatStream(messages: ChatMessage[], o: ChatOptions, h: StreamHandlers): Promise<StreamResult> {
    if (!hasProvider) {
      if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot call the chat model');
      const mock = '[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.';
      h.onDelta(mock);
      return { model: 'mock', text: mock };
    }
    await opts.beforeCall?.();
    const start = now();
    const attemptMs = o.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const deadline = start + (opts.deadlineMs ?? Math.max(CALL_DEADLINE_MS, attemptMs + ATTEMPT_TIMEOUT_MS));
    const tried: string[] = [];
    // Streams don't carry token counts here, so both sides are estimated from text length.
    const failed = (completion = '') => report({
      model: tried.at(-1) ?? 'none', promptTokens: completion ? estimateTokens(promptText(messages)) : 0,
      completionTokens: estimateTokens(completion), estimated: true, status: 'error', stream: true,
    }, start);
    const order = attemptOrder();
    for (const [i, model] of order.entries()) {
      if (!isClaudeModel(model) && now() < nimPausedUntil) continue;   // 429 earlier in this call
      const remaining = deadline - now();
      if (remaining < 2_000) break;
      const budget = attemptBudget(model, attemptMs, remaining, order.slice(i + 1).some(isClaudeModel));
      if (!budget) continue;
      tried.push(model);
      try {
        const { promptTokens, completionTokens, ...result } = await streamModel(model, messages, o, budget, h);
        noteAnswered(model);
        const counted = Number.isFinite(promptTokens) && Number.isFinite(completionTokens);
        report({
          model,
          promptTokens: counted ? promptTokens! : estimateTokens(promptText(messages)),
          completionTokens: counted ? completionTokens! : estimateTokens(result.text),
          estimated: !counted, status: 'ok', stream: true,
        }, start);
        return result;
      } catch (err) {
        // Only a model that produced nothing visible can be replaced.
        if (!(err instanceof ModelUnavailable)) { failed(); throw err; }
        markUnavailable(model, err);
      }
    }
    failed();
    throw noModelError(tried);
  }

  async function probe(): Promise<ProbeResult[]> {
    if (!opts.apiKey) return [];
    const ping: ChatMessage[] = [{ role: 'user', content: 'Reply with the single word: ok' }];
    // The paid fallback is never probed; it stays last.
    const results = await Promise.all(candidates.filter(m => !dead.has(m) && !isClaudeModel(m)).map(async (model): Promise<ProbeResult> => {
      const start = now();
      try {
        await callModel(model, ping, { temperature: 0, maxTokens: 128 }, ATTEMPT_TIMEOUT_MS);   // not metered
        return { model, ok: true, ms: now() - start };
      } catch (err: any) {
        if (err instanceof ModelUnavailable) markUnavailable(model, err);
        return { model, ok: false, ms: now() - start, error: String(err?.message ?? err).slice(0, 120) };
      }
    }));
    const ok = new Set(results.filter(r => r.ok).map(r => r.model));
    if (ok.size) {
      // Responders keep their preference order; the rest stay as fallbacks.
      const nim = candidates.filter(m => !isClaudeModel(m));
      candidates = [...nim.filter(m => ok.has(m)), ...nim.filter(m => !ok.has(m)), ...(claudeId ? [claudeId] : [])];
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
      const available = candidates.filter(m => !isClaudeModel(m) && listed.has(m));
      if (available.length) {
        candidates = [...available, ...(claudeId ? [claudeId] : [])];
        log.info('chat models available', { models: available, paidFallback: opts.claude?.model ?? null });
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
    currentModel: () => preferred ?? candidates.find(m => !dead.has(m) && !isClaudeModel(m)) ?? candidates.find(m => !dead.has(m)) ?? null,
  };
}

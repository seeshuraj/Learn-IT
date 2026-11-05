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
 *  - at call time a 404/410 marks that model dead and the call moves to the
 *    next candidate; the first model that answers is reused from then on.
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
export interface ChatOptions { temperature?: number; maxTokens?: number }
export type ChatFn = (messages: ChatMessage[], opts?: ChatOptions) => Promise<string>;

export interface ChatClient {
  chat: ChatFn;
  /** Narrow the candidates to models listed for this key. Safe to skip or fail. */
  discover(): Promise<string[]>;
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

class ModelGone extends Error {}

interface ChatClientOptions {
  apiKey: string | undefined;
  models: string[];
  isProduction: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createNimChat(opts: ChatClientOptions): ChatClient {
  const doFetch = opts.fetchImpl ?? fetch;
  let candidates = [...opts.models];
  const dead = new Set<string>();
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

  async function callModel(model: string, messages: ChatMessage[], o: ChatOptions): Promise<string> {
    const res = await request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        temperature: o.temperature ?? 0.4,
        max_tokens: o.maxTokens ?? 1024,
        ...modelRequestExtras(model),
      }),
    }, opts.timeoutMs ?? 60000);
    if (res.status === 404 || res.status === 410) {
      throw new ModelGone(`${model} unavailable (${res.status})`);
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

  const chat: ChatFn = async (messages, o = {}) => {
    if (!opts.apiKey) {
      if (opts.isProduction) throw new Error('NVIDIA_API_KEY is not set; cannot call the chat model');
      return '[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.';
    }
    const order = [preferred, ...candidates].filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !dead.has(m));
    for (const model of order) {
      try {
        const answer = await callModel(model, messages, o);
        if (preferred !== model) log.info('chat model selected', { model });
        preferred = model;
        return answer;
      } catch (err) {
        if (!(err instanceof ModelGone)) throw err;
        dead.add(model);
        if (preferred === model) preferred = null;
        log.warn('chat model retired or unavailable; trying next', { model });
      }
    }
    throw new Error(`No NVIDIA chat model is available (tried: ${order.join(', ') || 'none'}). Set NVIDIA_CHAT_MODEL.`);
  };

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
    discover,
    currentModel: () => preferred ?? candidates.find(m => !dead.has(m)) ?? null,
  };
}

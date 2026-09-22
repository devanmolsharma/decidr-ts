/**
 * How `Client` talks to a model provider.
 *
 * `OllamaBackend` is the only one built in that talks to nothing but a
 * running Ollama server, using nothing beyond the global `fetch` every
 * supported Node version already has. `OpenAIBackend` talks to any
 * OpenAI-compatible `/v1/chat/completions` endpoint the same way, which
 * covers OpenAI itself and most self-hosted or hosted-elsewhere servers
 * that speak the same wire format -- also nothing beyond `fetch`.
 *
 * Both implement the same one-method contract: given the messages for one
 * race, return the model's reply and its logprobs at that position, in one
 * normalized shape (see `Backend.chat`'s docstring). Every other part of
 * this package -- prefix matching, the id hierarchy, calibration -- works
 * purely in terms of that shape and never knows which backend produced it.
 */

import type { ChatMessage, ChatResult } from "./types.js";

/** Bad row, or a backend that could not answer it. */
export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

/** Base class for talking to a model provider. Subclass and implement
 * `chat`; `Client` calls nothing else on a backend. */
export abstract class Backend {
  /** Send `messages`, predicting exactly one token (temperature 0), and
   * return the model's reply and its logprobs at that position.
   *
   * `logprobs` has zero entries if the provider returned no logprob
   * information for this call at all (not the same as an entry whose own
   * `topLogprobs` is empty) -- `Client` treats a truly empty list as "the
   * server didn't support this," and raises a clear error rather than
   * guessing at a decision with no numbers behind it. */
  abstract chat(model: string, messages: ChatMessage[]): Promise<ChatResult>;
}

/** Talks to one Ollama server's `/api/chat`. decidr's only
 * dependency-free path -- the global `fetch`, nothing else. */
export class OllamaBackend extends Backend {
  // Ollama's own cap on this field, checked directly against its source
  // rather than assumed (server/routes.go enforces `> 20` at four call
  // sites, before either of its own backends ever see the request).
  static readonly TOP_LOGPROBS = 20;

  readonly host: string;
  readonly timeoutMs: number;

  constructor(options: { host?: string; timeoutMs?: number } = {}) {
    super();
    this.host = (options.host ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    const body = {
      model,
      messages,
      stream: false,
      // A reasoning preamble would put thinking tokens in the answer slot,
      // so the very next token stops being the decision.
      think: false,
      options: { num_predict: 1, temperature: 0 },
      logprobs: true,
      top_logprobs: OllamaBackend.TOP_LOGPROBS,
    };
    const resp = await this.post("/api/chat", body);
    return {
      content: resp?.message?.content ?? null,
      logprobs: normalizeLogprobs(resp?.logprobs),
    };
  }

  private async post(path: string, body: unknown): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.host}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new DecisionError(`cannot reach Ollama at ${this.host}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = JSON.parse(text)?.error ?? text;
      } catch {
        // not JSON, use the raw text
      }
      throw new DecisionError(`${path} failed (${res.status}): ${detail}`);
    }
    return res.json();
  }
}

/** Talks to any OpenAI-compatible `/v1/chat/completions` endpoint --
 * OpenAI itself, or a self-hosted / hosted-elsewhere server speaking the
 * same wire format. Same dependency-free path as `OllamaBackend`: the
 * global `fetch`, nothing else.
 *
 * **Only some models support `logprobs`.** Most consistently absent from
 * reasoning-focused models (OpenAI's o-series and similar reasoning
 * models elsewhere), present on standard chat models (the GPT-4o family
 * and similar). If `decide()` fails with a "no logprobs" error, a
 * reasoning model is the first thing to check. */
export class OpenAIBackend extends Backend {
  static readonly TOP_LOGPROBS = 20;

  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;

  constructor(options: { apiKey?: string; baseUrl?: string; timeoutMs?: number } = {}) {
    super();
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    const body = {
      model,
      messages,
      max_tokens: 1,
      temperature: 0,
      logprobs: true,
      top_logprobs: OpenAIBackend.TOP_LOGPROBS,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new DecisionError(`cannot reach ${this.baseUrl}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = JSON.parse(text)?.error?.message ?? text;
      } catch {
        // not JSON, use the raw text
      }
      throw new DecisionError(`/chat/completions failed (${res.status}): ${detail}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const entry = choice?.logprobs?.content?.[0];
    return {
      content: choice?.message?.content ?? null,
      logprobs: entry
        ? [
            {
              token: entry.token,
              logprob: entry.logprob,
              topLogprobs: (entry.top_logprobs ?? []).map((t: any) => ({
                token: t.token,
                logprob: t.logprob,
              })),
            },
          ]
        : [],
    };
  }
}

function normalizeLogprobs(raw: any): import("./types.js").LogprobEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: any) => ({
    token: entry.token,
    logprob: entry.logprob,
    topLogprobs: (entry.top_logprobs ?? []).map((t: any) => ({ token: t.token, logprob: t.logprob })),
  }));
}

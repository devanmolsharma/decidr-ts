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

import type { ChatMessage, ContentBlock, ChatResult } from "./types.js";

/** Ollama's `/api/chat` puts text in `content` and takes images separately,
 * as a per-message `images: string[]` of raw base64 (no `data:` prefix, no
 * URLs). It has no video/audio input at all -- those raise. Returns the
 * flattened text content and the collected image list for one message. */
function toOllamaMessage(content: ChatMessage["content"]): { content: string; images?: string[] } {
  if (typeof content === "string") return { content };
  const textParts: string[] = [];
  const images: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "image") {
      images.push(toRawBase64(block));
    } else {
      throw new DecisionError(`OllamaBackend cannot send a "${block.type}" content block -- Ollama's chat API has no ${block.type} input`);
    }
  }
  return images.length > 0 ? { content: textParts.join(""), images } : { content: textParts.join("") };
}

function toRawBase64(block: Extract<ContentBlock, { type: "image" | "video" | "audio" }>): string {
  if (block.data) return block.data;
  throw new DecisionError(
    `OllamaBackend needs inline "data" (base64) for a "${block.type}" block, not a "url" -- Ollama has no way to fetch a remote URL itself`,
  );
}

/** OpenAI's `/v1/chat/completions` takes an array of typed parts for
 * multimodal content: `{type: "text", text}` and
 * `{type: "image_url", image_url: {url}}}`, where `url` may be a normal
 * http(s) link or a `data:` URI. No video/audio input on this endpoint --
 * those raise. */
function toOpenAIContent(content: ChatMessage["content"]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image_url", image_url: { url: toDataOrUrl(block) } };
    throw new DecisionError(
      `OpenAIBackend cannot send a "${block.type}" content block -- the chat completions endpoint has no ${block.type} input`,
    );
  });
}

function toDataOrUrl(block: Extract<ContentBlock, { type: "image" | "video" | "audio" }>): string {
  if (block.url) return block.url;
  if (block.data) return `data:${block.mimeType ?? "image/png"};base64,${block.data}`;
  throw new DecisionError(`a "${block.type}" content block needs "url" or "data"`);
}

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
   * guessing at a decision with no numbers behind it.
   *
   * `maxTokens` defaults to 1 (a single-token race step, the normal case).
   * `discoverTokens` below passes a higher value to read back a whole
   * word's real token split in one response; every built-in backend
   * forwards it straight through to the provider's own max-tokens field,
   * so no backend needs to override this just to support discovery. */
  abstract chat(model: string, messages: ChatMessage[], maxTokens?: number): Promise<ChatResult>;

  /** Pre-establish the connection (TCP + TLS handshake) to this backend's
   * host by sending one minimal real chat call, so the first real
   * `decide()` doesn't pay that cost. This is the single biggest lever on
   * latency to a hosted API that a client actually controls: measured
   * live against OpenAI, a cold request took ~2.4s where a warm one on a
   * reused connection took ~0.75-1.0s -- everything else (TLS 0-RTT,
   * HTTP/3, request-level tuning) is marginal by comparison, and neither
   * OpenAI nor Ollama's servers themselves get any faster from the client
   * side. Node's global `fetch` (undici) already pools keep-alive
   * connections per origin by default, so this only needs to be called
   * once per process before the first latency-sensitive `decide()` --
   * calling it again is a harmless no-op cost-wise (one more cheap
   * request), not a requirement. Default implementation is a real `chat`
   * call asking a 1-token yes/no question with a single option, which
   * exercises the exact routing/auth path a real decision will use;
   * override if a backend has a cheaper way to warm its connection. */
  async warmup(model: string): Promise<void> {
    await this.chat(model, [{ role: "user", content: "." }]);
  }

  /** Discover how `word` actually tokenizes for this model, as the model's
   * own tokenizer would split it at the very start of an answer -- the
   * same position `Client`'s real disambiguation race reads from. See
   * `discoverTokensBatch` (the actual implementation this calls) for the
   * mechanism and why it needs to be a fresh answer start, not mid-prompt. */
  async discoverTokens(model: string, word: string): Promise<string[]> {
    const results = await this.discoverTokensBatch(model, [word]);
    return results.get(word) ?? [];
  }

  /** Same as `discoverTokens`, for many words in one request instead of
   * one request per word -- the common case, since `Client.warmup` wants
   * every not-yet-cached option id in a row discovered before the real
   * race starts. There is no tokenizer API to consult directly (see
   * prefix.ts's module docstring), so this asks the model to list the
   * words back verbatim, one per line, and reads the real token
   * boundaries off the response's own `logprobs`, split at the newline
   * tokens between words.
   *
   * Each word has to start at the beginning of its own line, not mid-
   * sentence: a word's tokenization can depend on what comes immediately
   * before it (a token spanning a leading space is often a different
   * token ID than the same text at a fresh start) -- confirmed live,
   * "damaged" alone tokenizes as ["dam", "aged"], and asked for after a
   * literal newline it tokenizes exactly the same way, but asked for
   * after ", " (mid-sentence, as in a comma-separated list) it tokenizes
   * as a single " damaged" token instead. Only the fresh-line form
   * matches what the real race's `assistant`-prefix continuation sees
   * (each race step also starts a fresh answer), so this asks for a
   * newline-separated list specifically, not a comma-separated one. */
  async discoverTokensBatch(model: string, words: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(words)];
    const out = new Map<string, string[]>();
    if (unique.length === 0) return out;

    const prompt = `List these ${unique.length} words, one per line, exactly as given, nothing else:\n${unique.join("\n")}`;
    // Generous headroom: every word's own tokens plus one newline-ish
    // separator token between each -- real responses run a little over
    // this (whitespace sometimes splits into its own token), so pad well
    // past the minimum rather than risk truncating the last word.
    const maxTokens = unique.reduce((sum, w) => sum + w.length, 0) + unique.length * 4 + 8;
    const result = await this.chat(model, [{ role: "user", content: prompt }], maxTokens);

    let wordIndex = 0;
    let consumed = "";
    let tokens: string[] = [];
    for (const entry of result.logprobs) {
      const word = unique[wordIndex];
      if (word === undefined) break;
      const remaining = word.slice(consumed.length);
      if (remaining && remaining.startsWith(entry.token) && entry.token !== "") {
        tokens.push(entry.token);
        consumed += entry.token;
        if (consumed === word) {
          out.set(word, tokens);
          wordIndex++;
          consumed = "";
          tokens = [];
        }
        continue;
      }
      // Not a continuation of the current word -- either a separator
      // (whitespace/newline) between words, or the current word failed to
      // fully resolve. Either way, stop trying to extend it; leave it
      // unset in `out` (a genuine "couldn't discover this one" outcome,
      // same as any other discovery failure) and wait for the next
      // apparent word-start to try the next word.
      if (tokens.length > 0) {
        wordIndex++;
        consumed = "";
        tokens = [];
      }
    }
    return out;
  }
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

  async chat(model: string, messages: ChatMessage[], maxTokens = 1): Promise<ChatResult> {
    const ollamaMessages = messages.map((m) => ({ role: m.role, ...toOllamaMessage(m.content) }));
    const body = {
      model,
      messages: ollamaMessages,
      stream: false,
      // A reasoning preamble would put thinking tokens in the answer slot,
      // so the very next token stops being the decision.
      think: false,
      options: { num_predict: maxTokens, temperature: 0 },
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

  async chat(model: string, messages: ChatMessage[], maxTokens = 1): Promise<ChatResult> {
    const openaiMessages = messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) }));
    const body = {
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
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
    const entries: any[] = choice?.logprobs?.content ?? [];
    return {
      content: choice?.message?.content ?? null,
      // Every entry, not just the first -- with maxTokens=1 (the normal
      // race step) there's only ever one anyway, but discoverTokens above
      // asks for more and needs the whole sequence back.
      logprobs: entries.map((entry) => ({
        token: entry.token,
        logprob: entry.logprob,
        topLogprobs: (entry.top_logprobs ?? []).map((t: any) => ({
          token: t.token,
          logprob: t.logprob,
        })),
      })),
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

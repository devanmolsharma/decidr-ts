/** How `Client` talks to a model provider. See docs/SPEC.md §3 for the
 * normative `Backend` contract.
 *
 * `OpenAIBackend` is built on the official `openai` SDK and works against
 * any OpenAI-compatible `/v1/chat/completions` endpoint -- OpenAI itself,
 * third-party OpenAI-compatible hosts confirmed to forward logprobs
 * correctly (see docs/PROVIDERS.md), and Ollama's own OpenAI-compatible
 * endpoint (verified live to return real, correct logprobs -- see
 * SPEC.md §3.2 for why an earlier assumption that it didn't was wrong).
 * This is the single reference backend; there is no separate
 * Ollama-specific backend in this package (SPEC.md §3.2 explains why one
 * isn't needed for correctness, and why the official `ollama` npm
 * package specifically can't be used here anyway -- it has a hard,
 * unconditional dependency on `node:fs`/`node:path` and cannot bundle
 * for a browser target, unlike `openai`, which supports browser use via
 * an explicit `dangerouslyAllowBrowser` flag).
 */

import OpenAI from "openai";
import type { ChatMessage, ChatResult, ContentBlock, LogprobEntry } from "./types.js";

/** Bad row, or a backend that could not answer it. */
export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

/** OpenAI's `/v1/chat/completions` takes an array of typed parts for
 * multimodal content -- `{type: "text", text}` and
 * `{type: "image_url", image_url: {url}}}`, where `url` is a normal
 * http(s) link or a `data:` URI. No video/audio input on this endpoint --
 * a block of either type raises. See SPEC.md §10.1. */
function toOpenAIContent(content: ChatMessage["content"]): string | OpenAI.Chat.ChatCompletionContentPart[] {
  if (typeof content === "string") return content;
  return content.map((block): OpenAI.Chat.ChatCompletionContentPart => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image_url", image_url: { url: toUrlOrDataUri(block) } };
    throw new DecisionError(
      `cannot send a "${block.type}" content block -- the chat completions endpoint has no ${block.type} input`,
    );
  });
}

function toUrlOrDataUri(block: Extract<ContentBlock, { type: "image" | "video" | "audio" }>): string {
  if (block.url) return block.url;
  if (block.data) return `data:${block.mimeType ?? "image/png"};base64,${block.data}`;
  throw new DecisionError(`a "${block.type}" content block needs "url" or "data"`);
}

function toOpenAIMessage(message: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  const content = toOpenAIContent(message.content);
  if (message.role === "system") return { role: "system", content: typeof content === "string" ? content : "" };
  if (message.role === "assistant") return { role: "assistant", content: typeof content === "string" ? content : "" };
  return { role: "user", content };
}

/** Talks to any OpenAI-compatible `/v1/chat/completions` endpoint --
 * OpenAI itself, Ollama's compat endpoint, or a self-hosted / third-party
 * host speaking the same wire format. Built on the official `openai` SDK
 * (see this module's docstring for why, and why there's no separate
 * hand-rolled HTTP path or Ollama-specific backend).
 *
 * **Only some models support `logprobs`.** Most consistently absent from
 * reasoning-focused models (OpenAI's o-series and similar reasoning
 * models elsewhere), present on standard chat models. Some otherwise
 * OpenAI-compatible hosts reject `logprobs` outright (Groq returns an
 * explicit 400) -- see docs/PROVIDERS.md for the current checked list.
 * If `decide()` fails with a "no logprobs" error, check that first. */
export class OpenAIBackend {
  static readonly TOP_LOGPROBS = 20;

  private readonly client: OpenAI;
  private readonly timeoutMs: number;
  // Some providers (Ollama's OpenAI-compatible endpoint, notably) run a
  // reasoning/thinking preamble by default, which consumes the single
  // requested token on thinking output instead of the real answer --
  // silently breaking this mechanism with no error. Sending
  // `reasoning_effort: "none"` disables that on providers that support
  // it. Real OpenAI, on the other hand, HARD REJECTS that same field as
  // an unrecognized argument (400, not a silent ignore) for models that
  // don't have a reasoning mode to disable. There's no reliable way to
  // know in advance which behavior a given (model, provider) pairing
  // has, so this is detected once per Backend instance: try with the
  // field, and if the provider rejects it specifically for that reason,
  // remember not to send it again for the rest of this instance's life.
  private sendsReasoningEffort: boolean | null = null;

  constructor(
    options: {
      apiKey?: string;
      baseURL?: string;
      timeoutMs?: number;
      allowBrowser?: boolean;
      /** Override the SDK's underlying `fetch` -- for tests only. */
      fetch?: typeof fetch;
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.client = new OpenAI({
      // `||`, not `??`: an empty string (e.g. an unfilled browser input for
      // a provider that doesn't need a key) must also fall through to the
      // placeholder -- Ollama's endpoint ignores the key but the SDK
      // requires a non-empty string. `process` doesn't exist in a browser
      // bundle at all (referencing it throws, not just returns undefined),
      // so only read it in a Node-like environment.
      apiKey: options.apiKey || (typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined) || "ollama",
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      timeout: this.timeoutMs,
      dangerouslyAllowBrowser: options.allowBrowser ?? false,
      fetch: options.fetch,
    });
  }

  async chat(model: string, messages: ChatMessage[], maxTokens = 1): Promise<ChatResult> {
    const body = {
      model,
      messages: messages.map(toOpenAIMessage),
      max_tokens: maxTokens,
      temperature: 0,
      logprobs: true,
      top_logprobs: OpenAIBackend.TOP_LOGPROBS,
    };

    try {
      if (this.sendsReasoningEffort !== false) {
        try {
          const result = await this.streamOneToken({ ...body, reasoning_effort: "none" });
          this.sendsReasoningEffort = true;
          return result;
        } catch (e) {
          if (this.isUnrecognizedArgumentError(e, "reasoning_effort")) {
            this.sendsReasoningEffort = false;
            return await this.streamOneToken(body);
          }
          throw e;
        }
      }
      return await this.streamOneToken(body);
    } catch (e) {
      throw new DecisionError(`chat completion failed: ${(e as Error).message}`);
    }
  }

  /** Requests the completion as a stream and returns as soon as the
   * first chunk carrying token+logprobs data has arrived, aborting the
   * stream instead of waiting for it to finish. This only ever matters
   * for `max_tokens: 1` (the only way this Backend is used) -- streaming
   * doesn't reduce how much the model computes, but a non-streaming
   * response requires the server to fully assemble and send its whole
   * JSON envelope before the client sees anything, while a streamed
   * response starts arriving the instant the server has the first
   * token, cutting the time-to-first-byte the client actually waits on.
   * Falls back to accumulating normally if a provider's streamed chunks
   * never carry `logprobs` on the content delta (a non-conformant but
   * possible shape) -- `content`/`logprobs` are read from whatever
   * chunks did arrive before the loop ends either way, so this can't
   * silently return nothing for a provider that behaves unusually. */
  private async streamOneToken(
    body: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "stream">,
  ): Promise<ChatResult> {
    const stream = await this.client.chat.completions.create({
      ...body,
      stream: true,
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    let content: string | null = null;
    const logprobs: LogprobEntry[] = [];
    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta?.content) content = (content ?? "") + choice.delta.content;
        const entries = choice.logprobs?.content ?? [];
        for (const entry of entries) {
          logprobs.push({
            token: entry.token,
            logprob: entry.logprob,
            topLogprobs: entry.top_logprobs.map((t: { token: string; logprob: number }) => ({
              token: t.token,
              logprob: t.logprob,
            })),
          });
        }
        // `max_tokens: 1` means there is at most one real content token
        // to see; once its logprobs have arrived, everything else left
        // in the stream (a finish-reason chunk, an empty trailing chunk)
        // carries nothing this caller needs -- stop reading rather than
        // wait for the server to close the stream on its own.
        if (logprobs.length > 0) break;
      }
    } finally {
      // Releases the underlying response/connection back to the pool
      // instead of leaving it half-read -- matters most exactly when we
      // broke out of the loop early above.
      stream.controller.abort();
    }
    return { content, logprobs };
  }

  /** Whether `error` is specifically OpenAI's "unrecognized request
   * argument" rejection for `paramName` -- a 400 with that exact message
   * shape, verified live against a real OpenAI 400 response. Used to
   * detect (once) that this provider doesn't support `reasoning_effort`,
   * distinct from any other kind of request failure, which should still
   * propagate as a real error rather than being silently retried away. */
  private isUnrecognizedArgumentError(error: unknown, paramName: string): boolean {
    if (!(error instanceof OpenAI.APIError)) return false;
    if (error.status !== 400) return false;
    return typeof error.message === "string" && error.message.includes(paramName);
  }

  /** Pre-establish the connection before a latency-sensitive `decide()`
   * call -- see docs/SPEC.md §11 point 4 for the measured cost of a cold
   * connection this exists to avoid. */
  async warmup(model: string): Promise<void> {
    await this.chat(model, [{ role: "user", content: "." }]);
  }

  /** Discover how `word` actually tokenizes for this model. See
   * `discoverTokensBatch`'s docstring -- this is the single-word
   * convenience wrapper around it. */
  async discoverTokens(model: string, word: string): Promise<string[]> {
    const result = await this.discoverTokensBatch(model, [word]);
    return result.get(word) ?? [];
  }

  /** Discover the real token boundaries of several option ids in one
   * request. See docs/SPEC.md §8 for the normative algorithm and why the
   * words must be asked for one-per-line rather than comma-separated. */
  async discoverTokensBatch(model: string, words: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(words)];
    const result = new Map<string, string[]>();
    if (unique.length === 0) return result;

    const prompt = `List these ${unique.length} words, one per line, exactly as given, nothing else:\n${unique.join("\n")}`;
    const maxTokens = unique.reduce((sum, word) => sum + word.length, 0) + unique.length * 4 + 8;
    const { logprobs } = await this.chat(model, [{ role: "user", content: prompt }], maxTokens);

    let wordIndex = 0;
    let consumed = "";
    let tokens: string[] = [];
    for (const entry of logprobs) {
      const targetWord = unique[wordIndex];
      if (targetWord === undefined) break;
      const remaining = targetWord.slice(consumed.length);
      if (remaining && remaining.startsWith(entry.token) && entry.token !== "") {
        tokens.push(entry.token);
        consumed += entry.token;
        if (consumed === targetWord) {
          result.set(targetWord, tokens);
          wordIndex++;
          consumed = "";
          tokens = [];
        }
        continue;
      }
      if (tokens.length > 0) {
        wordIndex++;
        consumed = "";
        tokens = [];
      }
    }
    return result;
  }
}

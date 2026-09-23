import type { Backend, ChatMessage, ChatResult } from "decidr-ts";

/** One real request/response pair, exactly as sent to and returned by
 * the provider's API -- nothing summarized, nothing recomputed. */
export interface RecordedCall {
  messages: ChatMessage[];
  result: ChatResult;
}

/** Wraps a real `Backend` so every `chat()` call it makes during one
 * `decide()`/`score()`/`truth()` run is captured verbatim -- the actual
 * messages sent and the actual response (including every candidate
 * token's real logprob, not just the one that won). decidr-ts itself
 * never keeps this once it's done with a round, so this is the only way
 * to show a visitor the literal raw data instead of a description of it. */
export function recordingBackend(backend: Backend): { backend: Backend; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    backend: {
      async chat(model: string, messages: ChatMessage[], maxTokens?: number): Promise<ChatResult> {
        const result = await backend.chat(model, messages, maxTokens);
        calls.push({ messages, result });
        return result;
      },
      warmup: (model) => backend.warmup(model),
      discoverTokensBatch: (model, words) => backend.discoverTokensBatch(model, words),
    },
  };
}

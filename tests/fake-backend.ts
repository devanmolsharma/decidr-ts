import { DecisionError } from "../src/backend.js";
import type { Backend } from "../src/core.js";
import type { ChatMessage, ChatResult, LogprobEntry } from "../src/types.js";

/** Scripted backend for mechanism-level tests: given the messages/
 * maxTokens for one race step, replies with a fixed script. Implements
 * the same `Backend` shape `Client` calls, without touching the real
 * `openai` SDK -- HTTP-level behavior of `OpenAIBackend` itself is
 * covered separately, against a stubbed `fetch`/SDK transport. */
export class FakeBackend implements Backend {
  calls: ChatMessage[][] = [];
  private script: (messages: ChatMessage[], maxTokens?: number) => ChatResult;

  constructor(script: (messages: ChatMessage[], maxTokens?: number) => ChatResult) {
    this.script = script;
  }

  async chat(_model: string, messages: ChatMessage[], maxTokens?: number): Promise<ChatResult> {
    this.calls.push(messages);
    return this.script(messages, maxTokens);
  }

  async warmup(): Promise<void> {
    await this.chat("fake-model", [{ role: "user", content: "." }]);
  }

  async discoverTokensBatch(_model: string, words: string[]): Promise<Map<string, string[]>> {
    // Trivial default: every word is treated as a single opaque token.
    // Tests that need real multi-token discovery behavior script it
    // themselves via a custom Backend, not this fake.
    const result = new Map<string, string[]>();
    for (const word of new Set(words)) result.set(word, [word]);
    return result;
  }
}

export function singleTokenReply(winner: string, winnerLogprob: number, others: [string, number][] = []): ChatResult {
  const entry: LogprobEntry = {
    token: winner,
    logprob: winnerLogprob,
    topLogprobs: [{ token: winner, logprob: winnerLogprob }, ...others.map(([token, logprob]) => ({ token, logprob }))],
  };
  return { content: winner, logprobs: [entry] };
}

export function multiTokenReply(tokens: string[], logprob = -0.1): ChatResult {
  return {
    content: tokens.join(""),
    logprobs: tokens.map((token) => ({ token, logprob, topLogprobs: [{ token, logprob }] })),
  };
}

export function noLogprobsReply(): ChatResult {
  return { content: "x", logprobs: [] };
}

export { DecisionError };

import { Backend, DecisionError } from "../src/backend.js";
import type { ChatMessage, ChatResult, LogprobEntry } from "../src/types.js";

/** Scripted backend for tests: given the option ids it should pretend to
 * see, replies with the correct next token(s) toward a chosen winner and
 * plausible logprobs for the runner-up tokens, without touching a real
 * model. Not a general tokenizer -- just enough to drive prefix.ts's
 * matching loop deterministically in tests. */
export class FakeBackend extends Backend {
  calls: ChatMessage[][] = [];
  private script: (messages: ChatMessage[], maxTokens?: number) => ChatResult;

  constructor(script: (messages: ChatMessage[], maxTokens?: number) => ChatResult) {
    super();
    this.script = script;
  }

  async chat(_model: string, messages: ChatMessage[], maxTokens?: number): Promise<ChatResult> {
    this.calls.push(messages);
    return this.script(messages, maxTokens);
  }
}

/** Builds a ChatResult whose first entry declares `winner` (full remaining
 * text as one token) as the top logprob, with `others` as lower-ranked
 * alternative single-token guesses. */
export function singleTokenReply(winner: string, winnerLogprob: number, others: [string, number][] = []): ChatResult {
  const entry: LogprobEntry = {
    token: winner,
    logprob: winnerLogprob,
    topLogprobs: [
      { token: winner, logprob: winnerLogprob },
      ...others.map(([token, logprob]) => ({ token, logprob })),
    ],
  };
  return { content: winner, logprobs: [entry] };
}

export function noLogprobsReply(): ChatResult {
  return { content: "x", logprobs: [] };
}

/** A reply spanning several positions at once, for testing multi-token
 * requests (Backend.discoverTokens, and Client's sole-survivor batching
 * in decidePrefix). Each position's own top token is `tokens[i]`. */
export function multiTokenReply(tokens: string[], logprob = -0.1): ChatResult {
  return {
    content: tokens.join(""),
    logprobs: tokens.map((token) => ({ token, logprob, topLogprobs: [{ token, logprob }] })),
  };
}

export { DecisionError };

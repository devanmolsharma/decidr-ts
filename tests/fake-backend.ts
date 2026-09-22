import { Backend, DecisionError } from "../src/backend.js";
import type { ChatMessage, ChatResult, LogprobEntry } from "../src/types.js";

/** Scripted backend for tests: given the option ids it should pretend to
 * see, replies with the correct next token(s) toward a chosen winner and
 * plausible logprobs for the runner-up tokens, without touching a real
 * model. Not a general tokenizer -- just enough to drive prefix.ts's
 * matching loop deterministically in tests. */
export class FakeBackend extends Backend {
  calls: ChatMessage[][] = [];
  private script: (messages: ChatMessage[]) => ChatResult;

  constructor(script: (messages: ChatMessage[]) => ChatResult) {
    super();
    this.script = script;
  }

  async chat(_model: string, messages: ChatMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    return this.script(messages);
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

export { DecisionError };

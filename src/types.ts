/** An option the model can choose. `id` is what comes back as `Decision.choice`;
 * `description` is what the model reads. */
export interface RowOption {
  id: string;
  description: string;
}

/** One decision to make. `state` may be a string, or JSON-serializable data. */
export interface Row {
  id: string;
  state: string | Record<string, unknown> | unknown[];
  question: string;
  options: RowOption[];
}

export interface Decision {
  id: string;
  /** Option id with the highest probability. */
  choice: string;
  /** Option id -> probability, for every option that was actually compared. */
  probabilities: Map<string, number>;
  /** Raw log probabilities behind `probabilities`, before normalizing. */
  logprobs: Map<string, number>;
  /** Always "prefix" -- see prefix.ts's module docstring. */
  mode: "prefix";
  /** Options that genuinely could not be measured -- a real gap. */
  unscored: string[];
  /** Options under a hierarchy branch that lost a race but weren't
   * explored further (only with `exhaustive: false`) -- not a gap. */
  eliminated: string[];
  /** The model's own first reply, for debugging. */
  rawAnswer: string | null;
}

/** `Decision.confidence`: probability of `choice`, or 0 if `choice` somehow
 * isn't in `probabilities` (shouldn't happen -- `choice` is always the
 * argmax of `probabilities`, kept as a function since Decision is a plain
 * object, not a class with methods, to stay a trivial data shape). */
export function confidence(d: Decision): number {
  return d.probabilities.get(d.choice) ?? 0;
}

/** `False` when `unscored` is non-empty, so `probabilities` is incomplete.
 * Unaffected by `eliminated`: losing a real, fair comparison to a real peer
 * is the mechanism working as intended, not a measurement gap. */
export function isReliable(d: Decision): boolean {
  return d.unscored.length === 0;
}

/** One response position's logprob info, in the shape every `Backend`
 * returns it. `topLogprobs` has zero or more entries -- a rank window, not
 * a requested set. */
export interface LogprobEntry {
  token: string;
  logprob: number;
  topLogprobs: { token: string; logprob: number }[];
}

/** What `Backend.chat` returns: the model's reply and its logprobs at that
 * position. `logprobs` has zero entries if the provider returned no logprob
 * information at all for this call -- not the same as an entry whose own
 * `topLogprobs` is empty. */
export interface ChatResult {
  content: string | null;
  logprobs: LogprobEntry[];
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** An option the model can choose. `id` is what comes back as `Decision.choice`;
 * `description` is what the model reads. */
export interface RowOption {
  id: string;
  description: string;
}

/** A piece of a multimodal `state`. `image`/`video`/`audio` carry either a
 * `url` (a normal http(s) link, or a `data:` URI you've already encoded) or
 * inline `data` (base64, no `data:` prefix) plus a `mimeType` -- exactly one
 * of `url`/`data` should be set. Video and audio support depend entirely on
 * the model/provider; a backend that can't forward a block type raises
 * rather than silently dropping it, since decidr never guesses at a
 * decision with input the model didn't actually see. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; data?: string; mimeType?: string }
  | { type: "video"; url?: string; data?: string; mimeType?: string }
  | { type: "audio"; url?: string; data?: string; mimeType?: string };

/** One decision to make. `state` is what the model reads: a plain string,
 * JSON-serializable data, or (for a multimodal decision) an array of
 * `ContentBlock`s mixing text with images/video/audio. */
export type State = string | Record<string, unknown> | unknown[] | ContentBlock[];

export interface Row {
  id: string;
  state: State;
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
  /** Options scored on a partial probability -- they became the sole
   * candidate left racing for their prefix and were stopped there rather
   * than resolved to the end of their own id. A real, genuine partial
   * logprob (not a gap, hence not in `unscored`), but not a full,
   * strictly comparable P(id | prompt) either -- see
   * docs/PREFIX_MATCHING.md for what this trades speed for. */
  stoppedEarly: string[];
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

/** `content` is a plain string for every text-only message (system prompts,
 * the assistant-prefix continuation), or `ContentBlock[]` for a user message
 * carrying multimodal `state`. A backend that doesn't support a block type
 * in `content` must raise, not silently strip it. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentBlock[] };

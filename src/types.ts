/** decidr's data model. See docs/SPEC.md §2 for the normative definitions
 * this file implements. */

/** One option the model can choose between. `id` is what comes back as
 * `Decision.choice`; `description` is what the model reads to understand
 * what this option means. See SPEC.md §5 for the id format rules. */
export interface RowOption {
  id: string;
  description: string;
}

/** One block of a multimodal `state`. Exactly one of `url`/`data` must be
 * set on a non-text block. `data` is base64 with no `data:` URI prefix --
 * a backend adds that prefix itself if its wire format needs one.
 * `video`/`audio` exist in the type but any backend that cannot forward
 * them to its provider MUST raise, never silently drop them. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; data?: string; mimeType?: string }
  | { type: "video"; url?: string; data?: string; mimeType?: string }
  | { type: "audio"; url?: string; data?: string; mimeType?: string };

/** What the model reads: plain text, JSON-serializable data, or a
 * multimodal content-block sequence. */
export type State = string | Record<string, unknown> | unknown[] | ContentBlock[];

/** One decision to make: a question, the evidence to read (`state`), and
 * a closed set of possible answers (`options`). */
export interface Row {
  id: string;
  state: State;
  question: string;
  options: RowOption[];
}

/** The result of `Client.decide`. See SPEC.md §2.3: a given option id
 * appears in exactly one of `probabilities` (scored), `unscored`, or
 * `eliminated` -- never more than one, never none. */
export interface Decision {
  id: string;
  /** The option id with the highest probability. */
  choice: string;
  /** Option id -> probability. Sums to 1 over its own keys. Order-
   * preserving (a `Map`, never a plain object -- a numeric id segment can
   * look like an array index, and plain objects reorder those ahead of
   * insertion order regardless of when they were added). */
  probabilities: Map<string, number>;
  /** Option id -> raw accumulated logprob, before softmax. */
  logprobs: Map<string, number>;
  /** Reserved for future scoring modes; always "prefix" today. */
  mode: "prefix";
  /** Options with NO measurement at all -- a genuine gap. Not affected by
   * `eliminated` or `stoppedEarly`; see SPEC.md §6.3. */
  unscored: string[];
  /** Options under a hierarchy branch that lost a real race but whose own
   * internal structure was never explored (only possible with
   * `exhaustive: false`) -- not a measurement gap. */
  eliminated: string[];
  /** Options scored on a partial logprob: they had no remaining
   * competition for their prefix and were stopped there rather than
   * walked to the end of their own id. A genuine but partial
   * measurement, not a gap, and not necessarily strictly comparable to
   * an option that needed and got more rounds. See SPEC.md §6.4. */
  stoppedEarly: string[];
  /** The model's own first text reply, for debugging only. */
  rawAnswer: string | null;
}

/** `probabilities.get(choice)`, or 0 if `choice` somehow isn't a key
 * (shouldn't happen -- `choice` is always the argmax of `probabilities`).
 * A function, not a method, since `Decision` is a plain data shape. */
export function confidence(decision: Decision): number {
  return decision.probabilities.get(decision.choice) ?? 0;
}

/** `false` when `unscored` is non-empty, meaning `probabilities` is
 * missing real measurements for at least one option. Deliberately
 * unaffected by `eliminated`/`stoppedEarly` -- see SPEC.md §6.3/§6.4 for
 * why those aren't measurement gaps. */
export function isReliable(decision: Decision): boolean {
  return decision.unscored.length === 0;
}

/** One generated token position's logprob info, in the shape every
 * `Backend` normalizes its provider's response into. `topLogprobs` is a
 * rank window the provider chose to report, never a requested set. */
export interface LogprobEntry {
  token: string;
  logprob: number;
  topLogprobs: { token: string; logprob: number }[];
}

/** What `Backend.chat` returns. `logprobs` is empty specifically when the
 * provider returned NO logprob information for the call at all -- not
 * the same as an entry whose own `topLogprobs` happens to be empty. */
export interface ChatResult {
  content: string | null;
  logprobs: LogprobEntry[];
}

/** `content` is a plain string for a text-only message (the system
 * prompt, an assistant-prefix continuation), or `ContentBlock[]` for a
 * user message carrying multimodal `state`. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentBlock[] };

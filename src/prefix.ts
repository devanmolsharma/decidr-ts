/**
 * Scoring real option ids one token at a time.
 *
 * A single forward pass gives per-token logprobs, not per-option-id
 * logprobs -- an option id can span more than one token, and there's no
 * tokenizer API to split it ourselves (Ollama exposes none). So each
 * still-undecided candidate keeps a `remaining` suffix of its own id, and
 * every round we read back which tokens the model actually returned
 * (`topLogprobs`, a rank window -- not a requested set) and match the
 * longest one that is a genuine, non-overshooting prefix of what's left.
 * A candidate is `done` once its `remaining` is fully consumed or it's
 * been declared unscorable. `Client._decideTree` (in core.ts) drives this
 * level by level over the id hierarchy built by `buildTree` below.
 */

import type { ChatMessage, ContentBlock, Row } from "./types.js";

function isContentBlockArray(state: Row["state"]): state is ContentBlock[] {
  return Array.isArray(state) && state.every((item) => typeof item === "object" && item !== null && "type" in item);
}

// Steps allowed per still-unresolved group before giving up on it.
export const MAX_DEPTH = 6;

export const PREFIX_SYSTEM =
  "Apply the supplied criterion to the supplied evidence. Respond with only the id of the single best option, exactly as given, with no explanation or reasoning.";

export class Candidate {
  optionId: string;
  remaining: string;
  logprobSum = 0;
  consumed = "";
  unscoredReason: string | null = null;

  constructor(optionId: string, remaining: string) {
    this.optionId = optionId;
    this.remaining = remaining;
  }

  get done(): boolean {
    return this.remaining === "" || this.unscoredReason !== null;
  }
}

export function buildPrefixMessages(row: Pick<Row, "state" | "question" | "options">, prefix = ""): ChatMessage[] {
  const optionsLine = row.options.map((o) => o.id).join(", ");
  const instructions = `${row.question}\nAnswer with exactly one of: ${optionsLine}.`;

  let userContent: string | ContentBlock[];
  if (isContentBlockArray(row.state)) {
    // Instructions go in their own trailing text block rather than being
    // spliced into an existing one, so image/video/audio blocks stay intact.
    userContent = [...row.state, { type: "text", text: `\n${instructions}` }];
  } else {
    const state = typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    userContent = `${state}\n\n${instructions}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: PREFIX_SYSTEM },
    { role: "user", content: userContent },
  ];
  if (prefix) {
    messages.push({ role: "assistant", content: prefix });
  }
  return messages;
}

/** For each not-done candidate, find the longest token in `found` that is
 * a genuine (non-overshooting) prefix of what's left of its id, and
 * consume it. Mutates `candidates` in place, same as the Python original. */
export function matchStep(candidates: Candidate[], found: Map<string, number>): void {
  for (const c of candidates) {
    if (c.done) continue;
    let bestToken: string | null = null;
    for (const token of found.keys()) {
      if (token === "") continue;
      if (!c.remaining.startsWith(token)) continue; // not a prefix, or overshoots
      if (bestToken === null || token.length > bestToken.length) {
        bestToken = token;
      }
    }
    if (bestToken === null) {
      c.unscoredReason = `no returned token matched the next part of "${c.optionId}" ("${c.remaining}" remaining)`;
      continue;
    }
    c.consumed += bestToken;
    c.remaining = c.remaining.slice(bestToken.length);
    c.logprobSum += found.get(bestToken)!;
  }
}

/** Group not-done candidates by what they've each consumed so far, so
 * candidates that diverged onto different prefixes are asked about
 * separately in the next round. Order-preserving (`Map`), since the
 * groups are walked deterministically by callers. */
export function groupByContext(candidates: Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.done) continue;
    const group = groups.get(c.consumed);
    if (group) {
      group.push(c);
    } else {
      groups.set(c.consumed, [c]);
    }
  }
  return groups;
}

export interface TreeOption {
  id: string;
  description: string;
}

export class TreeNode {
  segment: string;
  options: TreeOption[] = [];
  // Order-preserving: an id segment can be purely numeric (e.g. "2fa"'s
  // sibling could be "2"), and a plain object would reorder integer-like
  // string keys to the front regardless of insertion order. A Map can't.
  children = new Map<string, TreeNode>();

  constructor(segment: string) {
    this.segment = segment;
  }

  /** `{childSegment: "id-suffix: description; id-suffix: description; ..."}`
   * for each child, id suffixes stripped of the shared prefix so far. */
  childSummaries(): Map<string, string> {
    const strip = this.segment ? this.segment.length + 1 : 0;
    const out = new Map<string, string>();
    for (const [seg, node] of this.children) {
      out.set(
        seg,
        node.options.map((o) => `${o.id.slice(strip)}: ${o.description}`).join("; "),
      );
    }
    return out;
  }
}

export function buildTree(options: TreeOption[]): TreeNode {
  const root = new TreeNode("");
  for (const option of options) {
    const segments = option.id.split("_");
    let node = root;
    node.options.push(option);
    let prefix = "";
    for (const seg of segments) {
      prefix = prefix ? `${prefix}_${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = new TreeNode(prefix);
        node.children.set(seg, child);
      }
      child.options.push(option);
      node = child;
    }
  }
  return root;
}

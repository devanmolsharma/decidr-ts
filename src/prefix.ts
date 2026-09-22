/** The token-walking race mechanism. See docs/SPEC.md §6.1 for the
 * normative algorithm this file implements. */

import type { ChatMessage, ContentBlock, Row } from "./types.js";

/** Rounds allowed per still-open candidate before giving up on it. */
export const MAX_DEPTH = 6;

export const PREFIX_SYSTEM =
  "Apply the supplied criterion to the supplied evidence. Respond with only the id of the single best option, exactly as given, with no explanation or reasoning.";

/** One option's progress through a race. A candidate is `done` once its
 * `remaining` text is fully consumed, it's been declared unscorable, or
 * it stopped early with no remaining competition (SPEC.md §6.1 step 4). */
export class Candidate {
  optionId: string;
  remaining: string;
  consumed = "";
  logprobSum = 0;
  unscoredReason: string | null = null;
  stoppedEarly = false;

  constructor(optionId: string, remaining: string) {
    this.optionId = optionId;
    this.remaining = remaining;
  }

  get done(): boolean {
    return this.remaining === "" || this.unscoredReason !== null || this.stoppedEarly;
  }
}

function isContentBlockArray(state: Row["state"]): state is ContentBlock[] {
  return Array.isArray(state) && state.every((item) => typeof item === "object" && item !== null && "type" in item);
}

/** Build the messages for one race step. `prefix`, if non-empty, is
 * appended as the start of the assistant's answer so this request
 * continues from exactly where a previous step left off. */
export function buildPrefixMessages(row: Pick<Row, "state" | "question" | "options">, prefix = ""): ChatMessage[] {
  const optionsLine = row.options.map((o) => o.id).join(", ");
  const instructions = `${row.question}\nAnswer with exactly one of: ${optionsLine}.`;

  let userContent: string | ContentBlock[];
  if (isContentBlockArray(row.state)) {
    userContent = [...row.state, { type: "text", text: `\n${instructions}` }];
  } else {
    const stateText = typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    userContent = `${stateText}\n\n${instructions}`;
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

/** Advance each not-done candidate by whichever token in `found` is the
 * longest genuine, non-overshooting prefix of what's left to match.
 * Mutates `candidates` in place. */
export function matchStep(candidates: Candidate[], found: Map<string, number>): void {
  for (const candidate of candidates) {
    if (candidate.done) continue;
    let bestToken: string | null = null;
    for (const token of found.keys()) {
      if (token === "") continue;
      if (!candidate.remaining.startsWith(token)) continue;
      if (bestToken === null || token.length > bestToken.length) bestToken = token;
    }
    if (bestToken === null) {
      candidate.unscoredReason = `no returned token matched the next part of "${candidate.optionId}" ("${candidate.remaining}" remaining)`;
      continue;
    }
    candidate.consumed += bestToken;
    candidate.remaining = candidate.remaining.slice(bestToken.length);
    candidate.logprobSum += found.get(bestToken)!;
  }
}

/** Group not-done candidates by their shared `consumed` prefix -- same
 * prefix means the same next question, asked once for the whole group
 * instead of once per candidate. Order-preserving. */
export function groupByContext(candidates: Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (candidate.done) continue;
    const group = groups.get(candidate.consumed);
    if (group) group.push(candidate);
    else groups.set(candidate.consumed, [candidate]);
  }
  return groups;
}

export interface TreeOption {
  id: string;
  description: string;
}

/** One level of the id hierarchy. See SPEC.md §6.2. */
export class TreeNode {
  segment: string;
  options: TreeOption[] = [];
  // Order-preserving: a segment can be purely numeric, and a plain object
  // would reorder integer-like string keys ahead of insertion order.
  children = new Map<string, TreeNode>();

  constructor(segment: string) {
    this.segment = segment;
  }

  /** One synthesized description per child, built from every leaf option
   * reachable under it, with this node's own segment path (and its
   * trailing underscore) stripped from each leaf's id. */
  childSummaries(): Map<string, string> {
    const strip = this.segment ? this.segment.length + 1 : 0;
    const summaries = new Map<string, string>();
    for (const [segment, node] of this.children) {
      const parts = node.options.map((option) => `${option.id.slice(strip)}: ${option.description}`);
      summaries.set(segment, parts.join("; "));
    }
    return summaries;
  }
}

/** Build the id hierarchy from every option's id, split on `_`. */
export function buildTree(options: TreeOption[]): TreeNode {
  const root = new TreeNode("");
  for (const option of options) {
    let node = root;
    node.options.push(option);
    let path = "";
    for (const segment of option.id.split("_")) {
      path = path ? `${path}_${segment}` : segment;
      let child = node.children.get(segment);
      if (!child) {
        child = new TreeNode(path);
        node.children.set(segment, child);
      }
      child.options.push(option);
      node = child;
    }
  }
  return root;
}

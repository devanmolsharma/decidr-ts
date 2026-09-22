/** `Client`: give it a row, get back a `Decision` with real probabilities
 * over real option ids. See docs/SPEC.md §4-§6 for the normative
 * behavior this file implements. */

import { DecisionError, OpenAIBackend } from "./backend.js";
import {
  buildPrefixMessages,
  buildTree,
  Candidate,
  groupByContext,
  matchStep,
  MAX_DEPTH,
  TreeNode,
} from "./prefix.js";
import { TokenCache, type TokenCacheOptions } from "./speculative-cache.js";
import type { ContentBlock, Decision, LogprobEntry, Row } from "./types.js";

export { DecisionError } from "./backend.js";

export const DEFAULT_HOST = "http://127.0.0.1:11434/v1";

export const MAX_ID_LENGTH = 40;
export const ID_FORMAT = /^[a-z0-9]+(_[a-z0-9]+)*$/;
export const MAX_BRANCHES_PER_LEVEL = 16;

/** The subset of `Backend` methods `Client` actually calls -- lets a
 * caller pass any object shaped like this, not just `OpenAIBackend`. */
export interface Backend {
  chat(model: string, messages: Parameters<OpenAIBackend["chat"]>[1], maxTokens?: number): ReturnType<OpenAIBackend["chat"]>;
  warmup(model: string): Promise<void>;
  discoverTokensBatch(model: string, words: string[]): Promise<Map<string, string[]>>;
}

export function validateRow(row: Row, checkIdFormat = true): void {
  if (!row || typeof row !== "object") {
    throw new DecisionError("row must be an object");
  }
  for (const field of ["id", "state", "question", "options"] as const) {
    if (!(field in row)) throw new DecisionError(`row is missing required field "${field}"`);
  }
  if (typeof row.id !== "string" || !row.id) {
    throw new DecisionError("row.id must be a non-empty string");
  }
  if (typeof row.question !== "string" || !row.question) {
    throw new DecisionError("row.question must be a non-empty string");
  }
  const stateType = typeof row.state;
  if (stateType !== "string" && (stateType !== "object" || row.state === null)) {
    throw new DecisionError("row.state must be a string, object, or array");
  }
  try {
    JSON.stringify(row.state);
  } catch {
    throw new DecisionError("row.state must be JSON-serializable");
  }
  if (Array.isArray(row.state) && row.state.every((b) => typeof b === "object" && b !== null && "type" in b)) {
    for (const block of row.state as ContentBlock[]) {
      if (block.type === "text") {
        if (typeof block.text !== "string") throw new DecisionError('a "text" content block needs a string "text" field');
        continue;
      }
      if (block.type === "image" || block.type === "video" || block.type === "audio") {
        const hasUrl = typeof block.url === "string" && block.url.length > 0;
        const hasData = typeof block.data === "string" && block.data.length > 0;
        if (hasUrl === hasData) {
          throw new DecisionError(`a "${block.type}" content block needs exactly one of "url" or "data"`);
        }
        continue;
      }
      throw new DecisionError(`unknown content block type "${(block as { type: string }).type}"`);
    }
  }
  if (!Array.isArray(row.options) || row.options.length < 2) {
    throw new DecisionError("row.options must be a list with at least 2 entries");
  }
  const seenIds = new Set<string>();
  for (const option of row.options) {
    if (!option || typeof option.id !== "string" || !option.id) {
      throw new DecisionError("every option needs a non-empty string id");
    }
    if (typeof option.description !== "string" || !option.description) {
      throw new DecisionError(`option "${option.id}" needs a non-empty string description`);
    }
    if (seenIds.has(option.id)) throw new DecisionError(`duplicate option id "${option.id}"`);
    seenIds.add(option.id);
  }
  if (checkIdFormat) {
    for (const option of row.options) {
      if (option.id.length > MAX_ID_LENGTH) {
        throw new DecisionError(`option id "${option.id}" exceeds ${MAX_ID_LENGTH} characters`);
      }
      if (!ID_FORMAT.test(option.id)) {
        throw new DecisionError(`option id "${option.id}" must be lowercase alphanumeric segments joined by underscores`);
      }
    }
    const ids = row.options.map((o) => o.id);
    for (const a of ids) {
      const aSegments = a.split("_");
      for (const b of ids) {
        if (a === b) continue;
        const bSegments = b.split("_");
        if (bSegments.length > aSegments.length && aSegments.every((seg, i) => seg === bSegments[i])) {
          throw new DecisionError(`option id "${a}" is a segment-prefix of "${b}" -- this makes the hierarchy ambiguous`);
        }
      }
    }
  }
}

export function softmax(logprobs: number[], temperature = 1.0): number[] {
  if (logprobs.length === 0) return [];
  const scaled = logprobs.map((lp) => lp / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0);
  if (!total) return logprobs.map(() => 1 / logprobs.length);
  return exps.map((v) => v / total);
}

function foundTokens(entry: LogprobEntry): Map<string, number> {
  const found = new Map<string, number>();
  found.set(entry.token, entry.logprob);
  for (const alt of entry.topLogprobs) {
    if (!found.has(alt.token)) found.set(alt.token, alt.logprob);
  }
  return found;
}

export interface ClientOptions {
  host?: string;
  timeoutMs?: number;
  temperature?: number;
  backend?: Backend;
  exhaustive?: boolean;
  cache?: TokenCacheOptions | TokenCache | false;
}

interface PrefixResult {
  choice: string;
  probabilities: Map<string, number>;
  unscored: string[];
  stoppedEarly: string[];
  rawAnswer: string | null;
}

export class Client {
  readonly model: string;
  readonly temperature: number;
  readonly backend: Backend;
  readonly exhaustive: boolean;
  private readonly cache: TokenCache | null;

  constructor(model: string, options: ClientOptions = {}) {
    this.model = model;
    this.temperature = options.temperature ?? 1.0;
    this.exhaustive = options.exhaustive ?? true;
    this.backend = options.backend ?? new OpenAIBackend({ baseURL: options.host ?? DEFAULT_HOST, timeoutMs: options.timeoutMs });
    if (options.cache === false) {
      this.cache = null;
    } else if (options.cache instanceof TokenCache) {
      this.cache = options.cache;
    } else {
      this.cache = new TokenCache(options.cache);
    }
  }

  async decide(row: Row): Promise<Decision> {
    validateRow(row, true);
    return this.decideTree(row);
  }

  async decideAll(rows: Row[]): Promise<Decision[]> {
    const out: Decision[] = [];
    for (const row of rows) out.push(await this.decide(row));
    return out;
  }

  /** Discover this row's options' real token boundaries up front (one
   * batched request for everything not already cached), seed the
   * speculative cache, then run `decide()`. See docs/SPEC.md §9.4. */
  async warmup(row: Row): Promise<Decision> {
    if (this.cache) {
      const uncached = row.options.filter((o) => this.cache!.get(this.model, o.id) === null);
      if (uncached.length > 0) {
        try {
          const discovered = await this.backend.discoverTokensBatch(this.model, uncached.map((o) => o.id));
          for (const [optionId, tokens] of discovered) {
            if (tokens.length > 0) this.cache.set(this.model, optionId, tokens);
          }
        } catch {
          // Discovery is a pure optimization -- decide() below still works
          // correctly without it.
        }
      }
      this.cache.save();
    } else {
      await this.backend.warmup(this.model);
    }
    return this.decide(row);
  }

  private async chat(messages: Parameters<Backend["chat"]>[1], maxTokens?: number) {
    return this.backend.chat(this.model, messages, maxTokens);
  }

  private async decidePrefix(row: Pick<Row, "state" | "question" | "options">): Promise<PrefixResult> {
    const candidates = row.options.map((o) => new Candidate(o.id, o.id));
    let rawAnswer: string | null = null;
    let exceededDepth = true;

    // Speculation: see SPEC.md §9.3 for the full normative rationale --
    // gated one round at a time on real confirmation, never speculating
    // past a round nothing has confirmed yet.
    const speculative = new Map<string, ReturnType<Backend["chat"]>>();
    const confirmedTokens = new Map<string, string[]>();

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const groups = groupByContext(candidates);
      if (groups.size === 0) {
        exceededDepth = false;
        break;
      }

      // Stop-early default (SPEC.md §6.1 step 4 / §6.4): a group down to
      // exactly one candidate has no remaining competition, so it's
      // scored on its logprobSum as accumulated so far -- no request.
      for (const [consumed, group] of groups) {
        if (group.length !== 1) continue;
        group[0]!.stoppedEarly = true;
        groups.delete(consumed);
      }
      if (groups.size === 0) {
        exceededDepth = false;
        break;
      }

      const entries = [...groups.entries()];
      const results = await Promise.all(
        entries.map(([consumed]) => speculative.get(consumed) ?? this.chat(buildPrefixMessages(row, consumed))),
      );
      entries.forEach(([, group], i) => {
        const result = results[i]!;
        if (result.logprobs.length === 0) {
          for (const c of group) c.unscoredReason = "server returned no logprobs for this step";
          return;
        }
        if (depth === 0 && i === 0) rawAnswer = result.content;

        const found = foundTokens(result.logprobs[0]!);
        for (const c of group) {
          const before = c.consumed;
          matchStep([c], found);
          if (c.consumed === before) continue;
          const tokens = confirmedTokens.get(c.optionId) ?? [];
          tokens.push(c.consumed.slice(before.length));
          confirmedTokens.set(c.optionId, tokens);

          if (!this.cache || c.done) continue;
          const predicted = this.cache.get(this.model, c.optionId);
          if (!predicted) continue;
          const observedSoFar = confirmedTokens.get(c.optionId)!;
          const stillOnTrack = observedSoFar.every((t, idx) => predicted[idx] === t);
          if (!stillOnTrack || observedSoFar.length >= predicted.length) continue;
          const nextToken = predicted[observedSoFar.length]!;
          const nextPrefix = c.consumed + nextToken;
          if (!speculative.has(nextPrefix)) {
            speculative.set(nextPrefix, this.chat(buildPrefixMessages(row, nextPrefix)));
          }
        }
      });
    }

    if (exceededDepth) {
      for (const c of candidates) {
        if (!c.done) c.unscoredReason = `exceeded max disambiguation depth (${MAX_DEPTH})`;
      }
    }

    if (this.cache) {
      for (const c of candidates) {
        if (c.unscoredReason === null && !c.stoppedEarly && c.remaining === "") {
          const tokens = confirmedTokens.get(c.optionId);
          if (tokens) this.cache.set(this.model, c.optionId, tokens);
        }
      }
      this.cache.save();
    }

    const logprobs = new Map<string, number>();
    const unscored: string[] = [];
    const stoppedEarly: string[] = [];
    for (const c of candidates) {
      if (c.unscoredReason === null) {
        logprobs.set(c.optionId, c.logprobSum);
        if (c.stoppedEarly) stoppedEarly.push(c.optionId);
      } else {
        unscored.push(c.optionId);
      }
    }

    if (logprobs.size === 0) {
      const reasons = candidates.map((c) => `${c.optionId}: ${c.unscoredReason}`).join("; ");
      throw new DecisionError(`could not score any option: ${reasons}`);
    }

    const ids = [...logprobs.keys()];
    const probs = softmax(ids.map((id) => logprobs.get(id)!), this.temperature);
    const probabilities = new Map<string, number>();
    ids.forEach((id, i) => probabilities.set(id, probs[i]!));
    let choice = ids[0]!;
    for (const id of ids) {
      if (probabilities.get(id)! > probabilities.get(choice)!) choice = id;
    }

    return { choice, probabilities, unscored, stoppedEarly, rawAnswer };
  }

  private async decideTree(row: Row): Promise<Decision> {
    const probabilities = new Map<string, number>();
    const eliminated: string[] = [];
    const unscored: string[] = [];
    const stoppedEarly: string[] = [];
    const rawAnswerHolder: { value: string | null } = { value: null };

    const explore = async (node: TreeNode, pathLogprob: number): Promise<void> => {
      if (node.options.length === 1) {
        probabilities.set(node.options[0]!.id, Math.exp(pathLogprob));
        return;
      }
      if (node.children.size > MAX_BRANCHES_PER_LEVEL) {
        throw new DecisionError(
          `level "${node.segment || "(root)"}" has ${node.children.size} branches, over the limit of ${MAX_BRANCHES_PER_LEVEL} -- add another id segment to split it further`,
        );
      }
      if (node.children.size === 1) {
        const [onlyChild] = node.children.values();
        await explore(onlyChild!, pathLogprob);
        return;
      }

      const subRow = {
        state: row.state,
        question: row.question,
        options: [...node.childSummaries()].map(([seg, description]) => ({ id: seg, description })),
      };
      const d = await this.decidePrefix(subRow);
      if (rawAnswerHolder.value === null) rawAnswerHolder.value = d.rawAnswer;

      const toExplore: Promise<void>[] = [];
      for (const [seg, child] of node.children) {
        if (d.unscored.includes(seg)) {
          unscored.push(...leafIds(child));
          continue;
        }
        if (d.stoppedEarly.includes(seg)) {
          stoppedEarly.push(...leafIds(child));
        }
        const branchLogprob = pathLogprob + Math.log(d.probabilities.get(seg)!);
        const isWinner = seg === d.choice;
        const isFreeLeaf = child.options.length === 1;
        if (isWinner || this.exhaustive || isFreeLeaf) {
          toExplore.push(explore(child, branchLogprob));
        } else {
          eliminated.push(...leafIds(child));
        }
      }
      await Promise.all(toExplore);
    };

    const root = buildTree(row.options);
    await explore(root, 0);

    if (probabilities.size === 0) {
      throw new DecisionError("could not score any option in the hierarchy");
    }

    let choice = [...probabilities.keys()][0]!;
    for (const [id, p] of probabilities) {
      if (p > probabilities.get(choice)!) choice = id;
    }

    const logprobs = new Map<string, number>();
    for (const [id, p] of probabilities) logprobs.set(id, Math.log(p));

    return {
      id: row.id,
      choice,
      probabilities,
      logprobs,
      mode: "prefix",
      unscored,
      eliminated,
      stoppedEarly,
      rawAnswer: rawAnswerHolder.value,
    };
  }
}

function leafIds(node: TreeNode): string[] {
  if (node.children.size === 0) return node.options.map((o) => o.id);
  const ids: string[] = [];
  for (const child of node.children.values()) ids.push(...leafIds(child));
  return ids;
}

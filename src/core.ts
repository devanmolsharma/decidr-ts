/**
 * `Client`: give it a row (an id, a state, a question, and options), get
 * back a `Decision` with real probabilities over real option ids.
 *
 * `decide()` always resolves through the id hierarchy (`_decideTree`),
 * which uses each option id's underscore-separated segments as a literal
 * tree and races only the children at one level at a time (`_decidePrefix`,
 * from prefix.ts) -- small, reliable races instead of one large unreliable
 * one over every option at once. By default every branch is explored, so
 * every option ends up with a real, comparable probability
 * (`exhaustive: true`); set it to `false` to only pay for the winning
 * path, leaving unexplored losing branches in `eliminated` rather than
 * `probabilities`.
 */

import { Backend, DecisionError, OllamaBackend } from "./backend.js";
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

export const DEFAULT_HOST = "http://127.0.0.1:11434";

export const MAX_ID_LENGTH = 40;
export const ID_FORMAT = /^[a-z0-9]+(_[a-z0-9]+)*$/;
export const MAX_BRANCHES_PER_LEVEL = 16;

export function validateRow(row: Row, checkIdFormat = true): void {
  if (!row || typeof row !== "object") {
    throw new DecisionError("row must be an object");
  }
  for (const field of ["id", "state", "question", "options"] as const) {
    if (!(field in row)) {
      throw new DecisionError(`row is missing required field "${field}"`);
    }
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
        if (typeof block.text !== "string") {
          throw new DecisionError('a "text" content block needs a string "text" field');
        }
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
  const seen = new Set<string>();
  for (const option of row.options) {
    if (!option || typeof option.id !== "string" || !option.id) {
      throw new DecisionError("every option needs a non-empty string id");
    }
    if (typeof option.description !== "string" || !option.description) {
      throw new DecisionError(`option "${option.id}" needs a non-empty string description`);
    }
    if (seen.has(option.id)) {
      throw new DecisionError(`duplicate option id "${option.id}"`);
    }
    seen.add(option.id);
  }
  if (checkIdFormat) {
    for (const option of row.options) {
      if (option.id.length > MAX_ID_LENGTH) {
        throw new DecisionError(`option id "${option.id}" exceeds ${MAX_ID_LENGTH} characters`);
      }
      if (!ID_FORMAT.test(option.id)) {
        throw new DecisionError(
          `option id "${option.id}" must be lowercase alphanumeric segments joined by underscores`,
        );
      }
    }
    const ids = row.options.map((o) => o.id);
    for (const a of ids) {
      const aSegs = a.split("_");
      for (const b of ids) {
        if (a === b) continue;
        const bSegs = b.split("_");
        if (bSegs.length > aSegs.length && aSegs.every((seg, i) => seg === bSegs[i])) {
          throw new DecisionError(
            `option id "${a}" is a segment-prefix of "${b}" -- this makes the hierarchy ambiguous`,
          );
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
  if (!total) {
    return logprobs.map(() => 1 / logprobs.length);
  }
  return exps.map((v) => v / total);
}

function foundTokens(entry: LogprobEntry): Map<string, number> {
  const found = new Map<string, number>();
  found.set(entry.token, entry.logprob);
  for (const alt of entry.topLogprobs) {
    if (!found.has(alt.token)) {
      found.set(alt.token, alt.logprob);
    }
  }
  return found;
}

export interface ClientOptions {
  host?: string;
  timeoutMs?: number;
  temperature?: number;
  backend?: Backend;
  exhaustive?: boolean;
  /** Speculative token-boundary cache: options to build one internally, an
   * existing `TokenCache` to reuse (e.g. shared across several `Client`s
   * against the same model), or `false` to disable speculation entirely
   * (every request stays purely reactive). See speculative-cache.ts.
   * Defaults to an on-disk cache at ~/.decidr-ts/token-cache.json. */
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
    this.backend =
      options.backend ??
      new OllamaBackend({ host: options.host ?? DEFAULT_HOST, timeoutMs: options.timeoutMs });
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
    for (const row of rows) {
      out.push(await this.decide(row));
    }
    return out;
  }

  /** Discover this row's options' real token boundaries up front and seed
   * the speculative cache with them, then run `decide()`. Where a plain
   * `decide()` call has to discover a candidate's token boundary live
   * (round 1 sees what the model actually says, round 2 only then knows
   * what to ask next), `warmup` finds it out ahead of time -- one real
   * "repeat this id back" call per option id not already cached, all
   * fired concurrently -- so the real race can fire every round's request
   * from a verified prediction instead of a cold guess. This can only
   * help or be neutral, never hurt correctness: every speculative
   * response is still verified against the real race's own `topLogprobs`
   * before being trusted (see decidePrefix and speculative-cache.ts's
   * module docstring) -- discovery just gives that verification step a
   * much better starting guess than "no prediction at all."
   *
   * Worth calling ahead of a single latency-sensitive `decide()` where
   * the option set is known in advance; not needed for options that will
   * already be warm from a previous `decide()` call against the same
   * model (the cache persists across calls on its own). Options whose ids
   * aren't found in this row (e.g. a synthesized hierarchy segment)
   * aren't warmed by this -- pass the row you're about to actually decide. */
  async warmup(row: Row): Promise<Decision> {
    if (this.cache) {
      const uncached = row.options.filter((o) => this.cache!.get(this.model, o.id) === null);
      if (uncached.length > 0) {
        try {
          // One request discovering every not-yet-cached id at once,
          // rather than one request per id -- verified live against a
          // real 150-option row: all 150 came back correctly from a
          // single call. See discoverTokensBatch's docstring for why
          // this has to ask for a newline-separated list specifically.
          const discovered = await this.backend.discoverTokensBatch(
            this.model,
            uncached.map((o) => o.id),
          );
          for (const [optionId, tokens] of discovered) {
            if (tokens.length > 0) this.cache.set(this.model, optionId, tokens);
          }
        } catch {
          // Discovery is a pure optimization -- if it fails for any
          // reason (network blip, provider quirk), decide() below still
          // works correctly, just without any of this row's options
          // getting a head start.
        }
      }
      this.cache.save();
    } else {
      // No cache means no speculation to seed -- still worth warming the
      // connection itself before the real decision.
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

    // Speculation: a model's tokenizer is a fixed function of the string,
    // largely independent of surrounding prompt text, so an option id that
    // tokenized a certain way last time against this model probably will
    // again. For a candidate with a cached token sequence, once a round's
    // real result confirms its next token matches the cache's prediction,
    // the round *after that* can be pre-fired immediately, concurrently
    // with the rest of the round still being processed, instead of
    // waiting for a fresh round to start. Deliberately gated one round at
    // a time on real confirmation rather than firing every predicted
    // round up front: the latter was tried and measured live to roughly
    // double total request count, because most candidates in a real race
    // never even survive to round 2 (they fall out of top_logprobs
    // entirely, a very common outcome for a set with more than a
    // handful of options) -- speculating past a round that a real result
    // hasn't confirmed is still alive just wastes real API calls on
    // predictions nothing will ever need. Nothing here is trusted
    // blindly either way: a speculative response is only used once the
    // real round it's speculating past comes back and its matched token
    // agrees with the prediction -- a wrong guess just wastes the one
    // pre-fired request, it can never produce a wrong score.
    const speculative = new Map<string, ReturnType<Backend["chat"]>>(); // consumed-prefix -> in-flight request
    const confirmedTokens = new Map<string, string[]>(); // optionId -> tokens actually observed this run

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const groups = groupByContext(candidates);
      if (groups.size === 0) {
        exceededDepth = false;
        break;
      }

      // The moment a candidate is the only one left racing for its
      // current prefix, there's nothing left to *disambiguate* -- no
      // other option is still competing for that exact text. Stop there
      // and score it on its logprobSum as accumulated so far, rather than
      // spending more requests spelling out the rest of its id.
      //
      // This is the library's default speed/fairness tradeoff, made
      // deliberately: it means candidates that finish in fewer chain-rule
      // terms (a short id, or one that diverges from its rivals early)
      // can end up with a numerically larger probability than one that
      // needed to be resolved in full -- P(a short prefix) isn't the same
      // quantity as P(a full multi-token word), so stopping early gives
      // up strict comparability across options that needed different
      // amounts of disambiguation, in exchange for far fewer requests.
      // See docs/PREFIX_MATCHING.md for the full fairness argument this
      // knowingly trades away, and `Candidate.stoppedEarly` for how a
      // caller can tell which options in a `Decision` were cut short.
      for (const [consumed, group] of groups) {
        if (group.length !== 1) continue;
        group[0]!.stoppedEarly = true;
        groups.delete(consumed);
      }
      if (groups.size === 0) {
        exceededDepth = false;
        break;
      }

      // Every group in a round asks about a different, already-diverged
      // prefix -- these requests don't depend on each other's answers, so
      // firing them concurrently turns N sequential round-trips into one
      // round-trip's worth of latency per round, not N. A group whose
      // prefix was already pre-fired speculatively (from the previous
      // round's confirmation, below) reuses that in-flight request
      // instead of starting a second, redundant one.
      const entries = [...groups.entries()];
      const results = await Promise.all(
        entries.map(([consumed]) => speculative.get(consumed) ?? this.chat(buildPrefixMessages(row, consumed))),
      );
      entries.forEach(([, group], i) => {
        const result = results[i]!;
        if (result.logprobs.length === 0) {
          for (const c of group) {
            c.unscoredReason = "server returned no logprobs for this step";
          }
          return;
        }
        if (depth === 0 && i === 0) {
          rawAnswer = result.content;
        }
        const found = foundTokens(result.logprobs[0]!);
        for (const c of group) {
          const before = c.consumed;
          matchStep([c], found);
          if (c.consumed === before) continue; // this candidate didn't match this round -- nothing to speculate from
          const tokens = confirmedTokens.get(c.optionId) ?? [];
          tokens.push(c.consumed.slice(before.length));
          confirmedTokens.set(c.optionId, tokens);

          if (!this.cache || c.done) continue;
          const predicted = this.cache.get(this.model, c.optionId);
          if (!predicted) continue;
          const observedSoFar = confirmedTokens.get(c.optionId)!;
          // Only keep predicting if everything confirmed so far actually
          // matches the cached sequence -- the moment reality diverges
          // from the prediction, stop speculating for this candidate and
          // let it resolve the normal reactive way from here.
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
        if (!c.done) {
          c.unscoredReason = `exceeded max disambiguation depth (${MAX_DEPTH})`;
        }
      }
    }

    if (this.cache) {
      for (const c of candidates) {
        // Only cache a genuinely complete resolution -- a candidate that
        // went unscored, or stopped early as a sole survivor, didn't
        // finish tokenizing (its `remaining` isn't fully consumed), and
        // caching a partial sequence would make next run's speculative
        // prediction wrong on purpose.
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
    const probs = softmax(
      ids.map((id) => logprobs.get(id)!),
      this.temperature,
    );
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
      if (rawAnswerHolder.value === null) {
        rawAnswerHolder.value = d.rawAnswer;
      }

      // Every branch explored here (the winner, and every other branch
      // when exhaustive) is independent of its siblings -- none of them
      // read a result the others produced -- so they run concurrently
      // instead of paying for each branch's requests one at a time.
      const toExplore: Promise<void>[] = [];
      for (const [seg, child] of node.children) {
        if (d.unscored.includes(seg)) {
          unscored.push(...leafIds(child));
          continue;
        }
        // This segment's own probability at this level was itself cut
        // short (see decidePrefix's stoppedEarly) -- every leaf reached
        // through it inherits that same partial-probability caveat, even
        // if the leaf itself, one level further down, resolves in full.
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
    for (const [id, p] of probabilities) {
      logprobs.set(id, Math.log(p));
    }

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
  if (node.children.size === 0) {
    return node.options.map((o) => o.id);
  }
  const ids: string[] = [];
  for (const child of node.children.values()) {
    ids.push(...leafIds(child));
  }
  return ids;
}

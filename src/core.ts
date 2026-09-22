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
}

interface PrefixResult {
  choice: string;
  probabilities: Map<string, number>;
  unscored: string[];
  rawAnswer: string | null;
}

export class Client {
  readonly model: string;
  readonly temperature: number;
  readonly backend: Backend;
  readonly exhaustive: boolean;

  constructor(model: string, options: ClientOptions = {}) {
    this.model = model;
    this.temperature = options.temperature ?? 1.0;
    this.exhaustive = options.exhaustive ?? true;
    this.backend =
      options.backend ??
      new OllamaBackend({ host: options.host ?? DEFAULT_HOST, timeoutMs: options.timeoutMs });
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

  private async chat(messages: Parameters<Backend["chat"]>[1]) {
    return this.backend.chat(this.model, messages);
  }

  private async decidePrefix(row: Pick<Row, "state" | "question" | "options">): Promise<PrefixResult> {
    const candidates = row.options.map((o) => new Candidate(o.id, o.id));
    let rawAnswer: string | null = null;
    let exceededDepth = true;

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const groups = groupByContext(candidates);
      if (groups.size === 0) {
        exceededDepth = false;
        break;
      }
      let first = true;
      for (const [consumed, group] of groups) {
        const messages = buildPrefixMessages(row, consumed);
        const result = await this.chat(messages);
        if (result.logprobs.length === 0) {
          for (const c of group) {
            c.unscoredReason = "server returned no logprobs for this step";
          }
          continue;
        }
        if (first && depth === 0) {
          rawAnswer = result.content;
          first = false;
        }
        const found = foundTokens(result.logprobs[0]!);
        matchStep(group, found);
      }
    }

    if (exceededDepth) {
      for (const c of candidates) {
        if (!c.done) {
          c.unscoredReason = `exceeded max disambiguation depth (${MAX_DEPTH})`;
        }
      }
    }

    const logprobs = new Map<string, number>();
    const unscored: string[] = [];
    for (const c of candidates) {
      if (c.unscoredReason === null) {
        logprobs.set(c.optionId, c.logprobSum);
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

    return { choice, probabilities, unscored, rawAnswer };
  }

  private async decideTree(row: Row): Promise<Decision> {
    const probabilities = new Map<string, number>();
    const eliminated: string[] = [];
    const unscored: string[] = [];
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

      for (const [seg, child] of node.children) {
        if (d.unscored.includes(seg)) {
          unscored.push(...leafIds(child));
          continue;
        }
        const branchLogprob = pathLogprob + Math.log(d.probabilities.get(seg)!);
        const isWinner = seg === d.choice;
        const isFreeLeaf = child.options.length === 1;
        if (isWinner || this.exhaustive || isFreeLeaf) {
          await explore(child, branchLogprob);
        } else {
          eliminated.push(...leafIds(child));
        }
      }
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

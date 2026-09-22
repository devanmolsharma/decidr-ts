/**
 * Speculative token-boundary cache.
 *
 * `_decidePrefix` (core.ts) discovers each option id's real token boundaries
 * by asking the model and reading `topLogprobs` -- there's no tokenizer API
 * to consult in advance (see prefix.ts's module docstring). Across many
 * `decide()` calls against the *same model*, the same option id tends to
 * tokenize the same way every time: a model's tokenizer is a fixed function
 * of the string, largely independent of the surrounding prompt. So once an
 * id's token sequence has been observed once, it's a good (not guaranteed)
 * prediction for next time.
 *
 * This cache stores that observation, keyed by `(model, optionId)`. In
 * Node it persists to disk (~/.decidr-ts/token-cache.json by default) so it
 * survives process restarts, loaded via a dynamic `import()` of
 * node-cache-store.ts done only after confirming Node is actually
 * available -- kept out of a static import so this module (and everything
 * that transitively imports it, namely core.ts) still bundles cleanly for
 * a browser, where this package is also meant to run (see backend.ts's
 * OpenAIBackend). Anywhere without Node -- a browser, or while that load
 * is still in flight -- the cache is in-memory-only for the lifetime of
 * the page/process, which is always safe: it just means less speculation,
 * never a wrong one.
 *
 * Either way, the cache is used purely as a *speculative* prediction:
 * `decidePrefix` fires the predicted next round's request concurrently
 * with the round that would confirm the prediction, and only keeps the
 * speculative result if the real response actually matches what was
 * predicted. A wrong guess costs nothing beyond the wasted speculative
 * request -- it never produces a wrong score, since every match is still
 * verified against the real `topLogprobs` the same way a non-speculative
 * round would be.
 */

export type TokenCacheData = Record<string, Record<string, string[]>>; // model -> optionId -> token sequence

export interface TokenCacheOptions {
  /** Override the on-disk location (Node only). Defaults to
   * ~/.decidr-ts/token-cache.json. */
  path?: string;
  /** Skip all disk I/O and stay in-memory only, even in Node. */
  persist?: boolean;
}

function isNode(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

export class TokenCache {
  private data: TokenCacheData = {};
  private dirty = false;
  private readonly persist: boolean;
  private path: string | null = null;
  private ready: Promise<void>;

  constructor(options: TokenCacheOptions = {}) {
    this.persist = options.persist !== false && isNode();
    this.ready = this.persist ? this.load(options.path) : Promise.resolve();
  }

  private async load(path: string | undefined): Promise<void> {
    const store = await import("./node-cache-store.js");
    this.path = path ?? store.defaultPath();
    this.data = store.load(this.path);
  }

  /** Resolves once any on-disk cache has finished loading. `decidePrefix`
   * doesn't need to await this -- a lookup before it resolves just returns
   * `null` (no prediction yet), which is always safe -- but tests that
   * want a deterministic cache-hit on the very first call can. */
  async whenReady(): Promise<void> {
    await this.ready;
  }

  /** The token sequence that resolved this option id last time against this
   * model, or `null` if there's no observation yet (including: none was
   * ever recorded, or the on-disk load hasn't finished yet). */
  get(model: string, optionId: string): string[] | null {
    return this.data[model]?.[optionId] ?? null;
  }

  /** Record how an option id actually resolved this run, overwriting any
   * previous (possibly now-stale) observation. */
  set(model: string, optionId: string, tokens: string[]): void {
    (this.data[model] ??= {})[optionId] = tokens;
    this.dirty = true;
  }

  /** Flush to disk if anything changed and persistence is enabled. Safe to
   * call liberally -- a no-op when there's nothing new to write, and never
   * throws even if the on-disk load is still pending (the write is queued
   * behind it). */
  save(): void {
    if (!this.dirty || !this.persist) return;
    this.dirty = false;
    void this.ready.then(async () => {
      const store = await import("./node-cache-store.js");
      store.save(this.path!, this.data);
    });
  }
}

/** Speculative token-boundary cache. See docs/SPEC.md §9 for the
 * normative design: what it stores, how it's used speculatively within
 * `decidePrefix`, and why it's always verified, never trusted blindly. */

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
  private readonly ready: Promise<void>;

  constructor(options: TokenCacheOptions = {}) {
    this.persist = options.persist !== false && isNode();
    this.ready = this.persist ? this.load(options.path) : Promise.resolve();
  }

  private async load(path: string | undefined): Promise<void> {
    const store = await import("./node-cache-store.js");
    this.path = path ?? store.defaultPath();
    this.data = store.load(this.path);
  }

  /** Resolves once any on-disk load has finished. A lookup before it
   * resolves just returns `null` (no prediction yet), which is always
   * safe -- callers don't need to await this in the normal path. */
  async whenReady(): Promise<void> {
    await this.ready;
  }

  get(model: string, optionId: string): string[] | null {
    return this.data[model]?.[optionId] ?? null;
  }

  set(model: string, optionId: string, tokens: string[]): void {
    (this.data[model] ??= {})[optionId] = tokens;
    this.dirty = true;
  }

  /** Flush to disk if anything changed and persistence is enabled. Safe
   * to call liberally. */
  save(): void {
    if (!this.dirty || !this.persist) return;
    this.dirty = false;
    void this.ready.then(async () => {
      const store = await import("./node-cache-store.js");
      store.save(this.path!, this.data);
    });
  }
}

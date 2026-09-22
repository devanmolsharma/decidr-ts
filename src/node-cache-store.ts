/** The Node-only half of the speculative token cache. Split into its own
 * module so speculative-cache.ts can reach it through a dynamic
 * `import()`, done only after confirming Node is available, rather than
 * a static import -- which would force a Node built-in into a browser
 * bundle. See docs/SPEC.md §9.2. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TokenCacheData } from "./speculative-cache.js";

export function defaultPath(): string {
  return join(homedir(), ".decidr-ts", "token-cache.json");
}

export function load(path: string): TokenCacheData {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function save(path: string, data: TokenCacheData): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  } catch {
    // Best-effort: a cache that can't be written to disk still works
    // in-memory for the rest of this process.
  }
}

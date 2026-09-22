import { OpenAIBackend } from "decidr-ts";
import { useRef } from "react";

/** One shared OpenAIBackend per (baseURL, apiKey) pair, reused across
 * every example run in this tab. OpenAIBackend auto-detects (once per
 * instance) whether its provider accepts the reasoning_effort field it
 * tries first -- a fresh instance per click would repeat that one-time
 * detection (a wasted rejected request) on every single decision instead
 * of once for the whole session. Keyed on baseURL too now that the
 * provider picker can point this at Ollama/Together/Fireworks/etc, not
 * just OpenAI itself. */
export function useSharedBackend() {
  const backendRef = useRef<OpenAIBackend | null>(null);
  const cacheKeyRef = useRef<string | null>(null);

  return (apiKey: string, baseURL?: string) => {
    const cacheKey = `${baseURL ?? ""}::${apiKey}`;
    if (!backendRef.current || cacheKeyRef.current !== cacheKey) {
      backendRef.current = new OpenAIBackend({ apiKey, baseURL, allowBrowser: true });
      cacheKeyRef.current = cacheKey;
    }
    return backendRef.current;
  };
}

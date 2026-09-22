import { createContext, useContext } from "react";
import { PROVIDERS, DEFAULT_PROVIDER_ID } from "@/lib/providers";

export type KeyStatus = "ok" | "bad" | null;

export interface ApiKeyContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
  keyStatus: KeyStatus;
  setKeyStatus: (status: KeyStatus) => void;
  providerId: string;
  setProviderId: (id: string) => void;
  model: string;
  setModel: (model: string) => void;
  customBaseURL: string;
  setCustomBaseURL: (url: string) => void;
}

export const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function useApiKey(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) throw new Error("useApiKey must be used within ApiKeyContext.Provider");
  return ctx;
}

export function currentProvider(providerId: string) {
  return PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!;
}

/** Resolves the actual baseURL to hand OpenAIBackend, given the custom
 * provider's user-typed override. */
export function resolveBaseURL(providerId: string, customBaseURL: string): string | undefined {
  const provider = currentProvider(providerId);
  return provider.id === "custom" ? customBaseURL || undefined : provider.baseURL;
}

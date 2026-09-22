/** Providers confirmed (per docs/PROVIDERS.md) to return real logprobs
 * through an OpenAI-compatible `/v1/chat/completions` endpoint -- the only
 * shape `OpenAIBackend` speaks. Deliberately excludes providers
 * docs/PROVIDERS.md found do NOT work here (Groq rejects logprobs
 * outright; Anthropic has no logprobs field at all; xAI/DeepSeek/Cohere/
 * Gemini/Mistral/Bedrock are unreliable or unsupported) -- listing one of
 * those would let a visitor pick a combination that always 400s.
 *
 * Model ids below were checked live against each provider's own current
 * docs (not recalled from training data, which is stale here -- OpenAI's
 * docs now list a newer model generation than gpt-4o/4.1, and several
 * gpt-4.1-nano/gpt-4-turbo/gpt-3.5-turbo ids are scheduled for shutdown
 * within a month of this list being written). Only standard chat models
 * confirmed to still be active and NOT reasoning-only are listed --
 * Cerebras's gpt-oss-120b is deliberately excluded even though it's on
 * their current model list and advertised at a higher tokens/sec than
 * qwen-3.8-27b: confirmed live (not assumed) that it returns NO logprobs
 * field at all even when logprobs:true/top_logprobs:5 are requested
 * (finish_reason "length" after the one requested token, empty content),
 * and separately hard-rejects this backend's default reasoning_effort:
 * "none" with an explicit 400 rather than the silent-ignore fallback
 * path handles. qwen-3.8-27b is used instead -- confirmed live to return
 * real, correct logprobs. See docs/PROVIDERS.md's Cerebras entry for the
 * full verification. */
export interface ModelOption {
  id: string;
  label: string;
}

export interface Provider {
  id: string;
  label: string;
  baseURL?: string; // omitted = OpenAI's default endpoint
  needsKey: boolean;
  keyPlaceholder: string;
  note: string;
  models: ModelOption[];
}

export const PROVIDERS: Provider[] = [
  {
    id: "cerebras",
    label: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    needsKey: true,
    keyPlaceholder: "cerebras API key",
    note: "Specialized inference hardware -- much lower per-token latency than a general hosted API. logprobs/top_logprobs (0-20) documented live on their own API reference. Default here because it's the fastest verified option.",
    models: [{ id: "qwen-3.8-27b", label: "qwen-3.8-27b" }],
  },
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    keyPlaceholder: "sk-...",
    note: "Standard chat models only -- the o-series and other reasoning models reject logprobs. Checked live against OpenAI's current model/deprecation docs.",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
      { id: "gpt-4.1", label: "gpt-4.1" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseURL: "http://127.0.0.1:11434/v1",
    needsKey: false,
    keyPlaceholder: "not required",
    note: "Talks to a local Ollama server. Must be running and reachable from your browser at localhost:11434. Tags checked live against Ollama's model library.",
    models: [
      { id: "llama3.1:8b", label: "llama3.1:8b" },
      { id: "qwen2.5:7b", label: "qwen2.5:7b" },
      { id: "mistral:7b", label: "mistral:7b" },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    needsKey: true,
    keyPlaceholder: "together API key",
    note: "logprobs and streaming are mutually exclusive on their API; decidr doesn't stream, so this doesn't affect it.",
    models: [{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Instruct Turbo" }],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    needsKey: true,
    keyPlaceholder: "API key (if required)",
    note: "Any server implementing POST {baseURL}/chat/completions in the OpenAI shape with logprobs/top_logprobs support -- e.g. a self-hosted vLLM instance, or a provider not listed here.",
    models: [],
  },
];

export const DEFAULT_PROVIDER_ID = "cerebras";

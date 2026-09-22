# Providers

How to point `Client` at a specific model provider, with a full working example for each. For why the interface is shaped this way, see [Writing your own backend](#writing-your-own-backend) at the bottom.

**`decidr` needs a model that returns `logprobs`, and not every model does.** This isn't specific to one provider — it's most consistently true of reasoning-focused models (OpenAI's o-series and similar reasoning models on other providers), which commonly reject or ignore `logprobs` entirely because their API contract is built around a hidden reasoning step rather than a plain next-token distribution. Standard chat models (the GPT-4o family, and most open-weight chat models) support it. If `decide()` fails with something like "no logprobs," a reasoning model is the first thing to check.

Unlike the [Python library](https://github.com/devanmolsharma/decidr), which reaches most hosted providers through LiteLLM, this port ships exactly two backends, both dependency-free (Node's global `fetch`, nothing else): `OllamaBackend` and `OpenAIBackend`. `OpenAIBackend` isn't OpenAI-only — it speaks the OpenAI-compatible `/v1/chat/completions` wire format, which covers OpenAI itself and most self-hosted or hosted-elsewhere servers that speak the same shape (see [Any other OpenAI-compatible server](#any-other-openai-compatible-server) below).

## Ollama (default, local)

```ts
import { Client } from "decidr-ts";

const client = new Client("qwen3.5:4b"); // talks to http://127.0.0.1:11434
```

```ts
const client = new Client("qwen3.5:4b", { host: "http://192.168.1.50:11434" }); // a remote Ollama
```

Nothing to install beyond `decidr` itself.

## OpenAI

```ts
import { Client, OpenAIBackend } from "decidr-ts";

const client = new Client("gpt-4o-mini", {
  backend: new OpenAIBackend({ apiKey: "sk-..." }),
});

const decision = await client.decide({
  id: "ticket-1",
  state: "Customer cannot access their account after a password reset. The reset email never arrived.",
  question: "Which team should handle this?",
  options: [
    { id: "access", description: "Account access and authentication issues." },
    { id: "billing", description: "Billing and payment issues." },
    { id: "sales", description: "Sales and product questions." },
  ],
});
```

**Only OpenAI's standard chat models support `logprobs`** — `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, and that family. OpenAI's reasoning models (the o-series and other reasoning-focused models) reject `logprobs` outright, so `decidr` can't work with them; use a standard model, not a reasoning one. `apiKey` can also come from the `OPENAI_API_KEY` environment variable, in which case `new OpenAIBackend()` needs no arguments.

## Any other OpenAI-compatible server

```ts
import { Client, OpenAIBackend } from "decidr-ts";

const client = new Client("some-model", {
  backend: new OpenAIBackend({
    baseUrl: "https://my-inference-host.example.com/v1",
    apiKey: process.env.MY_PROVIDER_API_KEY,
  }),
});
```

`OpenAIBackend(baseUrl, apiKey)` works against anything that implements `POST {baseUrl}/chat/completions` in the OpenAI shape and supports `logprobs`/`top_logprobs` — many self-hosted inference servers (vLLM, and others with an OpenAI-compatible front end) and some hosted third-party APIs qualify. Whether logprobs specifically are supported and forwarded correctly is up to that server; if `decide()` fails with a "no logprobs" error against a server you expected to support it, check that server's own OpenAI-compatibility docs for `logprobs` first.

### How to tell if a provider will work, before wiring it up

There's no universal registry of who supports `logprobs` — it changes as providers ship features, so treat the table below as a starting point to verify, not a guarantee. Two ways to check a specific provider without writing any `decidr` code first:

1. **Read that provider's own API reference** for its chat completions endpoint and search it for `logprobs` / `top_logprobs`. If the parameter isn't documented at all, or is documented as accepted-but-ignored (as Anthropic's OpenAI-compat layer does), the provider won't work here regardless of what `decidr` does.
2. **Send one raw request yourself** before involving `decidr`, and check whether a `logprobs` object actually comes back on the choice:

   ```bash
   curl https://your-provider.example.com/v1/chat/completions \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "your-model",
       "messages": [{"role": "user", "content": "Say hi."}],
       "max_tokens": 1,
       "logprobs": true,
       "top_logprobs": 5
     }'
   ```

   If `choices[0].logprobs.content` is present and non-empty, the provider supports it. If it's missing, `null`, or the request errors on the `logprobs`/`top_logprobs` fields, it doesn't — `OpenAIBackend` will fail the same way `decide()` would, just without spending a hierarchy's worth of requests finding out.

### Providers known to support `logprobs` via an OpenAI-compatible endpoint

Checked against each provider's own documentation, not assumed — but providers change this without notice, so verify with the request above before depending on it in production:

| Provider | Notes |
|---|---|
| OpenAI | Standard chat models only (`gpt-4o` family, `gpt-4.1`); reasoning models (o-series) reject `logprobs`. |
| Together AI | Documented support for `logprobs`/`top_logprobs`; note `logprobs` and streaming (`stream: true`) are mutually exclusive on their API — `decidr` doesn't stream, so this doesn't affect it. |
| Groq | OpenAI-compatible endpoint; verify current `top_logprobs` cap before relying on a specific value. |
| Fireworks AI | OpenAI-compatible endpoint; reported `top_logprobs` cap is lower than OpenAI's (around 5) — this project's backends always request 20, so expect the response to come back capped rather than erroring, which is fine for `decidr`'s mechanism (it just means fewer alternatives to match against per step). |
| Self-hosted vLLM | Implements the OpenAI-compatible server spec including `logprobs`/`top_logprobs` directly; this is the same shape Together, Fireworks, and several other hosted providers build on. |

**Not currently usable**, regardless of routing: Anthropic/Claude (see [above](#anthropic-claude-is-not-currently-reachable)) and any reasoning-focused model on any provider (the API contract is built around a hidden reasoning step instead of a plain next-token distribution, and `logprobs` is typically rejected or ignored as a result).

## Anthropic (Claude) is not currently reachable

Checked directly, not assumed: Claude's native Messages API (`/v1/messages`) has no `logprobs` field at all, and Anthropic's own OpenAI-compatible endpoint explicitly documents `logprobs` as an unsupported parameter that gets silently ignored rather than an error. Neither route gives `decidr` anything to score a decision from, so there is no working `AnthropicBackend` to add here — one would compile, run, and then always fail with "no logprobs," which is worse than not having it at all, since it would invite spending an API call on something that can never produce a `Decision`.

If Anthropic adds logprobs support to the Messages API in the future, `OpenAIBackend` (pointed at a compatible endpoint) or a small dedicated backend would become viable then; until it does, Claude models aren't a fit for this mechanism regardless of client library.

## What's verified, and what isn't

`OllamaBackend`'s request construction and response handling are covered by live tests against a real running model, and by unit tests against a scripted fake backend.

`OpenAIBackend`'s request construction and response normalization are unit-tested against the documented OpenAI `/v1/chat/completions` response shape. What is **not** verified in this project: an actual live call to OpenAI or any other hosted provider through it — that needs an API key this project doesn't have. The Ollama example above is verified live; the OpenAI examples are correct usage against the documented API shape, not confirmed wire behavior.

## Writing your own backend

For a provider whose API you'd rather call directly, or that doesn't speak the OpenAI-compatible shape: subclass `Backend` and implement one method.

```ts
import { Backend, ChatMessage, ChatResult } from "decidr-ts";

class MyBackend extends Backend {
  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    // Send `messages` to the model, asking it to predict exactly one
    // token at temperature 0. Return:
    return {
      content: "...",     // the model's own reply, or null
      logprobs: [{         // zero entries, or exactly one
        token: "...",
        logprob: -0.1,
        topLogprobs: [{ token: "...", logprob: -0.1 }],
      }],
    };
  }
}
```

An empty `logprobs` array means "this call returned no logprob information at all" — `decidr` treats that as a hard error rather than guessing at a decision with no numbers behind it. `messages` is the same OpenAI-style `{role, content}[]` list every built-in backend receives; how you turn that into a request for your provider is up to you.

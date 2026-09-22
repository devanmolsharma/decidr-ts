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

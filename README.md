# decidr

Typed decisions from an LLM in one forward pass. Give it a question and a
list of real option ids, get back real probabilities over those ids --
no generation, no parsing, no retries for malformed output.

This is the TypeScript port of [decidr](https://github.com/devanmolsharma/decidr)
(Python, on PyPI as `decidr`). Same mechanism, same id rules, same
hierarchy resolution -- ported line-for-line where JS/TS allowed it to
stay faithful, adapted where it didn't (see [Porting notes](#porting-notes)).
If you want the Python version instead, that's the one to use.

## Install

```bash
npm install decidr
```

Zero dependencies. Node 18+ (uses the global `fetch`).

## Quickstart: local model via Ollama

```ts
import { Client } from "decidr";

const client = new Client("qwen3.5:4b"); // any Ollama model, defaults to http://127.0.0.1:11434

const decision = await client.decide({
  id: "ticket-42",
  state: "Customer: my card was charged twice for the same order, please refund the extra charge.",
  question: "What category does this support ticket belong to?",
  options: [
    { id: "billing_refund", description: "customer wants money back" },
    { id: "billing_dispute", description: "customer disputes a charge as unauthorized/fraud" },
    { id: "bug_crash", description: "app or site crashed" },
    { id: "bug_slow", description: "app or site is slow" },
    { id: "account_login", description: "trouble logging in" },
  ],
});

decision.choice;          // "billing_refund"
decision.probabilities;   // Map<string, number>, one entry per option actually compared
decision.unscored;        // option ids that genuinely couldn't be measured -- real gaps
decision.eliminated;      // ids under a losing branch that weren't individually explored (not a gap)
```

## Quickstart: hosted model via OpenAI (or anything OpenAI-compatible)

```ts
import { Client, OpenAIBackend } from "decidr";

const client = new Client("gpt-4o", {
  backend: new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY }),
});

const decision = await client.decide(row);
```

`OpenAIBackend` talks to any server that speaks the OpenAI
`/v1/chat/completions` wire format -- pass `baseUrl` to point it at a
self-hosted or third-party endpoint instead of `https://api.openai.com/v1`.

**Only some models support `logprobs`.** Standard chat models (the GPT-4o
family and similar) do. Reasoning models (the o-series and similar
reasoning models elsewhere) do not -- `decide()` will fail with a clear
error if you point it at one.

## How option ids work

Options are identified by real, human-readable ids, not letters (`A`/`B`/`C`).
The model reads and answers with the id itself, and the id's structure
does double duty as your category hierarchy:

- Ids are lowercase alphanumeric segments joined by underscores:
  `billing_refund`, `bug_crash`, `account_login_2fa`.
- An id can't be a segment-prefix of another id in the same option set
  (`billing` and `billing_refund` together are rejected -- ambiguous).
- Segments are used as a literal tree. `billing_refund` and
  `billing_dispute` both live under a `billing` node; deciding which
  applies is two small races (`billing` vs `bug` vs `account`, then
  `refund` vs `dispute`) instead of one large unreliable race over every
  leaf id at once. This is why option ids need to be *meaningful*
  hierarchical names, not arbitrary labels.

By default, **every branch of the hierarchy is explored**
(`exhaustive: true`), so every option ends up with a real, comparable
probability -- more requests, better numbers. Set `exhaustive: false` to
only pay for the winning path; ids under branches that lost but weren't
explored further show up in `decision.eliminated`, not
`decision.probabilities`.

```ts
const client = new Client("qwen3.5:4b", { exhaustive: false });
```

## Backends

| Backend | Talks to | Dependencies |
|---|---|---|
| `OllamaBackend` (default) | a local/remote Ollama server's `/api/chat` | none (`fetch`) |
| `OpenAIBackend` | any OpenAI-compatible `/v1/chat/completions` endpoint | none (`fetch`) |

Both implement the same `Backend` interface (`chat(model, messages)`), so
you can write your own for another provider -- `Client` only ever calls
that one method.

```ts
import { Backend, ChatMessage, ChatResult } from "decidr";

class MyBackend extends Backend {
  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    // return { content, logprobs } in the shape documented on Backend.chat
  }
}
```

## Calibration

`decision.probabilities` are real softmax'd logprobs, not hand-waved
confidence scores -- but "real" doesn't automatically mean "calibrated."
`fitTemperature` finds one scalar temperature that rescales them to
better match actual outcomes, and reports Expected Calibration Error
(ECE) before/after so you can see the improvement rather than assume it:

```ts
import { fitTemperature, evaluateOutOfFold } from "decidr";

// pairs: [{ decision, correctId }, ...] from decisions you've verified
const result = fitTemperature(pairs);
result.temperature; // apply this to Client's `temperature` option
result.eceBefore;
result.eceAfter;

// cross-validated, so the reported improvement isn't overfit to the sample
const oof = evaluateOutOfFold(pairs, 5);
```

## Porting notes

Differences from the Python library, and why:

- **Backends.** Python ships `OllamaBackend` (stdlib only) and
  `LiteLLMBackend` (optional extra, for everything LiteLLM supports --
  notably *not* Ollama's logprobs, which LiteLLM doesn't forward). The TS
  port ships `OllamaBackend` and `OpenAIBackend` instead: Node's `fetch`
  makes a hand-written OpenAI-compatible backend just as dependency-free
  as Ollama's, and it's a closer match to how most hosted models are
  actually reached from JS/TS than a LiteLLM-style universal client would
  be.
- **Ordered collections.** Python dicts preserve insertion order
  unconditionally. JavaScript's plain objects reorder integer-like string
  keys (e.g. `"2"`) ahead of insertion order regardless of when they were
  added -- and an id segment can be purely numeric under the id format
  rules. The TS port uses `Map` everywhere order matters (the id tree's
  children, token-matching groups, `Decision.probabilities`/`logprobs`)
  to avoid that class of bug outright.
- **No `letters` mode.** Removed in the Python library once hierarchy
  resolution made it redundant; never existed in this port.
- **Calibration's seeded shuffle.** Python's `evaluate_out_of_fold` uses
  `random.Random(seed)`. Node has no built-in seeded RNG, so the port
  uses a small hand-rolled PRNG (mulberry32) for the same purpose --
  reproducible for a given seed, but not bit-identical to Python's
  Mersenne Twister output.

## License

MIT

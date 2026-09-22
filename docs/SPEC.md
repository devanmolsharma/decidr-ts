# decidr — implementation specification

Version: 1.0.0 (2026-09-22)

This document specifies the decidr mechanism precisely enough that a
clean-room implementation in any language, reading only this file, should
produce behaviorally equivalent output to the reference TypeScript and
Python SDKs. Where the two reference SDKs differ from each other, this
spec states the canonical behavior and calls out the divergence.

Prose explanations of *why* each design choice was made live in
`HIERARCHY.md`, `PREFIX_MATCHING.md`, `NAMING_IDS.md`, and `PROVIDERS.md`.
This document specifies *what* to build, not why.

## 1. Core concept

decidr reads a probability distribution over a closed set of typed
answers directly from a chat model's next-token log-probabilities, in one
or a small number of forward passes, instead of generating free text and
parsing it. The model is never asked to explain itself or produce
structured output syntax (JSON, XML) — it is asked to answer with exactly
one real, human-readable option id, and the implementation reads that
id's probability off the model's own logits.

## 2. Data model

### 2.1 `Row` (input)

```
Row {
  id: string                          // caller's own identifier for this decision, non-empty
  state: State                        // what the model reads
  question: string                    // non-empty
  options: RowOption[]                // >= 2 entries
}

RowOption {
  id: string                          // see §5 for format rules
  description: string                 // non-empty; what the model reads for this option
}

State =
  | string
  | JSON-serializable object or array  // serialized with JSON.stringify / json.dumps before use
  | ContentBlock[]                     // multimodal, see §2.2
```

### 2.2 `ContentBlock` (multimodal state)

```
ContentBlock =
  | { type: "text", text: string }
  | { type: "image", url?: string, data?: string, mimeType?: string }
  | { type: "video", url?: string, data?: string, mimeType?: string }
  | { type: "audio", url?: string, data?: string, mimeType?: string }
```

Exactly one of `url` or `data` must be set on a non-text block; neither or
both is a validation error. `data` is base64, with no `data:` URI prefix
(the prefix, if needed for a provider's wire format, is added by the
backend adapter, not by the caller).

`video` and `audio` blocks are part of the type surface but **MUST**
raise a clear error from any backend that cannot forward them to its
provider — never silently drop the block and proceed as if it weren't
there. As of this spec version, no reference backend (Ollama, OpenAI
chat completions) accepts video or audio input on the chat endpoint used.

### 2.3 `Decision` (output)

```
Decision {
  id: string                          // copied from the input Row
  choice: string                      // the option id with the highest probability
  probabilities: OrderedMap<string, number>   // option id -> probability; sums to 1 over its own keys
  logprobs: OrderedMap<string, number>        // option id -> raw (pre-softmax) accumulated logprob
  mode: "prefix"                      // reserved for future scoring modes; always "prefix" today
  unscored: string[]                  // option ids with NO measurement at all (see §7)
  eliminated: string[]                // option ids under an unexplored hierarchy branch (see §6.3)
  stoppedEarly: string[]              // option ids scored on a partial logprob (see §6.4)
  rawAnswer: string | null            // the model's own first text reply, for debugging only
}
```

`probabilities` and `logprobs` **MUST** use an order-preserving map type
(e.g. `Map` in JS, `dict` in Python — note Python's built-in `dict`
already preserves insertion order unconditionally; JavaScript's plain
`object` does NOT for integer-like string keys, which a numeric id
segment can be, so a JS/TS implementation MUST use `Map`, never a plain
object, for this and every other order-sensitive keyed collection in this
spec).

A given option id appears in **exactly one** of: `probabilities` (scored,
whether fully or as `stoppedEarly`), `unscored`, or `eliminated`. It is a
specification violation for an id to appear in more than one, or in
none.

`confidence(decision)` = `probabilities.get(choice) ?? 0`.
`isReliable(decision)` = `unscored.length === 0`. Note `isReliable` is
**not** affected by `eliminated` or `stoppedEarly` — see §6.3 and §6.4 for
why those are not measurement gaps.

## 3. Backend contract

A `Backend` is the adapter between the mechanism (§6) and one model
provider. It implements exactly one required method and one optional
pair:

```
Backend {
  // Required.
  chat(model: string, messages: ChatMessage[], maxTokens: number = 1) -> ChatResult

  // Optional, both have a correct default implementation expressible
  // purely in terms of chat() (see §8) — a backend only needs to
  // override them if its provider has a cheaper native way to do it.
  warmup(model: string) -> void
  discoverTokensBatch(model: string, words: string[]) -> OrderedMap<string, string[]>
}

ChatMessage { role: "system" | "user" | "assistant", content: string | ContentBlock[] }

ChatResult {
  content: string | null              // the model's own text reply, if any
  logprobs: LogprobEntry[]            // one entry per generated token position, in order
}

LogprobEntry {
  token: string
  logprob: number
  topLogprobs: { token: string, logprob: number }[]   // a RANK WINDOW, not a requested set
}
```

`chat`'s `maxTokens` parameter controls how many tokens the model is
asked to generate (`num_predict` on Ollama, `max_tokens` on
OpenAI-compatible APIs). The mechanism (§6) usually requests 1; §6.4 and
§9 describe when it requests more.

**`logprobs` MUST be empty (`[]`) if the provider returned no logprob
information for the call at all.** This is distinct from an entry whose
own `topLogprobs` is empty (a real entry, just with no ranked
alternatives reported). The mechanism treats a truly empty `logprobs`
array as "this provider/model doesn't support logprobs for this call"
and raises immediately (see §10) rather than guessing.

Every real request MUST be sent at `temperature: 0` (or the provider's
equivalent "deterministic" setting). This is a scoring mechanism, not a
generative one; sampling temperature has no place in it.

### 3.1 `top_logprobs` window size

Backends MUST request the largest `top_logprobs` window their provider
allows, up to a sane cap. Ollama enforces a hard server-side cap of 20
(verified directly against Ollama's `server/routes.go` source — not
assumed). OpenAI-compatible APIs commonly cap at 20 as well but this
varies by provider (Fireworks ~5, xAI ~8 — see `PROVIDERS.md`); backends
SHOULD request 20 and let the provider clamp it rather than trying to
auto-detect a provider-specific cap.

### 3.2 Reference backend implementation strategy: official per-provider SDKs, never a multi-provider abstraction

This section states a researched, verified architectural constraint, not
a preference.

**No general multi-provider LLM abstraction library reliably returns
logprobs across providers as of this spec version.** Checked directly,
not assumed: LiteLLM silently drops `logprobs`/`top_logprobs` when
routing Ollama through its OpenAI-compatible code path (Ollama's own
`/v1/chat/completions` compat endpoint does not implement logprobs at
all — closed upstream as "not planned", see `ollama/ollama#16117`).
Vercel AI SDK removed its normalized cross-provider logprobs surface
entirely in v5, demoting it to per-provider `providerOptions` with an
open, previously-shipped-broken bug even for its own flagship OpenAI
provider (`vercel/ai#7767`). LangChain's `ChatOllama` has an open,
unresolved logprobs bug (`langchain-ai/langchain#34207`). The common
failure pattern across all three: the parameter is silently accepted
and the result comes back empty or absent, never a loud error — the
single worst failure mode for a library whose entire output is a
probability distribution.

**Reference backends MUST therefore be built on each provider's own
official, single-provider SDK, never on a multi-provider
abstraction layer:**

- **OpenAI-compatible backend**: the official `openai` package
  (PyPI and npm). Both expose fully typed `logprobs`/`top_logprobs`
  request parameters and a typed `choice.logprobs.content[]` response
  array (note: nested under `.content`, not a bare array — see §3.3).
  Works against any OpenAI-compatible endpoint via a configurable base
  URL, covering OpenAI itself and third-party OpenAI-compatible hosts
  confirmed to actually forward logprobs (Together AI, Fireworks,
  Cerebras, self-hosted vLLM — see `PROVIDERS.md`'s provider table)
  without a separate client per host. **Not every OpenAI-compatible host
  actually supports `logprobs`** — Groq, for one, returns an explicit 400
  error if `logprobs`/`top_logprobs` are supplied at all, despite being
  otherwise OpenAI-compatible; `PROVIDERS.md` maintains the current
  checked list of which hosts do and don't, since this varies by
  provider and changes without notice.
- **Ollama backend**: the official `ollama` package (PyPI ≥ 0.6.1, npm
  latest), talking to Ollama's **native** `/api/chat` — never Ollama's
  own OpenAI-compatibility endpoint, and never through a general
  abstraction layer that might route through that endpoint. Both official
  clients expose typed `logprobs`/`top_logprobs` request fields and a
  typed `logprobs: Logprob[]` response field as of the versions above.
  **This is a hard invariant, not a style preference: any code path that
  reaches Ollama through an OpenAI-compatible shim (LiteLLM, Ollama's own
  `/v1` endpoint, or otherwise) MUST be treated as broken for this
  library's purposes, regardless of how convenient it looks, because
  logprobs will silently not come through.**

A conforming implementation MAY add further single-provider backends
(e.g. a direct Anthropic backend) the same way, adapting that provider's
own official SDK — but MUST verify logprobs support against that
provider's real, current API before shipping the backend, since this is
an actively shifting landscape (see `PROVIDERS.md` for the standing
verification procedure). A provider confirmed to have no logprobs
support at all on any endpoint (Anthropic/Claude, as of this spec
version — see `PROVIDERS.md`) MUST NOT get a backend at all, rather than
shipping one that always fails.

### 3.3 No declared capability is trustworthy — verify with a real probe

This principle was checked directly across the wider ecosystem (gateways
and multi-provider SDKs — LiteLLM, OpenRouter, Portkey, Bifrost,
Braintrust, Vercel AI Gateway, and others) specifically because §3.2
already ruled out depending on any of them for the core path. The
finding generalizes beyond "don't use a gateway":

**No signal that a given (model, provider) pairing supports logprobs is
reliable on its own — not an HTTP 200, not a typed SDK response field
existing, not a provider's own documentation, and not even a
purpose-built capability-introspection endpoint.** Concretely, in
systems built specifically to answer "does this route support
logprobs": LiteLLM's `get_supported_openai_params()` has been observed
both false-negative (wrongly rejecting a provider that does support it)
and false-positive (a provider's real logprobs value silently never
reaching the final response object even though the raw response had it).
OpenRouter's own per-endpoint capability listing is contradicted by the
same model slug returning logprobs through one upstream and not another,
determined only at request-routing time. Multiple gateways hardcode
`logprobs: null` for providers whose own APIs might support it in some
form, simply because nobody implemented that provider's specific
transformation.

**Therefore, a conforming implementation MUST NOT infer logprobs support
purely from configuration, provider name, or a client library's typed
response shape existing.** It MUST verify by inspecting an actual
response from an actual call to that exact (model, provider, backend)
combination, checking specifically for a non-empty logprobs array with
real (not placeholder/sentinel) values — some providers have been
observed returning well-formed-looking but meaningless placeholder
logprob values (e.g. `0` or `-9999` for every token) rather than either
real data or a clear error, so presence of the field is necessary but
not sufficient; a conforming implementation SHOULD sanity-check that
returned logprob values are negative and vary across tokens, not
uniformly a single suspicious constant.

A conforming implementation SHOULD offer a way to run this verification
once, explicitly — surfacing a broken provider/backend pairing
immediately at startup or in CI, rather than as a confusing
`DecisionError` deep inside a user's first real `decide()` call.
`Backend.warmup` (§8) is a natural place to add this check in a
conforming implementation, since it already makes one real call before
any latency-sensitive work begins.

A conforming implementation SHOULD also consider tagging where a
`Decision`'s numbers actually came from (e.g. an internal
`Measured | SelfReported | Unavailable` provenance marker) rather than
exposing only a bare `probabilities` map with no indication of how
trustworthy the underlying measurement was — this keeps any downstream
calibration math (§7) honest and gives a caller a clean way to exclude
a provider that can never produce real logprobs (Anthropic, as of this
spec version) instead of that provider silently producing a
`DecisionError` with no distinguishing signal from a transient failure.

## 4. `Client` public API

```
Client(model: string, options?: ClientOptions)

ClientOptions {
  backend?: Backend                   // default: an OllamaBackend against http://127.0.0.1:11434
  host?: string                       // only used when backend is omitted (constructs default OllamaBackend)
  timeoutMs?: number
  temperature?: number = 1.0          // softmax temperature, NOT the model's sampling temperature (always 0, see §3)
  exhaustive?: boolean = true         // see §6.3
  cache?: TokenCacheOptions | TokenCache | false   // see §9; default: an on-disk cache, enabled
}

Client.decide(row: Row) -> Promise<Decision>       // validates row, then resolves via §6
Client.decideAll(rows: Row[]) -> Promise<Decision[]>  // decide() called once per row, in order
Client.warmup(row: Row) -> Promise<Decision>       // see §9.3, then calls decide(row)
```

`decide` MUST validate the row (§5) with `checkIdFormat: true` before
doing anything else. A caller-supplied row's ids are always checked; ids
synthesized internally from hierarchy segments (§6) are never re-checked
against the id-format rules, only against the structural invariants that
already hold by construction.

## 5. Row and option-id validation

A row fails validation, and `decide` raises before sending any request,
if:

- `id`, `question` are missing, not strings, or empty.
- `state` is missing, or is neither a string, a JSON-serializable
  object/array, nor a `ContentBlock[]` (§2.2).
- A `ContentBlock` in `state` has an unknown `type`, a `text` block
  without a string `text`, or a media block without exactly one of
  `url`/`data` set.
- `options` is missing, not a list, or has fewer than 2 entries.
- Any option is missing a non-empty string `id` or non-empty string
  `description`.
- Two options share the same `id`.

When `checkIdFormat` is true (always, for a caller-supplied row — see
§4), additionally:

- Any option id is longer than **40** characters.
- Any option id does not match `^[a-z0-9]+(_[a-z0-9]+)*$` — lowercase
  letters and digits, in segments joined by single underscores, no
  leading/trailing/doubled underscores, no other punctuation.
- Any option id is a **segment-prefix** of another option id in the same
  row: `a` is a segment-prefix of `b` if `b`'s underscore-split segments
  begin with all of `a`'s segments, and `b` has at least one more segment
  than `a`. (`billing` is a segment-prefix of `billing_refund`; `bill` is
  **not** a segment-prefix of `billing` — segments are compared whole,
  not by character prefix.)

## 6. The mechanism

`decide(row)` always resolves through the id hierarchy (§6.2), even for a
row whose ids have no underscores — that degrades to exactly one flat
race, identical to calling the token-walking race (§6.1) directly.

### 6.1 Token-walking race (one flat race over a set of option ids)

Input: a list of `{id, description}` candidates (either the row's own
options, or a hierarchy level's segment values, §6.2), plus the row's
`state`/`question` for prompt construction.

1. Initialize one `Candidate` per input id:
   `{ optionId, remaining: optionId, consumed: "", logprobSum: 0, unscoredReason: null, stoppedEarly: false }`.
   A candidate is **done** when `remaining === ""`, OR
   `unscoredReason !== null`, OR `stoppedEarly === true`.

2. Build the prompt once per round, reused with different
   `assistant`-prefix continuations:
   - System message: exactly
     `"Apply the supplied criterion to the supplied evidence. Respond with only the id of the single best option, exactly as given, with no explanation or reasoning."`
   - User message: the row's `state` followed by
     `"\n\n{question}\nAnswer with exactly one of: {comma-separated option ids}."`
     — if `state` is a `ContentBlock[]`, this instruction text is
     appended as one more trailing `{type: "text"}` block rather than
     spliced into an existing block, so media blocks stay intact; ids in
     this joined list are the raw candidate ids as given (segment
     values at a hierarchy sub-level, full ids at the leaf level).
   - If a non-empty `prefix` is supplied for this round (see step 4), one
     more `assistant` message containing exactly that prefix text, so the
     model's next generated token continues from there rather than
     restarting the answer.

3. **Group not-done candidates by their current `consumed` text**
   (`groupByContext`). Candidates with identical `consumed` are
   genuinely indistinguishable at this point and are asked about
   together in one request; candidates that have already diverged onto
   different `consumed` prefixes are asked about separately.

4. **Before sending any request this round**: any group that now
   contains **exactly one** not-done candidate has nothing left to
   disambiguate against — no other candidate is still competing for that
   exact prefix. Mark that candidate `stoppedEarly = true` immediately,
   using its `logprobSum` as accumulated so far, and remove it from this
   round's groups. **No request is sent for it.** This is the default
   behavior (see §6.4 for the rationale and the tradeoff it makes; there
   is no flag to disable it as of this spec version).

5. For every remaining group (size ≥ 2 after step 4), send one `chat`
   request with `maxTokens: 1` and that group's shared `consumed` as the
   `assistant`-prefix. **Requests for different groups in the same round
   are independent of each other and MUST be sent concurrently**, not
   sequentially — this is a real, measured latency requirement, not an
   optional nicety (§11).

   If a group's response has an empty `logprobs` array, every candidate
   in that group gets
   `unscoredReason = "server returned no logprobs for this step"` and the
   group is done.

   Otherwise, build a `found` map from the response's first
   `LogprobEntry`: `{ [entry.token]: entry.logprob }`, then for each of
   that entry's `topLogprobs` alternatives, add `{ [token]: logprob }`
   **only if that token is not already a key** (the primary token's own
   value must never be overwritten by a duplicate appearing in the
   alternatives list).

   For each candidate in the group: find the **longest** token in `found`
   that is a genuine, non-overshooting prefix of `candidate.remaining`
   (`candidate.remaining.startsWith(token)`, token non-empty). If no such
   token exists, set
   `unscoredReason = "no returned token matched the next part of \"{optionId}\" (\"{remaining}\" remaining)"`.
   If one exists, consume it: `consumed += token`,
   `remaining = remaining.slice(token.length)`, `logprobSum += logprob`.

   The **first** response of the **first** group of the **first** round
   becomes the race's `rawAnswer` (its raw `content` field), for
   debugging only — this has no effect on scoring.

6. Repeat from step 3 for up to **6 rounds** (`MAX_DEPTH`). If any
   candidate is still not done after 6 rounds, set
   `unscoredReason = "exceeded max disambiguation depth (6)"` for it.

7. A candidate with `unscoredReason === null` is scored, using its final
   `logprobSum` (whether it got there by full resolution, by
   `stoppedEarly`, or — impossible after step 6 exits, since every
   surviving candidate is by then done one way or another). A candidate
   with `unscoredReason !== null` goes to this race's `unscored` list.

8. If **no** candidate was scored, raise an error naming every
   candidate's `unscoredReason`.

9. Softmax the scored candidates' `logprobSum` values (temperature =
   `Client`'s configured `temperature`, default 1.0; §6.5) to produce
   this race's `probabilities`. The highest becomes this race's `choice`.

### 6.2 Hierarchy resolution (`decideTree`)

Build a tree from every option's id split on `_`: the root holds every
option; each underscore-segment adds one level; a node's `options` field
holds every original option whose id passes through that node.

Recursively explore, starting at the root with `pathLogprob = 0`:

- If a node has exactly **one** option, it's a leaf: record
  `probabilities[that option's id] = exp(pathLogprob)`. No request.
- If a node's child count exceeds **16** (`MAX_BRANCHES_PER_LEVEL`),
  raise an error naming the level and suggesting another hierarchy
  level to split the branching further.
- If a node has exactly **one** child, descend into it "for free" — the
  id already committed to that branch structurally, so there is nothing
  to ask. No request.
- Otherwise (2-16 children), build a sub-race (§6.1) whose candidates
  are this node's **children's segment values**, each with a description
  synthesized by joining every leaf option's `{suffix}: {description}`
  under that child (suffix = the leaf's own id with this node's own
  segment-path-so-far, plus its trailing underscore, stripped).

  For each child:
  - If its segment is in the sub-race's `unscored`: every leaf option
    under that child goes to the overall `unscored` list.
  - Else: `branchLogprob = pathLogprob + ln(subRace.probabilities[segment])`.
    If the child's segment was the sub-race's `choice`, OR the `Client`
    is `exhaustive`, OR the child is itself already a single leaf (free
    to explore, no extra cost): recurse into it with `branchLogprob`.
    Otherwise, every leaf option under that child goes to the overall
    `eliminated` list — a real, complete race was run and this branch
    lost it, but its own internal structure (which specific leaf would
    have won) was never explored.
  - If the sub-race itself marked this child's segment `stoppedEarly`:
    every leaf option under that child also goes to the overall
    `stoppedEarly` list, in addition to whatever `explore` does with it —
    a branch whose own probability at this level was itself partial
    passes that caveat down to everything reached through it, even if a
    deeper level resolves in full.

  **All children being recursed into at one node are independent of each
  other and MUST be explored concurrently**, not sequentially (§11).

An id with no underscores is a one-segment path: the root's children are
already the full option ids, and exactly one race runs — identical to
calling §6.1 directly on the row's own options.

### 6.3 `eliminated` vs `unscored` vs `stoppedEarly`

These three are semantically distinct and MUST be reported separately,
never merged or conflated:

- **`unscored`**: a genuine measurement gap. A token this option needed
  next never appeared anywhere in a race's `topLogprobs` results, at any
  depth. There is no honest number to report.
- **`eliminated`**: not a gap. A real, complete race ran and this
  option's branch lost it fairly; its own internal structure (which leaf
  inside it would have won, at what probability) was deliberately not
  explored further, only under `exhaustive: false`.
- **`stoppedEarly`**: not a gap. A real, partial measurement exists —
  this option had no remaining competition for its current prefix, so it
  was scored on its logprob as accumulated so far rather than walked to
  the end of its own id. Its number is genuine but not necessarily
  strictly comparable to an option that needed, and got, more rounds
  (§6.4).

`isReliable` (§2.3) checks only `unscored`.

### 6.4 Stopping early: the canonical default, and what it trades away

**Canonical behavior (default, no flag to disable as of this spec
version):** the moment a candidate is the sole not-done member of its
group (step 4, §6.1), stop walking it and accept its current
`logprobSum` as final.

**Why this is not free of tradeoffs, stated precisely:** a chain-rule
probability accumulates by multiplication —
`P(t1) * P(t2|t1) * P(t3|t1,t2) * ...`. Every additional term can only
keep the running product the same or shrink it (probabilities are ≤ 1).
An option resolved in fewer chain-rule terms will, all else equal, end up
with a numerically larger (less negative) `logprobSum` than one that
needed more terms — not because it is semantically more likely, purely
because fewer terms were multiplied in. Stopping early means
`Decision.probabilities` is **not guaranteed to be a strictly
comparable, full `P(id | prompt)` for every option** — an option in
`stoppedEarly` has a real but partial number. This is a deliberate
speed/fairness tradeoff, not an oversight: measured live, it reduces a
representative 8-option race with several colliding multi-token ids from
5 requests to 1 (§11).

A conforming implementation MAY offer a flag to force full resolution
(walking every candidate to the end of its own id regardless of
remaining competition) as a non-default option, but MUST default to
stopping early as specified here to remain spec-conformant. (Historical
note: the Python reference SDK's first release always walked to full
resolution and had no stop-early behavior at all; this spec's canonical
default reflects the TypeScript SDK's later, measured revision. A
from-this-spec implementation in either language should default to
stopping early.)

### 6.5 Softmax

```
softmax(logprobs: number[], temperature = 1.0) -> number[]
```

Numerically stable: subtract `max(logprobs / temperature)` before
exponentiating. If the exponentiated values sum to zero or the input is
empty, return a uniform distribution over the input length (or `[]` for
empty input) rather than dividing by zero.

## 7. Calibration (optional module)

Given pairs of `(Decision, correctOptionId)`:

- `expectedCalibrationError(pairs, temperature, bins = 10)`: bin
  predictions by confidence into `bins` equal-width buckets, compute
  `|avg_confidence - avg_accuracy|` per bucket weighted by bucket size,
  sum across buckets. Only pairs with ≥ 2 scored options are usable.
- `fitTemperature(pairs, grid?)`: grid-search (default: 0.1 to 10.0 in
  steps of 0.1) for the temperature minimizing mean negative
  log-likelihood of the correct answer, clamping any single probability
  to a `1e-9` floor to avoid `log(0)`. Requires ≥ 10 usable pairs.
  **MUST assert** that rescaling by the chosen temperature never changes
  any pair's argmax choice — this is a correctness invariant, not just a
  documentation claim, and a conforming implementation MUST verify it
  at runtime and fail loudly if violated.
- `evaluateOutOfFold(pairs, folds = 5, seed = 0)`: k-fold
  cross-validation of `fitTemperature`, using a seeded, reproducible
  shuffle. Requires ≥ `folds * 10` usable pairs.

## 8. Default `warmup`/`discoverTokensBatch` implementations

A `Backend` that does not override these gets exactly this behavior,
expressed purely in terms of `chat`:

```
warmup(model):
  chat(model, [{ role: "user", content: "." }])   // maxTokens defaults to 1

discoverTokensBatch(model, words):
  unique = deduplicate(words)
  if unique is empty: return empty map
  prompt = "List these {unique.length} words, one per line, exactly as given, nothing else:\n"
           + unique.join("\n")
  maxTokens = sum(word.length for word in unique) + unique.length * 4 + 8   // generous headroom
  result = chat(model, [{ role: "user", content: prompt }], maxTokens)
  // Walk result.logprobs in order. For the current target word, accumulate
  // tokens that are a genuine non-overshooting prefix of its remaining
  // text; once fully consumed, record it and advance to the next word.
  // A token that doesn't extend the current word ends that word's
  // attempt (record nothing for it) and is treated as a separator before
  // trying the next word. Return a map of only the words that were
  // fully, successfully spelled out.
```

**Why one word per line, not comma-separated:** a word's tokenization can
depend on what immediately precedes it — a token spanning a leading space
is often a distinct token id from the same text at a fresh line start.
Verified live: `"damaged"` asked for alone (or after a newline)
tokenizes as `["dam", "aged"]`; the same word asked for after `", "` in a
comma-separated list tokenizes as a single `" damaged"` token instead.
Only the fresh-line form matches the position a real race step's
`assistant`-prefix continuation is read from (§6.1 step 2), so
`discoverTokensBatch` MUST ask for a newline-separated list specifically.

`discoverTokens(model, word)` (single-word convenience) is exactly
`discoverTokensBatch(model, [word]).get(word) ?? []`.

## 9. Speculative token-boundary cache (optional, on by default)

### 9.1 Purpose

A model's tokenizer is, for practical purposes, a fixed function of a
given string — an option id that tokenized a certain way once against a
given model will very likely tokenize the same way again. A `TokenCache`
records `(model, optionId) -> observed token sequence` and lets
`decidePrefix` (§6.1) **predict** a candidate's next round's `consumed`
prefix instead of only discovering it reactively.

### 9.2 Storage

```
TokenCache {
  get(model, optionId) -> string[] | null
  set(model, optionId, tokens: string[]) -> void
  save() -> void   // flush to persistent storage if any; no-op if nothing changed
}
```

**MUST** default to on-disk persistence in a native (non-browser)
runtime — canonical path `~/.decidr/token-cache.json` for the Python
SDK, `~/.decidr-ts/token-cache.json` for the TypeScript SDK (deliberately
separate paths per language/repo — see `README.md`'s "Porting notes" for
why these are kept as two independent projects). **MUST** fall back to
an in-memory-only store, silently and without error, in any environment
without filesystem access (a browser) — this package is meant to run
there too (§10.1). A cache that fails to write for any reason (a
read-only filesystem, a permissions error) MUST NOT fail the calling
`decide()` — it degrades to in-memory-only for the rest of the process.

A `TokenCache` instance MAY be shared across multiple `Client` instances
targeting the same model, so discoveries from one `Client` benefit
another.

### 9.3 Speculative use in `decidePrefix` (§6.1, gated addendum)

Within the round loop (§6.1 step 5), when a round's real result confirms
a candidate's matched token equals the next token the cache predicts for
that candidate, the **round after that** MAY be pre-fired immediately —
concurrently with the rest of the current round still being processed —
using the predicted `consumed` prefix, rather than waiting for a fresh
round to begin. When a later round's real group turns out to need that
exact prefix, it reuses the already-in-flight speculative request instead
of starting a second, redundant one.

**This MUST be gated one round at a time on real confirmation from the
immediately preceding round — never speculate multiple rounds ahead
before any of them has been confirmed by a real response.** An earlier,
more aggressive design (firing every predicted round up front,
regardless of whether a candidate survives round 0 at all) was
implemented and measured live: it roughly **doubled** total request
count, because most candidates in a real multi-option race never survive
past round 0 (they fall out of `topLogprobs` and go `unscored` there).
Gated, one-round-ahead speculation is the specified behavior.

**A speculative response is used if and only if the real round it was
speculating past actually confirms the prediction it was based on.** A
wrong prediction costs exactly one wasted request; it can never produce
a wrong score, because every match — speculative or reactive — is
verified against real `topLogprobs` returned by a real request, the same
way (§6.1 step 5).

Only a **genuinely, fully complete** resolution (a candidate whose
`remaining` reached `""`, not `unscoredReason`, not `stoppedEarly`) is
written back to the cache after a `decidePrefix` call. Caching a partial
sequence (from an unscored or stopped-early candidate) would seed a
future prediction that is wrong on purpose.

### 9.4 `Client.warmup(row)`

```
warmup(row):
  if cache is enabled:
    uncached = row.options whose id has no cached entry for this model
    if uncached is non-empty:
      try: discovered = backend.discoverTokensBatch(model, uncached.map(id))
           for (optionId, tokens) in discovered: cache.set(model, optionId, tokens)
      catch: ignore — discovery is a pure optimization; decide() below still works correctly without it
    cache.save()
  else:
    backend.warmup(model)
  return decide(row)
```

## 10. Error handling

A `DecisionError` (or the implementing language's nearest equivalent —
e.g. a dedicated exception/error class, not a bare `ValueError`/generic
`Error`) MUST be raised, not silently absorbed, for:

- Any row validation failure (§5).
- A backend that cannot reach its provider at all (network failure).
- A non-2xx response from the provider, with the provider's own error
  detail included in the message where available.
- A race (§6.1) in which every candidate ended up `unscoredReason !== null`
  — i.e. nothing could be scored at all.
- A hierarchy level (§6.2) with more than 16 distinct branches.
- A content block (§2.2) whose `type` a given backend cannot send at all
  (video/audio on a backend with no such input) — raised, never silently
  dropped.

### 10.1 Multimodal wire translation per backend

- **Ollama** (`/api/chat`): text content stays in a message's `content`
  string; one or more `image` blocks in a message become that message's
  `images: string[]` field, each a **raw base64 string with no `data:`
  prefix**. An `image` block with only a `url` (no inline `data`) MUST
  raise — Ollama's chat endpoint has no way to fetch a remote URL itself.
- **OpenAI-compatible** (`/v1/chat/completions`): a message's `content`
  becomes an array of typed parts — `{type: "text", text}` for each text
  block, `{type: "image_url", image_url: {url}}` for each image block,
  where `url` is either the block's own `url` verbatim, or a constructed
  `data:{mimeType};base64,{data}` URI if only inline `data` was given
  (default `mimeType`: `"image/png"` if unspecified).

## 11. Performance requirements (normative, not merely advisory)

These are measured, reproducible behaviors a conformant implementation
MUST exhibit, not aspirational goals:

1. **Independent requests within one round, or independent hierarchy
   branches, MUST be sent concurrently**, never sequentially in a loop
   with individual `await`s. (§6.1 step 5, §6.2.) Verified live:
   sequential vs. concurrent group requests within a round measurably
   changes wall-clock latency by multiple seconds on a realistic
   multi-option race.
2. **Stopping early (§6.4) is the default, not opt-in.** Verified live,
   old (always-full-resolution) vs. new (stop-early) behavior on the
   same representative 8-option row against the same model: 5 requests /
   ~2061ms average → 1 request / ~542ms average (3.80x faster, 4.67x
   fewer requests, 3 runs each).
3. **`discoverTokensBatch` MUST batch all not-yet-cached ids into one
   request**, never one request per id. Verified live against 150 real
   option ids: all 150 correctly discovered in a single request.
4. **A cold connection to a hosted provider is measurably more expensive
   than a warm, reused one** (verified live against OpenAI: ~2.4s cold
   vs. ~0.75-1.0s warm on a reused connection) — a conformant HTTP
   backend SHOULD reuse connections (keep-alive) by default via whatever
   its runtime's standard HTTP client already does, and `Backend.warmup`
   (§8) exists specifically to let a caller pay that cost ahead of a
   latency-sensitive `decide()` call.
5. **No amount of client-side tuning closes the gap to a hosted
   provider's own server-side latency floor.** Published OpenAI best-case
   time-to-first-token is on the order of ~0.7s; sub-100ms round-trip
   latency to a hosted, non-colocated API is not achievable through this
   library's own optimizations, full stop. A conformant implementation
   MUST NOT claim or imply a sub-second latency guarantee against a
   generic hosted API in its own documentation.

## 12. Non-goals / explicitly out of scope

- **Letter-based (A/B/C) option labeling.** Removed from the design
  entirely; real option id text is always scored directly (§6.1).
- **A tokenizer API dependency.** No mechanism in this spec may assume
  access to a model's tokenizer ahead of time, via any provider API or
  local file. Token boundaries are always discovered empirically (§6.1,
  §8), never precomputed from an external vocabulary file.
- **Streaming responses.** Every request in this spec is a single,
  non-streamed completion call. A future spec version may add streaming
  support for the naive-baseline comparison use case (see
  `examples/webui`), but the core mechanism itself has no use for it.

# Question batching — design (not yet implemented)

Status: design only. Nothing in this file is implemented; `Client` has no
batching API today. Written to scope a specific, bounded change to the
existing mechanism (SPEC.md §6), not a rewrite.

## 1. The gap this closes

TypeSafe (a comparable product, `console.typesafe.ai`) supports asking
several independent questions about the same `state` in one request,
citing "11.5x cheaper and 9.6x faster than 13 separate calls" for 13
batched questions. decidr-ts has no equivalent: `Client.decideAll(rows)`
(core.ts) exists today, but it is a plain sequential loop —
`for (const row of rows) out.push(await this.decide(row))` — one full,
independent `decide()` per row, with none of the underlying HTTP
requests shared even when every row's `state` is identical.

The goal: when N `Row`s share the same `state`, answer all N with
meaningfully fewer physical requests than N separate `decide()` calls,
without changing what a single `decide()` call does or means.

## 2. Why this fits the existing mechanism, not a new one

§6.1's race already reads a **whole distribution** back from one
request — `top_logprobs` returns up to `OpenAIBackend.TOP_LOGPROBS` (20)
candidate tokens at a single generated position, not just the one the
model happened to emit. The race is already "one request → many bits of
signal," it just spends all of that signal on one option's next token
today.

Batching reframes the same trick one level up: instead of one request
answering "which token comes next for this one candidate," one request
answers "which token comes next for each of N independent candidates,"
by asking the model to emit N tokens — one per question, on its own
line — and reading `logprobs` per **generated position** instead of only
`logprobs[0]`. `ChatResult.logprobs` (types.ts) is already `LogprobEntry[]`,
one entry per generated position; `decidePrefix` today only ever reads
`result.logprobs[0]`. Nothing about the wire format needs to change —
only how many entries of it get used, and how they get routed back to
the right race.

## 3. Proposed shape

### 3.1 Grouping key

Two `Row`s are batchable together iff `JSON.stringify(a.state) ===
JSON.stringify(b.state)` (state is already required to be
JSON-serializable, per `validateRow`). `Client.decideBatch(rows: Row[])`
groups its input by this key; each group runs the batched mechanism
below; groups run concurrently with each other (same concurrency
requirement as §6.1 step 5 / §6.2's sibling exploration, §11).

A batch of size 1 degrades to exactly `decide()` — no special-casing
needed if the mechanism below is implemented generally.

### 3.2 One flat race per row, run in lockstep across a shared prompt

For a batch of rows `[r_1, ..., r_n]` sharing one `state`:

1. Build one candidate set **per row**, exactly as §6.1 step 1 does
   today for a single row — this is unchanged. Call these `race_1 .. race_n`.

2. Build **one** prompt for the whole batch:
   - System message: same idea as §6.1 step 2, but plural: "Apply the
     supplied criterion to each of the following questions about the
     supplied evidence, in order. Respond with exactly one line per
     question, each line containing only that question's chosen option
     id, in the order given."
   - User message: the shared `state`, followed by one line per row:
     `"{i}. {row.question}\nAnswer with exactly one of: {ids}."`
   - Assistant-prefix continuation (see 3.4): the concatenation of each
     race's own per-round prefix, joined by `"\n"`, one line per row, in
     the same fixed order every round.

3. Send **one** `chat` request per round (not one per row, not one per
   group-within-a-row) with `maxTokens: n` (one token per line, at
   minimum — see 3.5 for why this is a floor, not exact) instead of the
   `maxTokens: 1` a single flat race uses.

4. **Demultiplex the response.** `ChatResult.logprobs` is one
   `LogprobEntry` per generated position in the whole batched
   completion, in emission order. If the model is well-behaved (see 3.5),
   position `i` in that array corresponds to row `i+1`'s answer token for
   this round. Feed `logprobs[i]`'s `found` map (built exactly as §6.1
   step 5 does today) into `race_{i+1}`'s own `matchStep`/`groupByContext`
   bookkeeping, completely independently of every other row's race.

5. Everything downstream of "the group's `found` map for this round" is
   *exactly* §6.1 steps 5-9, run once per row against its own slice of
   the shared response. `stoppedEarly`, `unscored`, softmax, `choice` —
   all unchanged, all computed per-row exactly as they are today.

This is why it fits the existing architecture without a rewrite: only
step 2 (prompt construction) and step 4 (response routing) are new. The
race state machine, `matchStep`, `groupByContext`, softmax, and every
`Decision` field's meaning are untouched.

### 3.3 Multi-round batches (when a row's race needs more than one round)

Rows in a batch will not all finish in the same number of rounds — one
row's options may disambiguate in round 1, another's may need 3. Rule:
**a row drops out of the shared batched prompt once its race is fully
done** (every candidate `done`, per §6.1's existing definition), and its
line is simply omitted from that round's prompt and `maxTokens` budget.
The batch's shared request continues for however many rounds the
slowest-remaining row still needs — this is strictly better than today
(where that row would need its own rounds regardless), never worse.

A batch of one remaining row on some later round is just a normal §6.1
flat race for that row, run as its own single-row request — no
special-casing, this falls out of "omit finished rows" naturally.

### 3.4 The concatenated-assistant-prefix continuation

§6.1 step 4's within-row grouping (`groupByContext`) still applies
*within* each row's own race across rounds — a row's own candidates that
have diverged onto different `consumed` prefixes still need separate
lines/asks **for that row**, same as today. This means a single row can
itself contribute more than one line to the shared batched prompt in a
given round, if its own candidates have already split into multiple
groups. This is not a new case to design for — it is exactly "more
line-based sub-questions in the same one shared request," which 3.2's
mechanism already generalizes to (the "rows" being batched are really
"groups," and a single-`Row` `decide()` call is the batch-of-1 case of
grouping only within that row).

### 3.5 Real risk: the model doesn't answer one-token-per-line reliably

This is the actual open risk, not a solved problem. §6.1's single-row
race works because `maxTokens: 1` makes "what is the very next token"
unambiguous — there is exactly one generated position to read.
Multi-line batching asks the model to self-terminate each answer with a
newline before continuing to the next question, and there is no
guarantee: (a) the model doesn't emit extra whitespace/punctuation
tokens between lines that shift the position index out of alignment
with the row order, (b) the model doesn't answer a later question before
an earlier one despite the "in order" instruction, (c) a chat API's
`logprobs` array position reliably lines up 1:1 with newline-delimited
answer lines rather than with raw generated tokens (a single option id
can itself be multiple tokens, same as today, but now "one line" is not
the same unit as "one generated position").

This must be verified empirically (mirroring how `docs/PROVIDERS.md`
verifies logprobs support per provider — this is the same category of
claim, and treated with the same skepticism) before being trusted:
build a small standalone script that sends a 3-5 question batch to a
real backend, and directly inspect the raw per-position `logprobs`
response to confirm position-to-row alignment actually holds, before any
of this lands in `core.ts`. If alignment is NOT reliable, the fallback
is a stricter prompt (e.g. forcing an explicit `"1: <id>\n2: <id>"`
numbered format and parsing/validating the number prefix at each
position, discarding and falling back to an unbatched request for any
row whose line can't be confidently attributed) rather than assuming
positional order holds unconditionally.

## 4. Public API sketch

```ts
class Client {
  /** Like decideAll, but rows sharing an identical `state` are answered
   * via shared requests where the underlying mechanism allows it. Same
   * per-row Decision semantics and array order as decideAll -- this is
   * purely a request-count optimization, not a behavior change. */
  async decideBatch(rows: Row[]): Promise<Decision[]>;
}
```

`decideAll` stays as the always-correct, always-available fallback
(equivalent to `decideBatch` with every row in its own group of one).
`decideBatch` should never produce a different `Decision` for a given
row than calling `decide()` on it alone would — batching is an
optimization on cost/latency, never on the meaning of the answer. If
3.5's verification finds the position-alignment risk is not reliably
avoidable, `decideBatch` degrading to sequential `decide()` calls (with a
warning, not silently) is preferable to reporting a wrong `Decision`.

## 5. What this does NOT change

- `Decision`'s shape, `probabilities`/`unscored`/`eliminated`/`stoppedEarly`
  semantics (SPEC.md §2.3, §6.3): unchanged.
- Hierarchy resolution (§6.2): a batch of rows each independently uses
  `decideTree`/`decidePrefix` as their own sub-mechanism; a hierarchical
  row's own internal sub-races are not further batched against a
  *different* row's sub-races in this design (that would multiply the
  positional-alignment risk in 3.5 across an already-recursive
  structure). Only the top-level rows in a `decideBatch` call are batched
  against each other.
- Backend contract (§3): `Backend.chat` already accepts an arbitrary
  `maxTokens`; no new method is needed on the interface.

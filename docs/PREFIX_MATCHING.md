# Prefix matching and chain-rule scoring

How `decidr-ts` scores real option ids, why it needs more than one request for some inputs, and why it stops walking an option's id the moment nothing else is still competing for that same prefix.

Code: [`src/prefix.ts`](../src/prefix.ts). This doc explains the reasoning behind it; the module docstring is the shorter version.

**This TypeScript port's default differs from the [Python library](https://github.com/devanmolsharma/decidr) here, deliberately.** The core token-walking mechanism (steps 1-3 below) is identical. Where they diverge is step 4: Python always walks every option to the full end of its own id before scoring it, for strict comparability across options at different depths. decidr-ts's default instead stops the moment an option is the only one left racing for its current prefix — see "Stopping early: the actual default" below for what this trades away and why it was chosen anyway.

## The problem this solves

The straightforward way to read an option's probability off a model is to read the logprob of its id's first token. That breaks the moment an id isn't a single token — and most real option ids aren't (`access_denied` is several pieces in every tokenizer checked). A model's returned logprobs only cover the position it was actually asked about, so a multi-token id needs its own mechanism to be scored as a whole, not just its first piece.

That means finding out, for an arbitrary model, how a specific string tokenizes — and there is no general way to ask most providers that directly (no public Ollama endpoint exposes tokenization, and hosted APIs don't expose one either).

## The mechanism

1. **Ask, read the alternatives.** The model is given the option ids in the prompt and asked to answer with one of them. The next position's `topLogprobs` is the discovery mechanism — it's what reveals a real token boundary, since there's no other source for one. There's no way to name the exact token to look for in advance (that's the whole reason this mechanism exists at all), so it always reads a rank window, never a requested set.

2. **Match by prefix.** For every option still unresolved, check whether any returned token is a prefix of what's left to match for that option (`remaining`). A match consumes that many characters and adds the token's logprob to a running total.

   The match has to be a genuine prefix, checked in one direction only: the returned token must not extend past the option's remaining text. `none` is not accepted as a match for an option expecting `no` — that would silently misread a different word as a longer match.

   When more than one returned token would validly match, the longest one wins — it resolves more of the answer in the same step and is never wrong if it fits at all.

3. **Collisions batch into the next request.** If two or more options still have exactly the same consumed-so-far text, they're genuinely indistinguishable at this point and stay grouped (`groupByContext`). The next request repeats the original question with that shared prefix appended as the start of the assistant's answer (an `assistant` message containing the text so far), so the model continues from exactly where the group left off rather than restarting the whole answer.

   Options that already diverged from their group continue alone, each in their own request, from that point on.

4. **Stop the moment nothing else is still competing.** The instant an option is the only candidate left in its group — no other option shares its current consumed-so-far prefix anymore — decidr-ts stops walking it right there and scores it on whatever `logprobSum` it has accumulated so far. See "Stopping early: the actual default" below for what this costs and why it's the default anyway.

5. **Sum in log space, normalize once at the end.** Multiplying probabilities is summing their logs, so each option's `logprobSum` is exactly the sum of the per-step matched logprobs — no separate combination step, no re-deriving the same chain rule differently. Once every option is either resolved (fully or stopped early), or has been marked unscored (a step found no matching continuation for it — see below), the collected sums are passed through the same `softmax` the rest of the library uses, so the reported probabilities sum to 1 over whatever was actually scored.

## Stopping early: the actual default

Here's the case for walking every option to completion, which is the correct, fair thing to do and is what the Python library always does: a chain-rule probability accumulates by multiplication, `P(t1) * P(t2|t1) * P(t3|t1,t2) * ...`. Each additional term can only keep the running product the same or make it smaller (probabilities are ≤ 1). So an option that resolves in one token will, all else equal, end up with a *less negative* total log-probability than one that needed three tokens — not because it's semantically more likely, but purely because fewer terms were multiplied in. Comparing a one-token option's full probability against a three-token option's *partial* probability (stopped early, right after disambiguation) is comparing two different quantities and calling the result a fair distribution. It isn't one, strictly speaking.

decidr-ts's default trades that fairness guarantee away for speed. The moment an option is the sole survivor of its group, there's no other option left that it could still be confused with — so instead of paying for more requests to spell out the rest of its id, it's scored on its `logprobSum` as accumulated up to that point and marked `stoppedEarly`. Measured live: an 8-option flat race with several multi-token, partially-similar ids (`delay`, `damaged`, `defect`, `delete`, `dispute`, `escalation`, `cancellation`, `verification`) dropped from 5 requests (walking `delete`, `dispute`, and `escalation` to completion, or to their own unscored failure) to **1 request** — every survivor stopped as soon as it stood alone.

What this means for the numbers: an option marked `stoppedEarly` in `Decision.stoppedEarly` has a real, genuine partial logprob — not a guess, not a gap (it's still in `probabilities`, not `unscored`) — but it isn't a strictly comparable full `P(id | prompt)` against an option that needed more rounds and got them. In the measured example above, `delay` (no competition after round 0, so it happened to finish in full) and `escalation`/`delete`/`dispute` (stopped after 3 characters each) all appear in the same `probabilities` map, but `delay`'s number reflects its complete id while the others reflect only their first few characters. In practice this rarely changes which option wins — the survivor at each depth is still the one the model favored at that step — but a caller comparing exact probability values across options should check `stoppedEarly` first if it matters for their use case.

If you need Python's strict-comparability guarantee instead, `Client(model, { cache: false })` doesn't change this behavior (stopping early isn't part of the speculative cache) — there is currently no flag to force full resolution in decidr-ts. Use the [Python library](https://github.com/devanmolsharma/decidr) if that guarantee matters more to you than raw request count.

## What happens when a step finds nothing

Every request is capped by `topLogprobs` (20, matching Ollama's own server-side cap). If, at some step, none of the returned alternatives match what an option needs next, that option is marked unscored right there rather than assigned a guessed value and left to keep going. This can happen at any depth, not just the first one: a longer id has more chances to hit a step where its needed continuation didn't make the window.

A depth cap (`MAX_DEPTH` in `prefix.ts`, 6 rounds) exists as a safety valve for the case where an option never resolves and never gets marked unscored either — a pathological, non-terminating collision. Past that cap, anything still open is marked unscored rather than looping indefinitely.

## Cost in practice

Most real option sets don't share meaningful prefixes (`access`, `billing`, `shipping` diverge on their very first token), and resolve in exactly one request, with no cap on how many options there can be. The extra requests only happen for option sets that are deliberately similar (`access_denied` / `access_expired` / `access_revoked`), and even then, stopping early (above) means the request count tracks how many *rounds* were needed before every remaining candidate became a sole survivor, not how many options were in the collision, and not how long any individual id is.

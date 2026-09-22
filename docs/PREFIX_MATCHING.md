# Prefix matching and chain-rule scoring

How `decidr` scores real option ids, why it needs more than one request for some inputs, and why every option is walked to the end of its own id rather than stopped as soon as it's distinguishable from the others.

Code: [`src/prefix.ts`](../src/prefix.ts). This doc explains the reasoning behind it; the module docstring is the shorter version.

This is the TypeScript port's copy of the mechanism doc from the [Python library](https://github.com/devanmolsharma/decidr) — the mechanism itself is identical; only the code references changed.

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

4. **Every option is walked to completion — not just to disambiguation.** This is the part that isn't obvious from the mechanism alone: once an option no longer shares a prefix with anything else, it would be tempting to stop there and call it "identified." That's wrong for scoring, because the thing being compared across options has to be the same kind of quantity.

   A chain-rule probability accumulates by multiplication: `P(t1) * P(t2|t1) * P(t3|t1,t2) * ...`. Each additional term can only keep the running product the same or make it smaller (probabilities are ≤ 1). So an option that resolves in one token will, all else equal, end up with a *less negative* total log-probability than one that needed three tokens — not because it's semantically more likely, but purely because fewer terms were multiplied in. Comparing a one-token option's full probability against a three-token option's *partial* probability (stopped early, right after disambiguation) would be comparing two different things and calling the result a fair distribution. It isn't one.

   The fix is to never stop early: every option is walked all the way to the end of its own id, whether or not anything else is still colliding with it. A one-token option finishes in one step because that's genuinely all there is to it. A three-piece option takes three steps because that's what it actually costs to say the whole thing. Both numbers are then true full-sequence probabilities, and comparing them is valid.

5. **Sum in log space, normalize once at the end.** Multiplying probabilities is summing their logs, so each option's `logprobSum` is exactly the sum of the per-step matched logprobs — no separate combination step, no re-deriving the same chain rule differently. Once every option is either fully resolved or has been marked unscored (a step found no matching continuation for it — see below), the collected sums are passed through the same `softmax` the rest of the library uses, so the reported probabilities are comparable and sum to 1 over whatever was actually scored.

## What happens when a step finds nothing

Every request is capped by `topLogprobs` (20, matching Ollama's own server-side cap). If, at some step, none of the returned alternatives match what an option needs next, that option is marked unscored right there rather than assigned a guessed value and left to keep going. This can happen at any depth, not just the first one: a longer id has more chances to hit a step where its needed continuation didn't make the window.

A depth cap (`MAX_DEPTH` in `prefix.ts`, 6 rounds) exists as a safety valve for the case where an option never resolves and never gets marked unscored either — a pathological, non-terminating collision. Past that cap, anything still open is marked unscored rather than looping indefinitely.

## Cost in practice

Most real option sets don't share meaningful prefixes (`access`, `billing`, `shipping` diverge on their very first token), and resolve in exactly one request, with no cap on how many options there can be. The extra requests only happen for option sets that are deliberately similar (`access_denied` / `access_expired` / `access_revoked`), and even then, the batching in step 3 means the request count tracks how many *rounds* of disambiguation were needed, not how many options were in the collision.

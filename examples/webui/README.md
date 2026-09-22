# decidr-ts playground

**[Live demo](https://devanmolsharma.github.io/decidr-ts/)**

An in-browser playground for [decidr-ts](../../README.md), styled after
TypeSafe's own console: a thin top bar (pick a provider/model, paste an
API key, load an example) above three columns -- **State**, **Questions**,
**Results** -- each a real JSON editor or a live rendered result, no
server involved. Every request goes straight from your browser to
whichever provider you pick.

![The playground running a real Choice + Score request against Cerebras](screenshots/playground-results.png)

## Providers

OpenAI, Cerebras, Together AI, a local Ollama, or any other
OpenAI-compatible endpoint (`Custom`) -- see [`src/lib/providers.ts`](src/lib/providers.ts)
for the exact model ids and why each one is or isn't listed (only
providers/models independently confirmed to return real `logprobs` are
included; see the repo root's [`docs/PROVIDERS.md`](../../docs/PROVIDERS.md)
for the full research). Cerebras is the default -- its specialized
inference hardware is consistently 2-6x faster than a general hosted API
on identical requests (see the root README's
[Benchmarks](../../README.md#benchmarks) section for real numbers).

## The three primitives

Every question in the **Questions** panel is one of:

- **Choice** -- `Client.decide`. Pick the best option from a fixed set of ids.
- **Score** -- `Client.score`. Place the state on an ordered rubric, low to high.
- **Noun** -- `Client.truth`. A single true/false probability.

Multiple questions can run against the same **State** in one click; each
still fires as its own independent request today -- decidr-ts has no
real multi-question batching yet (see the root repo's
[`docs/BATCHING_DESIGN.md`](../../docs/BATCHING_DESIGN.md), design only).

Every result shows the **full option space**, not just what scored --
unscored and eliminated options are shown too (`*`/`**` markers), so the
demo never looks like it's hiding anything. See
[`docs/PREFIX_MATCHING.md`](../../docs/PREFIX_MATCHING.md) and
[`docs/HIERARCHY.md`](../../docs/HIERARCHY.md) for what those states mean.

![Choice/Score/Noun together on a multimodal (image) row](screenshots/vision-example.png)

## Exhaustive mode

The toggle next to **Run request** maps directly to `Client`'s own
`exhaustive` option -- off (the default here) explores only the winning
path through a hierarchical Choice's id tree (cheaper, partial coverage:
losing multi-option branches show up as `eliminated`); on explores every
branch for a complete distribution (more requests, every option gets a
real, comparable probability). See
[`docs/HIERARCHY.md`](../../docs/HIERARCHY.md#exhaustive-vs-cheap-new-clientmodel--exhaustive-)
for the full tradeoff.

## Develop

```sh
npm install
npm run dev
```

This links the local `decidr-ts` package from the repo root via
`"decidr-ts": "file:../.."` in `package.json` -- run `npm run build` in
the repo root first if `../../dist` isn't already built.

## Build

```sh
npm run build
```

Outputs static files to `dist/`. `vite.config.ts`'s `base: "/decidr-ts/"`
is set for this exact GitHub Pages project site
(`https://devanmolsharma.github.io/decidr-ts/`) -- change it if you fork
this and deploy elsewhere.

## Deploy

Pushes to `master` that touch `src/` or `examples/webui/` automatically
build and deploy via [`.github/workflows/deploy-webui.yml`](../../.github/workflows/deploy-webui.yml)
(GitHub Actions -> Pages). Trigger a manual redeploy from the Actions tab
(`workflow_dispatch`) if needed.

## Structure

- `src/lib/providers.ts` -- the provider/model list, each entry backed by real, independently-checked `logprobs` support.
- `src/lib/examples.ts` -- the example presets (support ticket routing, vision classification, a traffic-light and a chart-reading multimodal example, multi-agent routing, tic-tac-toe, and a 150-option scale demo).
- `src/lib/question-types.ts`, `run-question.ts` -- the Questions JSON schema and what actually runs each primitive against `decidr-ts`.
- `src/components/DistributionChart.tsx` -- renders every option in a row's full option space, not just the ones that ended up scored.
- `src/components/JsonEditor.tsx` -- the CodeMirror-based State/Questions editor.
- `src/components/TopBar.tsx`, `PlaygroundPage.tsx` -- the app shell and the three-column layout.

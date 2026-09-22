# decidr-ts showcase

A static, browser-only dashboard for decidr-ts's examples. Pastes an OpenAI
API key into page memory and calls `api.openai.com` straight from your
browser -- no server, nothing sent anywhere else.

## Run it

```bash
cd ../..                    # repo root
npm run build:browser       # bundles src/ into public/decidr.bundle.js
cd examples/webui/public
python3 -m http.server 8080 # or any static file server
```

Then open `http://localhost:8080`, paste an `OPENAI_API_KEY`, and click
through the examples in the sidebar.

## Deploying (e.g. GitHub Pages)

`public/` is fully self-contained and static -- deploy it as-is. Re-run
`npm run build:browser` first if you've changed anything under `src/`.

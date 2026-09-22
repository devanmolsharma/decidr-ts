import assert from "node:assert/strict";
import { test } from "node:test";
import { DecisionError, OllamaBackend, OpenAIBackend } from "../src/backend.js";
import type { ChatMessage } from "../src/types.js";

function stubFetch(t: any, captureBody: (body: any) => void, response: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captureBody(JSON.parse(init.body as string));
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("OllamaBackend: translates an image block into images[] with raw base64", async (t) => {
  let captured: any;
  stubFetch(
    t,
    (body) => (captured = body),
    { message: { content: "x" }, logprobs: [] },
  );
  const backend = new OllamaBackend();
  const messages: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", data: "aGVsbG8=" }] },
  ];
  await backend.chat("m", messages);
  assert.equal(captured.messages[0].content, "what is this");
  assert.deepEqual(captured.messages[0].images, ["aGVsbG8="]);
});

test("OllamaBackend: image block with only a url raises (Ollama can't fetch remote urls)", async () => {
  const backend = new OllamaBackend();
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "image", url: "https://x/y.png" }] }];
  await assert.rejects(() => backend.chat("m", messages), DecisionError);
});

test("OllamaBackend: video block raises -- no video input on Ollama's chat API", async () => {
  const backend = new OllamaBackend();
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "video", data: "aGVsbG8=" }] }];
  await assert.rejects(() => backend.chat("m", messages), DecisionError);
});

test("OpenAIBackend: translates blocks into OpenAI's typed content array", async (t) => {
  let captured: any;
  stubFetch(
    t,
    (body) => (captured = body),
    { choices: [{ message: { content: "x" }, logprobs: { content: [] } }] },
  );
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
    },
  ];
  await backend.chat("m", messages);
  assert.deepEqual(captured.messages[0].content, [
    { type: "text", text: "what is this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
  ]);
});

test("OpenAIBackend: image block with a plain url is passed through unchanged", async (t) => {
  let captured: any;
  stubFetch(
    t,
    (body) => (captured = body),
    { choices: [{ message: { content: "x" }, logprobs: { content: [] } }] },
  );
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "image", url: "https://x/y.png" }] }];
  await backend.chat("m", messages);
  assert.deepEqual(captured.messages[0].content, [{ type: "image_url", image_url: { url: "https://x/y.png" } }]);
});

test("OpenAIBackend: video block raises -- no video input on chat completions", async () => {
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "video", url: "https://x/y.mp4" }] }];
  await assert.rejects(() => backend.chat("m", messages), DecisionError);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DecisionError, OpenAIBackend } from "../src/backend.js";
import type { ChatMessage } from "../src/types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function openaiCompletion(overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "cat" },
        finish_reason: "length",
        logprobs: {
          content: [
            { token: "cat", logprob: -0.1, top_logprobs: [{ token: "cat", logprob: -0.1 }, { token: "dog", logprob: -2.0 }] },
          ],
        },
      },
    ],
    ...overrides,
  };
}

test("OpenAIBackend: normalizes a real OpenAI-shaped response into ChatResult", async () => {
  let capturedBody: any;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, openaiCompletion());
  }) as typeof fetch;

  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
  const result = await backend.chat("test-model", messages);

  assert.equal(result.content, "cat");
  assert.equal(result.logprobs.length, 1);
  assert.equal(result.logprobs[0]!.token, "cat");
  assert.deepEqual(result.logprobs[0]!.topLogprobs, [{ token: "cat", logprob: -0.1 }, { token: "dog", logprob: -2.0 }]);
  assert.equal(capturedBody.top_logprobs, OpenAIBackend.TOP_LOGPROBS);
  assert.equal(capturedBody.temperature, 0);
});

test("OpenAIBackend: empty logprobs.content becomes an empty logprobs array", async () => {
  const fakeFetch = (async () => jsonResponse(200, openaiCompletion({ choices: [{ index: 0, message: { role: "assistant", content: "x" }, finish_reason: "stop", logprobs: null }] }))) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  const result = await backend.chat("test-model", [{ role: "user", content: "hi" }]);
  assert.deepEqual(result.logprobs, []);
});

test("OpenAIBackend: reasoning_effort auto-detection -- sent by default, kept on success", async () => {
  let capturedBody: any;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, openaiCompletion());
  }) as typeof fetch;

  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  await backend.chat("test-model", [{ role: "user", content: "hi" }]);
  assert.equal(capturedBody.reasoning_effort, "none");
});

test("OpenAIBackend: reasoning_effort -- on a 400 unrecognized-argument rejection, retries without it and remembers", async () => {
  let callCount = 0;
  const bodies: any[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    callCount++;
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    if (body.reasoning_effort !== undefined) {
      return jsonResponse(400, { error: { message: "Unrecognized request argument supplied: reasoning_effort", type: "invalid_request_error" } });
    }
    return jsonResponse(200, openaiCompletion());
  }) as typeof fetch;

  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });

  const first = await backend.chat("test-model", [{ role: "user", content: "hi" }]);
  assert.equal(first.content, "cat");
  assert.equal(callCount, 2); // one rejected attempt with the field, one successful retry without it
  assert.equal(bodies[0].reasoning_effort, "none");
  assert.equal(bodies[1].reasoning_effort, undefined);

  // Second call on the same backend instance should go straight to the
  // no-reasoning-effort shape, no wasted rejected attempt.
  callCount = 0;
  await backend.chat("test-model", [{ role: "user", content: "hi again" }]);
  assert.equal(callCount, 1);
  assert.equal(bodies[2].reasoning_effort, undefined);
});

test("OpenAIBackend: a 400 for an unrelated reason is not treated as the reasoning_effort case", async () => {
  const fakeFetch = (async () =>
    jsonResponse(400, { error: { message: "Invalid value for 'temperature': must be between 0 and 2", type: "invalid_request_error" } })) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  await assert.rejects(() => backend.chat("test-model", [{ role: "user", content: "hi" }]), DecisionError);
});

test("OpenAIBackend: a network failure raises DecisionError", async () => {
  const fakeFetch = (async () => {
    throw new Error("network unreachable");
  }) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  await assert.rejects(() => backend.chat("test-model", [{ role: "user", content: "hi" }]), DecisionError);
});

test("OpenAIBackend: translates an image block into OpenAI's typed content array", async () => {
  let capturedBody: any;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return jsonResponse(200, openaiCompletion());
  }) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  const messages: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }] },
  ];
  await backend.chat("test-model", messages);
  const userMessage = capturedBody.messages.find((m: any) => m.role === "user");
  assert.deepEqual(userMessage.content, [
    { type: "text", text: "what is this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
  ]);
});

test("OpenAIBackend: a video block raises -- chat completions has no video input", async () => {
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: (async () => jsonResponse(200, openaiCompletion())) as typeof fetch });
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "video", url: "https://x/y.mp4" }] }];
  await assert.rejects(() => backend.chat("test-model", messages), DecisionError);
});

test("OpenAIBackend.discoverTokensBatch: splits a multi-word response at each word's boundary", async () => {
  const fakeFetch = (async () =>
    jsonResponse(
      200,
      openaiCompletion({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "delay\ndamaged" },
            finish_reason: "length",
            logprobs: {
              content: [
                { token: "delay", logprob: -0.1, top_logprobs: [] },
                { token: "\n", logprob: -0.1, top_logprobs: [] },
                { token: "dam", logprob: -0.1, top_logprobs: [] },
                { token: "aged", logprob: -0.1, top_logprobs: [] },
              ],
            },
          },
        ],
      }),
    )) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  const result = await backend.discoverTokensBatch("test-model", ["delay", "damaged"]);
  assert.deepEqual(result.get("delay"), ["delay"]);
  assert.deepEqual(result.get("damaged"), ["dam", "aged"]);
});

test("OpenAIBackend.discoverTokensBatch: empty word list makes no request", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return jsonResponse(200, openaiCompletion());
  }) as typeof fetch;
  const backend = new OpenAIBackend({ apiKey: "sk-test", fetch: fakeFetch });
  const result = await backend.discoverTokensBatch("test-model", []);
  assert.equal(result.size, 0);
  assert.equal(calls, 0);
});

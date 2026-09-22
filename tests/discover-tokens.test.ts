import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIBackend } from "../src/backend.js";
import { Client } from "../src/core.js";
import { TokenCache } from "../src/speculative-cache.js";
import { FakeBackend, singleTokenReply } from "./fake-backend.js";
import type { Row } from "../src/types.js";

function stubFetch(t: any, response: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function multiTokenResponse(tokens: string[]) {
  return {
    choices: [
      {
        message: { content: tokens.join("") },
        logprobs: {
          content: tokens.map((token) => ({ token, logprob: -0.1, top_logprobs: [{ token, logprob: -0.1 }] })),
        },
      },
    ],
  };
}

test("OpenAIBackend.discoverTokens: returns the exact token sequence that spells the word", async (t) => {
  stubFetch(t, multiTokenResponse(["dam", "aged"]));
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const tokens = await backend.discoverTokens("gpt-4o-mini", "damaged");
  assert.deepEqual(tokens, ["dam", "aged"]);
});

test("OpenAIBackend.discoverTokens: trims trailing tokens beyond the word", async (t) => {
  // The model was asked for the word alone but appended a period anyway --
  // discoverTokens must not include it, since a real race step would
  // never see or need it.
  stubFetch(t, multiTokenResponse(["delay", "."]));
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const tokens = await backend.discoverTokens("gpt-4o-mini", "delay");
  assert.deepEqual(tokens, ["delay"]);
});

test("OpenAIBackend.discoverTokens: returns empty if the response never actually spells the word", async (t) => {
  stubFetch(t, multiTokenResponse(["something", "else"]));
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const tokens = await backend.discoverTokens("gpt-4o-mini", "delay");
  assert.deepEqual(tokens, []);
});

test("OpenAIBackend.discoverTokensBatch: splits a multi-word response at each word's boundary", async (t) => {
  // "delay\ndamaged\ndefect" listed one per line, matching what a real
  // newline-separated response looks like tokenized.
  stubFetch(t, multiTokenResponse(["delay", "\n", "dam", "aged", "\n", "def", "ect"]));
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const result = await backend.discoverTokensBatch("gpt-4o-mini", ["delay", "damaged", "defect"]);
  assert.deepEqual(result.get("delay"), ["delay"]);
  assert.deepEqual(result.get("damaged"), ["dam", "aged"]);
  assert.deepEqual(result.get("defect"), ["def", "ect"]);
});

test("OpenAIBackend.discoverTokensBatch: deduplicates repeated words", async (t) => {
  stubFetch(t, multiTokenResponse(["delay", "\n", "delay"]));
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const result = await backend.discoverTokensBatch("gpt-4o-mini", ["delay", "delay"]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("delay"), ["delay"]);
});

test("OpenAIBackend.discoverTokensBatch: empty word list makes no request", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const backend = new OpenAIBackend({ apiKey: "sk-test" });
  const result = await backend.discoverTokensBatch("gpt-4o-mini", []);
  assert.equal(result.size, 0);
  assert.equal(calls, 0);
});

function multiTokenRow(): Row {
  return {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "billing", description: "d" },
      { id: "shipping", description: "d" },
    ],
  };
}

test("Client.warmup: seeds the cache via discoverTokens, then decides correctly", async () => {
  const cache = new TokenCache({ persist: false });
  const backend = new FakeBackend((messages) => {
    const user = messages.find((m) => m.role === "user")!.content;
    const text = typeof user === "string" ? user : "";
    if (text.startsWith("List these")) {
      // Simulate discoverTokens' own request/response shape via the fake
      // backend's single-position reply -- good enough to prove warmup
      // wires discoverTokens into the cache; discoverTokens' own parsing
      // is covered directly against OpenAIBackend above.
      return singleTokenReply("billing", -0.1, []);
    }
    return singleTokenReply("billing", -0.1, [["shipping", -2.0]]);
  });
  const client = new Client("test-model", { backend, cache });
  const decision = await client.warmup(multiTokenRow());
  assert.equal(decision.choice, "billing");
});

test("Client.warmup: does not re-discover an option id that's already cached", async () => {
  const cache = new TokenCache({ persist: false });
  cache.set("test-model", "billing", ["billing"]);
  cache.set("test-model", "shipping", ["shipping"]);

  let discoverCalls = 0;
  const backend = new FakeBackend((messages) => {
    const user = messages.find((m) => m.role === "user")!.content;
    const text = typeof user === "string" ? user : "";
    if (text.startsWith("List these")) discoverCalls++;
    return singleTokenReply("billing", -0.1, [["shipping", -2.0]]);
  });
  const client = new Client("test-model", { backend, cache });
  await client.warmup(multiTokenRow());
  assert.equal(discoverCalls, 0);
});

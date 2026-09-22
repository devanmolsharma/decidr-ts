import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "../src/core.js";
import { TokenCache } from "../src/speculative-cache.js";
import { FakeBackend, singleTokenReply } from "./fake-backend.js";
import type { Row } from "../src/types.js";

test("TokenCache: in-memory (persist: false) round-trips a value", () => {
  const cache = new TokenCache({ persist: false });
  assert.equal(cache.get("m1", "billing"), null);
  cache.set("m1", "billing", ["bill", "ing"]);
  assert.deepEqual(cache.get("m1", "billing"), ["bill", "ing"]);
});

test("TokenCache: keys are scoped per model", () => {
  const cache = new TokenCache({ persist: false });
  cache.set("model-a", "billing", ["billing"]);
  assert.equal(cache.get("model-b", "billing"), null);
});

test("TokenCache: save() with persist:false never throws", () => {
  const cache = new TokenCache({ persist: false });
  cache.set("m1", "x", ["x"]);
  assert.doesNotThrow(() => cache.save());
});

function multiTokenRow(): Row {
  return {
    id: "r1", state: "s", question: "q",
    options: [{ id: "billing", description: "d" }, { id: "shipping", description: "d" }],
  };
}

test("Client with a wrong pre-seeded prediction still produces a correct decision", async () => {
  const cache = new TokenCache({ persist: false });
  cache.set("test-model", "billing", ["totally", "wrong", "guess"]);
  const backend = new FakeBackend(() => singleTokenReply("billing", -0.1, [["shipping", -2.0]]));
  const client = new Client("test-model", { backend, cache });
  const decision = await client.decide(multiTokenRow());
  assert.equal(decision.choice, "billing");
  assert.ok(decision.probabilities.get("billing")! > decision.probabilities.get("shipping")!);
});

test("Client with a correct pre-seeded prediction still produces the same correct decision", async () => {
  const cache = new TokenCache({ persist: false });
  cache.set("test-model", "billing", ["billing"]);
  const backend = new FakeBackend(() => singleTokenReply("billing", -0.1, [["shipping", -2.0]]));
  const client = new Client("test-model", { backend, cache });
  const decision = await client.decide(multiTokenRow());
  assert.equal(decision.choice, "billing");
});

test("Client: a TokenCache instance can be shared across two Clients", async () => {
  const cache = new TokenCache({ persist: false });
  const backend1 = new FakeBackend(() => singleTokenReply("billing", -0.1, [["shipping", -2.0]]));
  const client1 = new Client("shared-model", { backend: backend1, cache });
  await client1.decide(multiTokenRow());
  assert.deepEqual(cache.get("shared-model", "billing"), ["billing"]);
});

test("Client.warmup: seeds the cache via discoverTokensBatch, then decides correctly", async () => {
  const cache = new TokenCache({ persist: false });
  const backend = new FakeBackend(() => singleTokenReply("billing", -0.1, [["shipping", -2.0]]));
  const client = new Client("test-model", { backend, cache });
  const decision = await client.warmup(multiTokenRow());
  assert.equal(decision.choice, "billing");
  // FakeBackend's discoverTokensBatch treats each word as one opaque token.
  assert.deepEqual(cache.get("test-model", "billing"), ["billing"]);
});

test("Client.warmup: does not re-discover an option id that's already cached", async () => {
  const cache = new TokenCache({ persist: false });
  cache.set("test-model", "billing", ["billing"]);
  cache.set("test-model", "shipping", ["shipping"]);
  let discoverCalls = 0;
  const backend = new FakeBackend(() => singleTokenReply("billing", -0.1, [["shipping", -2.0]]));
  const originalDiscover = backend.discoverTokensBatch.bind(backend);
  backend.discoverTokensBatch = async (model, words) => {
    discoverCalls++;
    return originalDiscover(model, words);
  };
  const client = new Client("test-model", { backend, cache });
  await client.warmup(multiTokenRow());
  assert.equal(discoverCalls, 0);
});

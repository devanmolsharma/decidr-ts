import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, MAX_ID_LENGTH, softmax, validateRow } from "../src/core.js";
import { DecisionError } from "../src/backend.js";
import { FakeBackend, noLogprobsReply, singleTokenReply } from "./fake-backend.js";
import type { Row } from "../src/types.js";

test("softmax: numerically stable, sums to 1", () => {
  const probs = softmax([1000, 999, 998]);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(probs[0]! > probs[1]! && probs[1]! > probs[2]!);
});

test("softmax: empty input returns empty", () => {
  assert.deepEqual(softmax([]), []);
});

test("validateRow: accepts a well-formed row", () => {
  assert.doesNotThrow(() =>
    validateRow({
      id: "r1",
      state: "hello",
      question: "which?",
      options: [
        { id: "a", description: "d" },
        { id: "b", description: "d" },
      ],
    }),
  );
});

test("validateRow: rejects fewer than 2 options", () => {
  assert.throws(
    () =>
      validateRow({
        id: "r1",
        state: "s",
        question: "q",
        options: [{ id: "a", description: "d" }],
      }),
    DecisionError,
  );
});

test("validateRow: rejects duplicate option ids", () => {
  assert.throws(
    () =>
      validateRow({
        id: "r1",
        state: "s",
        question: "q",
        options: [
          { id: "a", description: "d" },
          { id: "a", description: "d2" },
        ],
      }),
    DecisionError,
  );
});

test("validateRow: rejects ids over MAX_ID_LENGTH", () => {
  const longId = "a".repeat(MAX_ID_LENGTH + 1);
  assert.throws(
    () =>
      validateRow({
        id: "r1",
        state: "s",
        question: "q",
        options: [
          { id: longId, description: "d" },
          { id: "b", description: "d" },
        ],
      }),
    DecisionError,
  );
});

test("validateRow: rejects ids with invalid characters", () => {
  assert.throws(
    () =>
      validateRow({
        id: "r1",
        state: "s",
        question: "q",
        options: [
          { id: "Bad-ID", description: "d" },
          { id: "b", description: "d" },
        ],
      }),
    DecisionError,
  );
});

test("validateRow: rejects a segment-prefix ambiguity", () => {
  assert.throws(
    () =>
      validateRow({
        id: "r1",
        state: "s",
        question: "q",
        options: [
          { id: "billing", description: "d" },
          { id: "billing_refund", description: "d" },
        ],
      }),
    DecisionError,
  );
});

test("validateRow: checkIdFormat=false skips format checks", () => {
  assert.doesNotThrow(() =>
    validateRow(
      {
        id: "r1",
        state: "s",
        question: "q",
        options: [
          { id: "Bad-ID", description: "d" },
          { id: "b", description: "d" },
        ],
      },
      false,
    ),
  );
});

function flatRow(): Row {
  return {
    id: "r1",
    state: "customer is angry about a late refund",
    question: "which category?",
    options: [
      { id: "bug", description: "software defect" },
      { id: "billing", description: "payment issue" },
    ],
  };
}

test("Client.decide: flat options, single round, picks the winner", async () => {
  const backend = new FakeBackend(() => singleTokenReply("billing", -0.1, [["bug", -2.0]]));
  const client = new Client("test-model", { backend, cache: false });
  const decision = await client.decide(flatRow());
  assert.equal(decision.choice, "billing");
  assert.ok(decision.probabilities.get("billing")! > decision.probabilities.get("bug")!);
  assert.equal(decision.unscored.length, 0);
  assert.equal(decision.rawAnswer, "billing");
});

test("Client.decide: hierarchy explores both branches when exhaustive (default)", async () => {
  const row: Row = {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "billing_refund", description: "wants refund" },
      { id: "billing_dispute", description: "disputes charge" },
      { id: "bug_crash", description: "app crashed" },
      { id: "bug_slow", description: "app is slow" },
    ],
  };
  const backend = new FakeBackend((messages) => {
    const user = messages.find((m) => m.role === "user")!.content;
    if (user.includes("billing, bug")) {
      return singleTokenReply("billing", -0.1, [["bug", -1.0]]);
    }
    if (user.includes("refund, dispute")) {
      return singleTokenReply("refund", -0.2, [["dispute", -1.0]]);
    }
    if (user.includes("crash, slow")) {
      return singleTokenReply("crash", -0.3, [["slow", -1.2]]);
    }
    throw new Error(`unexpected prompt: ${user}`);
  });
  const client = new Client("test-model", { backend, exhaustive: true, cache: false });
  const decision = await client.decide(row);
  assert.equal(decision.choice, "billing_refund");
  // exhaustive: every leaf gets a real probability, nothing eliminated
  assert.equal(decision.probabilities.size, 4);
  assert.equal(decision.eliminated.length, 0);
});

test("Client.decide: non-exhaustive leaves losing branch in eliminated", async () => {
  const row: Row = {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "billing_refund", description: "wants refund" },
      { id: "billing_dispute", description: "disputes charge" },
      { id: "bug_crash", description: "app crashed" },
      { id: "bug_slow", description: "app is slow" },
    ],
  };
  const backend = new FakeBackend((messages) => {
    const user = messages.find((m) => m.role === "user")!.content;
    if (user.includes("billing, bug")) {
      return singleTokenReply("billing", -0.1, [["bug", -1.0]]);
    }
    if (user.includes("refund, dispute")) {
      return singleTokenReply("refund", -0.2, [["dispute", -1.0]]);
    }
    throw new Error(`unexpected prompt (should not explore losing branch): ${user}`);
  });
  const client = new Client("test-model", { backend, exhaustive: false, cache: false });
  const decision = await client.decide(row);
  assert.equal(decision.choice, "billing_refund");
  assert.equal(decision.probabilities.size, 2);
  assert.deepEqual(new Set(decision.eliminated), new Set(["bug_crash", "bug_slow"]));
});

test("Client.decide: no logprobs at all raises DecisionError", async () => {
  const backend = new FakeBackend(() => noLogprobsReply());
  const client = new Client("test-model", { backend, cache: false });
  await assert.rejects(() => client.decide(flatRow()), DecisionError);
});

test("Client.decide: unmatched tokens go to unscored, not a thrown error, if others resolve", async () => {
  const row: Row = {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "alpha", description: "d" },
      { id: "beta", description: "d" },
      { id: "gamma", description: "d" },
    ],
  };
  const backend = new FakeBackend(() =>
    // only "alpha" and "beta" ever show up as tokens; "gamma" never matches
    singleTokenReply("alpha", -0.1, [["beta", -0.5]]),
  );
  const client = new Client("test-model", { backend, cache: false });
  const decision = await client.decide(row);
  assert.equal(decision.choice, "alpha");
  assert.ok(decision.unscored.includes("gamma"));
  assert.equal(decision.probabilities.has("gamma"), false);
});

test("Client.decide: a sole-surviving candidate stops immediately, no follow-up request", async () => {
  // "alpha" diverges from "beta" on the very first token, so round 0
  // already leaves each as the only candidate in its own group. Default
  // behavior: stop right there and score on the partial logprobSum --
  // no round-1 request for either, since nothing is still racing against
  // them for their own prefix.
  const row: Row = {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "alpha", description: "d" },
      { id: "beta", description: "d" },
    ],
  };
  let calls = 0;
  const backend = new FakeBackend(() => {
    calls++;
    return singleTokenReply("a", -0.1, [["b", -1.0]]);
  });
  const client = new Client("test-model", { backend, cache: false });
  const decision = await client.decide(row);
  assert.equal(decision.choice, "alpha");
  assert.equal(calls, 1); // round 0 only -- both became sole survivors and stopped there
  assert.deepEqual(new Set(decision.stoppedEarly), new Set(["alpha", "beta"]));
  assert.equal(decision.unscored.length, 0); // a partial score is not a measurement gap
});

test("Client.decide: stoppedEarly options are still scored, not excluded from probabilities", async () => {
  const row: Row = {
    id: "r1",
    state: "s",
    question: "q",
    options: [
      { id: "alpha", description: "d" },
      { id: "beta", description: "d" },
    ],
  };
  const backend = new FakeBackend(() => singleTokenReply("a", -0.1, [["b", -1.0]]));
  const client = new Client("test-model", { backend, cache: false });
  const decision = await client.decide(row);
  assert.equal(decision.probabilities.size, 2);
  assert.ok(decision.probabilities.has("alpha"));
  assert.ok(decision.probabilities.has("beta"));
});

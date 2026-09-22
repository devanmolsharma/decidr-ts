import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrefixMessages, buildTree, Candidate, groupByContext, matchStep, PREFIX_SYSTEM } from "../src/prefix.js";

test("buildPrefixMessages: string state, no prefix", () => {
  const messages = buildPrefixMessages({
    state: "customer says the app crashed",
    question: "what category?",
    options: [
      { id: "bug", description: "software defect" },
      { id: "billing", description: "payment issue" },
    ],
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: PREFIX_SYSTEM });
  assert.match(messages[1]!.content as string, /customer says the app crashed/);
  assert.match(messages[1]!.content as string, /Answer with exactly one of: bug, billing\./);
});

test("buildPrefixMessages: object state is JSON-serialized, prefix appended", () => {
  const messages = buildPrefixMessages(
    { state: { ticket: 42 }, question: "route it", options: [{ id: "a", description: "a" }, { id: "b", description: "b" }] },
    "bil",
  );
  assert.match(messages[1]!.content as string, /"ticket":42/);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[2], { role: "assistant", content: "bil" });
});

test("buildPrefixMessages: content-block state stays an array with instructions appended as text", () => {
  const messages = buildPrefixMessages({
    state: [{ type: "image", url: "https://example.com/cat.png" }],
    question: "what animal?",
    options: [{ id: "cat", description: "d" }, { id: "dog", description: "d" }],
  });
  const user = messages[1]!;
  assert.ok(Array.isArray(user.content));
  const blocks = user.content as { type: string }[];
  assert.equal(blocks[0]!.type, "image");
  assert.equal(blocks[1]!.type, "text");
});

test("matchStep: longest non-overshooting prefix wins, mutates in place", () => {
  const candidates = [new Candidate("billing_refund", "billing_refund"), new Candidate("bug", "bug")];
  const found = new Map([["bill", -0.1], ["billing", -0.2], ["billing_refund", -5.0], ["b", -0.3]]);
  matchStep(candidates, found);
  assert.equal(candidates[0]!.consumed, "billing_refund");
  assert.equal(candidates[0]!.remaining, "");
  assert.ok(candidates[0]!.done);
  assert.equal(candidates[1]!.consumed, "b");
  assert.equal(candidates[1]!.remaining, "ug");
  assert.ok(!candidates[1]!.done);
});

test("matchStep: overshoot is rejected, treated as no match", () => {
  const candidates = [new Candidate("bug", "bug")];
  matchStep(candidates, new Map([["bugs", -0.1]]));
  assert.ok(candidates[0]!.unscoredReason);
  assert.equal(candidates[0]!.remaining, "bug");
});

test("matchStep: no match sets unscoredReason", () => {
  const candidates = [new Candidate("bug", "bug")];
  matchStep(candidates, new Map([["xyz", -0.1]]));
  assert.ok(candidates[0]!.unscoredReason);
  assert.ok(candidates[0]!.done);
});

test("matchStep: skips already-done candidates", () => {
  const done = new Candidate("a", "");
  const notDone = new Candidate("bc", "bc");
  matchStep([done, notDone], new Map([["bc", -0.1]]));
  assert.equal(notDone.remaining, "");
});

test("groupByContext: groups by consumed text, order-preserving, excludes done", () => {
  const a = new Candidate("apple", "apple");
  a.consumed = "ap";
  a.remaining = "ple";
  const b = new Candidate("apricot", "apricot");
  b.consumed = "ap";
  b.remaining = "ricot";
  const c = new Candidate("banana", "banana");
  c.consumed = "b";
  c.remaining = "anana";
  const d = new Candidate("done", "");

  const groups = groupByContext([a, b, c, d]);
  assert.deepEqual([...groups.keys()], ["ap", "b"]);
  assert.equal(groups.get("ap")!.length, 2);
  assert.equal(groups.get("b")!.length, 1);
});

test("Candidate.done: true when stoppedEarly is set, regardless of remaining", () => {
  const c = new Candidate("delay", "delay");
  c.remaining = "lay";
  c.stoppedEarly = true;
  assert.ok(c.done);
});

test("buildTree: single-level ids", () => {
  const tree = buildTree([{ id: "bug", description: "d" }, { id: "billing", description: "d" }]);
  assert.equal(tree.options.length, 2);
  assert.deepEqual([...tree.children.keys()], ["bug", "billing"]);
});

test("buildTree: hierarchy via underscores, shared prefixes merge", () => {
  const tree = buildTree([
    { id: "billing_refund", description: "refund" },
    { id: "billing_dispute", description: "dispute" },
    { id: "bug", description: "bug" },
  ]);
  const billing = tree.children.get("billing")!;
  assert.equal(billing.options.length, 2);
  assert.deepEqual([...billing.children.keys()], ["refund", "dispute"]);
});

test("TreeNode.childSummaries strips shared prefix", () => {
  const tree = buildTree([
    { id: "billing_refund", description: "wants money back" },
    { id: "billing_dispute", description: "disputes a charge" },
  ]);
  const summaries = tree.children.get("billing")!.childSummaries();
  assert.equal(summaries.get("refund"), "refund: wants money back");
  assert.equal(summaries.get("dispute"), "dispute: disputes a charge");
});

test("buildTree: numeric-looking segments preserve insertion order", () => {
  const tree = buildTree([{ id: "step_10", description: "d" }, { id: "step_2", description: "d" }]);
  assert.deepEqual([...tree.children.get("step")!.children.keys()], ["10", "2"]);
});

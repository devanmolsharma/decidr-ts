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
  assert.match(messages[1]!.content, /customer says the app crashed/);
  assert.match(messages[1]!.content, /Answer with exactly one of: bug, billing\./);
});

test("buildPrefixMessages: object state is JSON-serialized, prefix appended", () => {
  const messages = buildPrefixMessages(
    {
      state: { ticket: 42 },
      question: "route it",
      options: [
        { id: "a", description: "a" },
        { id: "b", description: "b" },
      ],
    },
    "bil",
  );
  assert.match(messages[1]!.content, /"ticket":42/);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[2], { role: "assistant", content: "bil" });
});

test("matchStep: longest non-overshooting prefix wins, mutates in place", () => {
  const candidates = [new Candidate("billing_refund", "billing_refund"), new Candidate("bug", "bug")];
  const found = new Map([
    ["bill", -0.1],
    ["billing", -0.2],
    ["billing_refund", -5.0], // overshoots "billing_refund"? no -- exact match is fine, longest wins
    ["b", -0.3],
  ]);
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
  const found = new Map([["bugs", -0.1]]); // longer than "bug", not a valid prefix match
  matchStep(candidates, found);
  assert.ok(candidates[0]!.unscoredReason);
  assert.equal(candidates[0]!.remaining, "bug"); // untouched, no match found
});

test("matchStep: no match sets unscoredReason", () => {
  const candidates = [new Candidate("bug", "bug")];
  const found = new Map([["xyz", -0.1]]);
  matchStep(candidates, found);
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

test("buildTree: single-level ids", () => {
  const tree = buildTree([
    { id: "bug", description: "d" },
    { id: "billing", description: "d" },
  ]);
  assert.equal(tree.options.length, 2);
  assert.deepEqual([...tree.children.keys()], ["bug", "billing"]);
  assert.equal(tree.children.get("bug")!.options.length, 1);
});

test("buildTree: hierarchy via underscores, shared prefixes merge", () => {
  const tree = buildTree([
    { id: "billing_refund", description: "refund" },
    { id: "billing_dispute", description: "dispute" },
    { id: "bug", description: "bug" },
  ]);
  assert.equal(tree.options.length, 3);
  const billing = tree.children.get("billing")!;
  assert.equal(billing.segment, "billing");
  assert.equal(billing.options.length, 2);
  assert.deepEqual([...billing.children.keys()], ["refund", "dispute"]);
  assert.equal(billing.children.get("refund")!.options.length, 1);
  assert.equal(billing.children.get("refund")!.options[0]!.id, "billing_refund");
});

test("TreeNode.childSummaries strips shared prefix", () => {
  const tree = buildTree([
    { id: "billing_refund", description: "wants money back" },
    { id: "billing_dispute", description: "disputes a charge" },
  ]);
  const billing = tree.children.get("billing")!;
  const summaries = billing.childSummaries();
  assert.equal(summaries.get("refund"), "refund: wants money back");
  assert.equal(summaries.get("dispute"), "dispute: disputes a charge");
});

test("buildTree: numeric-looking segments preserve insertion order", () => {
  // The classic JS pitfall this port works around: plain objects would
  // reorder "2" before "10" regardless of insertion order; Map won't.
  const tree = buildTree([
    { id: "step_10", description: "d" },
    { id: "step_2", description: "d" },
  ]);
  const step = tree.children.get("step")!;
  assert.deepEqual([...step.children.keys()], ["10", "2"]);
});

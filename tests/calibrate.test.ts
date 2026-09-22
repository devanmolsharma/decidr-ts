import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOutOfFold, expectedCalibrationError, fitTemperature } from "../src/calibrate.js";
import type { CalibrationPair } from "../src/calibrate.js";
import type { Decision } from "../src/types.js";

function fakeDecision(logprobsByOption: Record<string, number>, choice: string): Decision {
  const logprobs = new Map(Object.entries(logprobsByOption));
  return {
    id: "x",
    choice,
    probabilities: new Map(),
    logprobs,
    mode: "prefix",
    unscored: [],
    eliminated: [],
    rawAnswer: null,
  };
}

// Overconfident: winner always at logprob 0, loser far behind -- softmax(T=1)
// puts ~100% on the winner, but only ~70% of these are actually right.
function overconfidentPairs(n: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < n; i++) {
    const correct = i % 10 < 7 ? "a" : "b"; // 70% actually correct
    pairs.push({
      decision: fakeDecision({ a: 0, b: -8 }, "a"),
      correctId: correct,
    });
  }
  return pairs;
}

test("fitTemperature: throws with too few usable pairs", () => {
  assert.throws(() => fitTemperature(overconfidentPairs(5)));
});

test("fitTemperature: finds a temperature, reports ece improvement", () => {
  const pairs = overconfidentPairs(60);
  const result = fitTemperature(pairs);
  assert.equal(result.n, 60);
  assert.ok(result.temperature > 0);
  assert.ok(result.eceAfter <= result.eceBefore + 1e-9);
  assert.ok(Math.abs(result.accuracy - 0.7) < 1e-9);
});

test("expectedCalibrationError: perfectly calibrated predictions score near 0", () => {
  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < 20; i++) {
    pairs.push({ decision: fakeDecision({ a: 0, b: 0 }, "a"), correctId: i % 2 === 0 ? "a" : "b" });
  }
  const ece = expectedCalibrationError(pairs, 1.0);
  assert.ok(ece < 0.1);
});

test("evaluateOutOfFold: cross-validated result is deterministic for a fixed seed", () => {
  const pairs = overconfidentPairs(100);
  const r1 = evaluateOutOfFold(pairs, 5, 42);
  const r2 = evaluateOutOfFold(pairs, 5, 42);
  assert.deepEqual(r1, r2);
});

test("evaluateOutOfFold: throws with too few pairs for the fold count", () => {
  assert.throws(() => evaluateOutOfFold(overconfidentPairs(20), 5));
});

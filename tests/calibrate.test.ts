import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOutOfFold, expectedCalibrationError, fitTemperature } from "../src/calibrate.js";
import type { CalibrationPair } from "../src/calibrate.js";
import type { Decision } from "../src/types.js";

function fakeDecision(logprobsByOption: Record<string, number>, choice: string): Decision {
  return {
    id: "x", choice, probabilities: new Map(), logprobs: new Map(Object.entries(logprobsByOption)),
    mode: "prefix", unscored: [], eliminated: [], stoppedEarly: [], rawAnswer: null,
  };
}

function overconfidentPairs(n: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < n; i++) {
    const correct = i % 10 < 7 ? "a" : "b";
    pairs.push({ decision: fakeDecision({ a: 0, b: -8 }, "a"), correctId: correct });
  }
  return pairs;
}

test("fitTemperature: throws with too few usable pairs", () => {
  assert.throws(() => fitTemperature(overconfidentPairs(5)));
});

test("fitTemperature: finds a temperature, reports ece improvement", () => {
  const result = fitTemperature(overconfidentPairs(60));
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
  assert.ok(expectedCalibrationError(pairs, 1.0) < 0.1);
});

test("evaluateOutOfFold: cross-validated result is deterministic for a fixed seed", () => {
  const pairs = overconfidentPairs(100);
  assert.deepEqual(evaluateOutOfFold(pairs, 5, 42), evaluateOutOfFold(pairs, 5, 42));
});

test("evaluateOutOfFold: throws with too few pairs for the fold count", () => {
  assert.throws(() => evaluateOutOfFold(overconfidentPairs(20), 5));
});

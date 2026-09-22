/** Calibration: is `Decision.probabilities` actually trustworthy, or just
 * a score shaped like one? See docs/SPEC.md §7. */

import { softmax } from "./core.js";
import type { Decision } from "./types.js";

const DEFAULT_GRID: number[] = Array.from({ length: 100 }, (_, i) => Math.round(0.1 * (i + 1) * 100) / 100);

export interface CalibrationResult {
  temperature: number;
  n: number;
  eceBefore: number;
  eceAfter: number;
  accuracy: number;
}

export interface CalibrationPair {
  decision: Decision;
  correctId: string;
}

function usablePairs(pairs: CalibrationPair[]): CalibrationPair[] {
  return pairs.filter((p) => p.decision.logprobs.size >= 2);
}

function rescaledProb(pair: CalibrationPair, temperature: number): number {
  const ids = [...pair.decision.logprobs.keys()];
  const probs = softmax(ids.map((id) => pair.decision.logprobs.get(id)!), temperature);
  const idx = ids.indexOf(pair.correctId);
  return idx === -1 ? 0 : probs[idx]!;
}

function nll(pairs: CalibrationPair[], temperature: number): number {
  const losses = pairs.map((p) => -Math.log(Math.max(rescaledProb(p, temperature), 1e-9)));
  return losses.reduce((a, b) => a + b, 0) / losses.length;
}

export function expectedCalibrationError(pairs: CalibrationPair[], temperature: number, bins = 10): number {
  const scored = pairs.map((p) => {
    const ids = [...p.decision.logprobs.keys()];
    const probs = softmax(ids.map((id) => p.decision.logprobs.get(id)!), temperature);
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i]! > probs[bestIdx]!) bestIdx = i;
    }
    return { confidence: probs[bestIdx]!, correct: ids[bestIdx] === p.correctId };
  });

  const buckets: { confidence: number; correct: boolean }[][] = Array.from({ length: bins }, () => []);
  for (const s of scored) {
    let idx = Math.floor(s.confidence * bins);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    buckets[idx]!.push(s);
  }

  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const avgConfidence = bucket.reduce((a, b) => a + b.confidence, 0) / bucket.length;
    const avgAccuracy = bucket.reduce((a, b) => a + (b.correct ? 1 : 0), 0) / bucket.length;
    ece += (bucket.length / scored.length) * Math.abs(avgConfidence - avgAccuracy);
  }
  return ece;
}

function accuracyAt(pairs: CalibrationPair[]): number {
  let correct = 0;
  for (const p of pairs) if (p.decision.choice === p.correctId) correct++;
  return correct / pairs.length;
}

export function fitTemperature(pairs: CalibrationPair[], grid: number[] = DEFAULT_GRID): CalibrationResult {
  const usable = usablePairs(pairs);
  if (usable.length < 10) {
    throw new Error(`need at least 10 usable decisions (>= 2 scored options each), got ${usable.length}`);
  }

  let bestT = grid[0]!;
  let bestNll = Infinity;
  for (const t of grid) {
    const loss = nll(usable, t);
    if (loss < bestNll) {
      bestNll = loss;
      bestT = t;
    }
  }

  // Correctness invariant, not just documentation (SPEC.md §7): rescaling
  // by the chosen temperature must never change any pair's argmax choice.
  for (const p of usable) {
    const ids = [...p.decision.logprobs.keys()];
    const values = ids.map((id) => p.decision.logprobs.get(id)!);
    const before = softmax(values, 1.0);
    const after = softmax(values, bestT);
    const argmax = (probs: number[]) => probs.reduce((best, v, i) => (v > probs[best]! ? i : best), 0);
    if (argmax(before) !== argmax(after)) {
      throw new Error("temperature rescaling changed a decision's argmax -- this should be impossible");
    }
  }

  return {
    temperature: bestT,
    n: usable.length,
    eceBefore: expectedCalibrationError(usable, 1.0),
    eceAfter: expectedCalibrationError(usable, bestT),
    accuracy: accuracyAt(usable),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function evaluateOutOfFold(pairs: CalibrationPair[], folds = 5, seed = 0): CalibrationResult {
  const usable = usablePairs(pairs);
  if (usable.length < folds * 10) {
    throw new Error(`need at least ${folds * 10} usable decisions for ${folds}-fold CV, got ${usable.length}`);
  }

  const rng = mulberry32(seed);
  const shuffledPairs = shuffled(usable, rng);
  const foldSize = Math.floor(shuffledPairs.length / folds);

  const temperatures: number[] = [];
  const eceAfters: number[] = [];
  const accuracies: number[] = [];

  for (let f = 0; f < folds; f++) {
    const start = f * foldSize;
    const end = f === folds - 1 ? shuffledPairs.length : start + foldSize;
    const heldOut = shuffledPairs.slice(start, end);
    const trainSet = [...shuffledPairs.slice(0, start), ...shuffledPairs.slice(end)];

    const fit = fitTemperature(trainSet);
    temperatures.push(fit.temperature);
    eceAfters.push(expectedCalibrationError(heldOut, fit.temperature));
    accuracies.push(accuracyAt(heldOut));
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    temperature: mean(temperatures),
    n: usable.length,
    eceBefore: expectedCalibrationError(usable, 1.0),
    eceAfter: mean(eceAfters),
    accuracy: mean(accuracies),
  };
}

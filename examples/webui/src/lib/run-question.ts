import { Client } from "decidr-ts";
import type { Decision, ScoreResult, TruthResult, Backend } from "decidr-ts";
import type { PlaygroundState, QuestionSpec } from "./question-types";
import { recordingBackend, type RecordedCall } from "./record-backend";

export type QuestionResult = { latencyMs: number; calls: RecordedCall[] } & (
  | { type: "choice"; decision: Decision; allOptionIds: string[] }
  | { type: "score"; result: ScoreResult; allLevelIds: string[] }
  | { type: "noun"; result: TruthResult }
);

/** Runs one question against a shared state, timing the whole call.
 * Each question is its own independent request today -- decidr-ts has no
 * batching mechanism yet (see docs/BATCHING_DESIGN.md, design only), so
 * asking N questions about the same state costs N separate round trips,
 * same as calling decide()/score()/truth() N times by hand. `latencyMs`
 * lets the UI show that cost honestly per question, not just in
 * aggregate. */
export async function runQuestion(
  model: string,
  backend: Backend,
  state: PlaygroundState,
  question: QuestionSpec,
  exhaustive: boolean,
): Promise<QuestionResult> {
  const { backend: recorded, calls } = recordingBackend(backend);
  const client = new Client(model, { backend: recorded, exhaustive });
  const start = performance.now();

  if (question.type === "score") {
    // "lv0", "lv1", ... not "0" -- decidr-ts rejects ids under
    // MIN_ID_LENGTH (2 chars). Deliberately not "level_0"/"level_1"/...
    // either: a shared "level" segment would make every level's id an
    // underscore-hierarchy sibling, forcing an extra, pointless
    // sub-race round through decideTree instead of the flat one-level
    // race a handful of score levels actually needs.
    const levels = (question.criteria as string[]).map((description, i) => ({ id: `lv${i}`, description }));
    const result = await client.score({ id: question.id, state, question: question.instructions, levels });
    return { type: "score", result, allLevelIds: levels.map((l) => l.id), latencyMs: performance.now() - start, calls };
  }

  if (question.type === "noun") {
    const result = await client.truth({ id: question.id, state, question: question.instructions });
    return { type: "noun", result, latencyMs: performance.now() - start, calls };
  }

  const options = question.criteria as { id: string; description: string }[];
  const decision = await client.decide({ id: question.id, state, question: question.instructions, options });
  return { type: "choice", decision, allOptionIds: options.map((o) => o.id), latencyMs: performance.now() - start, calls };
}

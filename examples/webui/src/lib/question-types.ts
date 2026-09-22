import type { ContentBlock, RowOption } from "decidr-ts";

/** decidr-ts's three primitives, matching TypeSafe's Choice/Score/Noun
 * shape: a question is always "one primitive type, asked about the
 * shared State below." Choice -> Client.decide, Score -> Client.score,
 * Noun -> Client.truth (see src/lib/run-question.ts). */
export type PrimitiveType = "choice" | "score" | "noun";

/** One entry of the Questions JSON array -- field names (`instructions`,
 * `criteria`) deliberately match TypeSafe's own vocabulary from its docs.
 * `criteria` is an id/description option list for "choice", an ordered
 * low-to-high description list for "score", and omitted for "noun". */
export interface QuestionSpec {
  id: string;
  type: PrimitiveType;
  instructions: string;
  criteria?: RowOption[] | string[];
}

export type PlaygroundState = string | ContentBlock[];

export class QuestionsParseError extends Error {}

export function parseQuestions(text: string): QuestionSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new QuestionsParseError(`Questions is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) throw new QuestionsParseError("Questions must be a JSON array.");
  parsed.forEach((q, i) => {
    if (!q || typeof q !== "object") throw new QuestionsParseError(`Question ${i} must be an object.`);
    if (typeof q.id !== "string" || !q.id) throw new QuestionsParseError(`Question ${i} needs a non-empty string "id".`);
    if (!["choice", "score", "noun"].includes(q.type)) {
      throw new QuestionsParseError(`Question "${q.id}" has invalid "type" -- must be "choice", "score", or "noun".`);
    }
    if (typeof q.instructions !== "string" || !q.instructions) {
      throw new QuestionsParseError(`Question "${q.id}" needs a non-empty string "instructions".`);
    }
    if (q.type !== "noun" && !Array.isArray(q.criteria)) {
      throw new QuestionsParseError(`Question "${q.id}" (type "${q.type}") needs a "criteria" array.`);
    }
  });
  return parsed as QuestionSpec[];
}

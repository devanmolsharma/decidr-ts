/**
 * Tic-tac-toe move selection: a flat, single-race decision where every
 * option is a board cell. Included deliberately as an honest example --
 * decidr faithfully reports what the model actually believes, including
 * being confidently wrong when the underlying model's spatial reasoning
 * is weak. Run with:
 *
 *   OPENAI_API_KEY=sk-... npx tsx examples/tictactoe-strategist/run.mts
 *
 * Try --model gpt-4o-mini to see a real model get it wrong with high
 * confidence, vs the gpt-4o default which gets it right.
 */
import { Client, OpenAIBackend } from "../../src/index.js";

const modelArg = process.argv.indexOf("--model");
const model = modelArg !== -1 ? process.argv[modelArg + 1]! : "gpt-4o";

const client = new Client(model, {
  backend: new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY }),
  exhaustive: true,
});

// X is at (0,0) and (1,1). O is at (0,1) and (2,1). The only winning move
// for X is (2,2), completing the (0,0)-(1,1)-(2,2) diagonal.
const row = {
  id: "ttt-1",
  state:
    "Tic-tac-toe. Rows and columns are numbered 0-2 (row, col), top-left is (0,0), bottom-right is (2,2).\n" +
    "X is at (0,0) and (1,1). O is at (0,1) and (2,1). All other cells are empty.\n" +
    "X to move. Three X's in a row (any row, column, or diagonal) wins immediately.",
  question: "Which empty cell should X play to win immediately, if a winning move exists?",
  options: [
    { id: "cell_0_2", description: "row 0, col 2 (top-right)" },
    { id: "cell_1_0", description: "row 1, col 0 (middle-left)" },
    { id: "cell_1_2", description: "row 1, col 2 (middle-right)" },
    { id: "cell_2_0", description: "row 2, col 0 (bottom-left)" },
    { id: "cell_2_2", description: "row 2, col 2 (bottom-right)" },
  ],
};

const CORRECT = "cell_2_2";

const start = performance.now();
const decision = await client.decide(row);
const latencyMs = performance.now() - start;

console.log(`model: ${model}`);
console.log(`latency: ${latencyMs.toFixed(0)}ms\n`);
console.log("board:\n  X O .\n  . X .\n  . O .\n");
console.log(`choice: ${decision.choice}  ${decision.choice === CORRECT ? "(correct!)" : "(wrong -- the winning move is cell_2_2)"}`);
for (const [id, p] of [...decision.probabilities].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(10)} ${(p * 100).toFixed(2)}%`);
}

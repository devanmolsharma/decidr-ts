/**
 * Multi-agent task routing: the exact pattern TypeSafe cites for Jev --
 * "which agent in a multi-agent system should handle this task." Given a
 * user request, pick which specialized agent/tool handles it, with a real
 * probability for every plausible agent, not just the top pick. Run with:
 *
 *   npx tsx examples/multi-agent-router/run.mts
 */
import { Client, OpenAIBackend } from "../../src/index.js";

const useOpenAI = process.argv.includes("--openai");
const model = useOpenAI ? "gpt-4o-mini" : "qwen3.5:4b";
const backend = useOpenAI ? new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY }) : undefined;

const client = new Client(model, { backend });

// Short, front-diverging ids so more of them plausibly land in the model's
// top_logprobs rank window at once -- a fairer, more visually interesting
// race than five long ids that only share a trailing "_agent" suffix.
const AGENTS = [
  { id: "flight", description: "Searches and compares real flight prices and schedules." },
  { id: "weather", description: "Looks up current and forecast weather for a location and date." },
  { id: "coder", description: "Writes, edits, or debugs source code." },
  { id: "writer", description: "Drafts or edits prose, emails, or documents." },
  { id: "calendar", description: "Reads or schedules events on a user's calendar." },
];

const requests = [
  {
    id: "req-1",
    state:
      "User: \"Can you find me the cheapest flight from Zurich to London next Tuesday, and also tell me " +
      "what the weather will be like when I land?\"",
    question: "Which specialized agent should handle this request first?",
    options: AGENTS,
  },
  {
    id: "req-2",
    state:
      "User: \"This function is throwing a TypeError when I pass it an empty array, can you fix it and " +
      "explain why it was breaking?\"",
    question: "Which specialized agent should handle this request first?",
    options: AGENTS,
  },
];

for (const row of requests) {
  const start = performance.now();
  const decision = await client.decide(row);
  const latencyMs = performance.now() - start;

  console.log(`\n=== ${row.id} ===`);
  console.log(row.state);
  console.log(`\n-> ${decision.choice}  (${(decision.probabilities.get(decision.choice)! * 100).toFixed(1)}%, ${latencyMs.toFixed(0)}ms)`);
  for (const [id, p] of [...decision.probabilities].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${id.padEnd(20)} ${(p * 100).toFixed(2)}%`);
  }
}

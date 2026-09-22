/**
 * Support ticket routing: a real 2-level id hierarchy (billing/support/bug,
 * each with sub-categories), exhaustively explored so every branch gets a
 * real, comparable probability -- not just the winner. Run with:
 *
 *   npx tsx examples/ticket-routing/run.mts
 *
 * Uses a local Ollama by default (needs a pulled model; Client() talks to
 * Ollama's OpenAI-compatible endpoint by default, no separate backend
 * needed); pass --openai to use OpenAI directly instead (needs
 * OPENAI_API_KEY).
 */
import { Client, OpenAIBackend } from "../../src/index.js";

const useOpenAI = process.argv.includes("--openai");
const model = useOpenAI ? "gpt-4o-mini" : "qwen3.5:4b";
const backend = useOpenAI ? new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY }) : undefined;

const client = new Client(model, { backend, exhaustive: true });

const row = {
  id: "ticket-99",
  state:
    "Customer: I was charged $49.99 twice this month for my subscription. " +
    "I already emailed support three days ago and nobody replied. I want the duplicate charge refunded immediately.",
  question: "Which team and sub-category should handle this support ticket?",
  options: [
    { id: "billing_refund", description: "Customer wants money back for an incorrect or duplicate charge." },
    { id: "billing_dispute", description: "Customer disputes a charge as unauthorized or fraudulent." },
    { id: "billing_subscription", description: "Questions about subscription plans, upgrades, or cancellation." },
    { id: "support_escalation", description: "Customer reports being ignored by a previous support contact." },
    { id: "support_general", description: "General product usage question." },
    { id: "bug_crash", description: "App or website crashed." },
    { id: "bug_slow", description: "App or website is slow." },
  ],
};

const start = performance.now();
const decision = await client.decide(row);
const latencyMs = performance.now() - start;

console.log(`model: ${model}`);
console.log(`latency: ${latencyMs.toFixed(0)}ms\n`);
console.log(`choice: ${decision.choice}`);
console.log(`confidence: ${(decision.probabilities.get(decision.choice)! * 100).toFixed(2)}%\n`);
console.log("probabilities:");
for (const [id, p] of [...decision.probabilities].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(24)} ${(p * 100).toFixed(4)}%`);
}
if (decision.unscored.length) console.log(`\nunscored: ${decision.unscored.join(", ")}`);
if (decision.eliminated.length) console.log(`eliminated: ${decision.eliminated.join(", ")}`);

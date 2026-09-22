/**
 * Vision classification: a real image as `state`, sent as a multimodal
 * content block to a vision-capable model. No text ever describes what's
 * in the photo -- the model has to actually look. Run with:
 *
 *   OPENAI_API_KEY=sk-... npx tsx examples/vision-classify/run.mts
 *
 * Needs a vision-capable model; OpenAIBackend + gpt-4o-mini by default.
 * Ollama also works with a vision-capable local model (e.g. llava, or a
 * multimodal qwen build) via --ollama <model>.
 */
import { Client, OllamaBackend, OpenAIBackend } from "../../src/index.js";

const ollamaModelArg = process.argv.indexOf("--ollama");
const useOllama = ollamaModelArg !== -1;
const model = useOllama ? process.argv[ollamaModelArg + 1]! : "gpt-4o-mini";
const backend = useOllama ? new OllamaBackend() : new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY });

const client = new Client(model, { backend });

const row = {
  id: "vision-1",
  state: [
    { type: "text" as const, text: "Look at this photo:" },
    { type: "image" as const, url: "https://images.unsplash.com/photo-1547721064-da6cfb341d50?w=640" },
  ],
  question: "What animal is in this photo?",
  options: [
    { id: "red_panda", description: "a red panda" },
    { id: "raccoon", description: "a raccoon" },
    { id: "fox", description: "a fox" },
    { id: "cat", description: "a domestic cat" },
  ],
};

const start = performance.now();
const decision = await client.decide(row);
const latencyMs = performance.now() - start;

console.log(`model: ${model}`);
console.log(`latency: ${latencyMs.toFixed(0)}ms\n`);
console.log(`choice: ${decision.choice}`);
console.log("probabilities:");
for (const [id, p] of [...decision.probabilities].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(14)} ${(p * 100).toFixed(6)}%`);
}

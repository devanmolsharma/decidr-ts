// The "normal" way to get a classification-with-confidence out of a chat
// model: the prompt shape people actually write today when they want
// per-option scores, not just a single label -- reasoning text, then a
// JSON object scoring every option. This is the real comparison decidr's
// single-token logprob read replaces: it's genuinely slow (long
// generation, one full sentence of reasoning plus a JSON blob) and the
// resulting "confidence" is the model's own self-report, not a real
// probability read off its logits. Kept here as an honest, real baseline
// for the speed-race example -- same OpenAI endpoint, same model, same
// options, real generated text and real JSON parsing (with real risk of
// the JSON not parsing at all, same as it would in production code).

export async function runNaiveBaseline(apiKey, model, row, onToken) {
  const optionsLine = row.options.map((o) => `"${o.id}"`).join(", ");
  const scoresShape = row.options.map((o) => `"${o.id}": <number 0-1>`).join(", ");
  const prompt =
    `${row.state}\n\n${row.question}\nOptions: ${optionsLine}\n\n` +
    "First, reason about it in 2-3 sentences. Then output a JSON object on its own line, scoring " +
    "every option's confidence from 0 to 1 (they don't need to sum to 1), and naming the best one, " +
    `in exactly this shape:\n{"reasoning": "...", "scores": {${scoresShape}}, "answer": "<option id>"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`baseline call failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken?.(full);
        }
      } catch {
        // ignore partial/malformed SSE chunks
      }
    }
  }

  // The model may wrap the JSON in a code fence or add stray text around
  // it -- take the last {...} block in the response, same forgiving
  // approach real "parse the model's JSON" code has to use in practice.
  const jsonMatch = full.match(/\{[\s\S]*\}/);
  let parsedId = null;
  let scores = null;
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      parsedId = typeof obj.answer === "string" ? obj.answer : null;
      scores = obj.scores && typeof obj.scores === "object" ? obj.scores : null;
    } catch {
      // real production code would hit this on a malformed response too
    }
  }
  const validId = row.options.some((o) => o.id === parsedId) ? parsedId : null;

  return { fullText: full, parsedId: validId, scores };
}

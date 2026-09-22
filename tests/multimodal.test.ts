import assert from "node:assert/strict";
import { test } from "node:test";
import { DecisionError } from "../src/backend.js";
import { Client, validateRow } from "../src/core.js";
import { buildPrefixMessages } from "../src/prefix.js";
import { FakeBackend, singleTokenReply } from "./fake-backend.js";
import type { ContentBlock, Row } from "../src/types.js";

function imageRow(state: ContentBlock[]): Row {
  return {
    id: "r1",
    state,
    question: "what is it?",
    options: [
      { id: "cat", description: "a cat" },
      { id: "dog", description: "a dog" },
    ],
  };
}

test("validateRow: accepts content-block state with url image", () => {
  assert.doesNotThrow(() =>
    validateRow(
      imageRow([
        { type: "text", text: "look at this:" },
        { type: "image", url: "https://example.com/cat.png" },
      ]),
    ),
  );
});

test("validateRow: accepts content-block state with inline data image", () => {
  assert.doesNotThrow(() =>
    validateRow(imageRow([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }])),
  );
});

test("validateRow: rejects an image block with neither url nor data", () => {
  assert.throws(() => validateRow(imageRow([{ type: "image" }])), DecisionError);
});

test("validateRow: rejects an image block with both url and data", () => {
  assert.throws(
    () => validateRow(imageRow([{ type: "image", url: "https://x/y.png", data: "aGk=" }])),
    DecisionError,
  );
});

test("validateRow: rejects an unknown block type", () => {
  assert.throws(
    () => validateRow(imageRow([{ type: "bogus" } as unknown as ContentBlock])),
    DecisionError,
  );
});

test("buildPrefixMessages: content-block state stays an array with instructions appended as text", () => {
  const messages = buildPrefixMessages(
    imageRow([{ type: "image", url: "https://example.com/cat.png" }]),
  );
  const user = messages[1]!;
  assert.ok(Array.isArray(user.content));
  const blocks = user.content as ContentBlock[];
  assert.equal(blocks[0]!.type, "image");
  assert.equal(blocks[1]!.type, "text");
  assert.match((blocks[1] as { text: string }).text, /Answer with exactly one of: cat, dog\./);
});

test("Client.decide: works end-to-end with a multimodal row via a fake backend", async () => {
  let sawImageBlock = false;
  const backend = new FakeBackend((messages) => {
    const user = messages.find((m) => m.role === "user")!;
    if (Array.isArray(user.content) && user.content.some((b) => b.type === "image")) {
      sawImageBlock = true;
    }
    return singleTokenReply("cat", -0.1, [["dog", -2.0]]);
  });
  const client = new Client("test-model", { backend, cache: false });
  const decision = await client.decide(
    imageRow([{ type: "image", url: "https://example.com/cat.png" }]),
  );
  assert.equal(decision.choice, "cat");
  assert.ok(sawImageBlock, "backend should have received the image content block");
});

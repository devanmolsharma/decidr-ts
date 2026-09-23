import type { ContentBlock } from "decidr-ts";

/** A placeholder that stands in for a real base64 payload inside the
 * State JSON editor -- editing/displaying a multi-hundred-KB base64
 * string inline would make the editor unusable (thousands of wrapped
 * lines). The editor only ever shows/edits this placeholder; the real
 * data is tracked separately and spliced back in before a run and
 * before deriving the image preview. */
const PLACEHOLDER = "<image data, edited via the card below>";

export interface ImageBlockData {
  data: string;
  mimeType: string;
}

function isImageBlock(b: unknown): b is Extract<ContentBlock, { type: "image" }> {
  return !!b && typeof b === "object" && (b as ContentBlock).type === "image";
}

/** Given a real State array (with actual base64 data, if any), returns
 * the text to show/edit in the JSON editor, with any image block's
 * `data` swapped for the placeholder. Returns `text` unchanged if State
 * isn't a multimodal array. */
export function toDisplayText(state: unknown, prettyFallback: string): string {
  if (!Array.isArray(state)) return prettyFallback;
  const display = state.map((b) => (isImageBlock(b) && b.data ? { ...b, data: PLACEHOLDER } : b));
  return JSON.stringify(display, null, 2);
}

/** Extracts the real image data (if any) out of a full State value (not
 * the display text -- call this on the value tracked alongside the
 * display text, before it's been placeholder-redacted). */
export function extractImageData(state: unknown): ImageBlockData | null {
  if (!Array.isArray(state)) return null;
  const block = state.find(isImageBlock);
  if (!block || !block.data) return null;
  return { data: block.data, mimeType: block.mimeType ?? "image/png" };
}

/** Rebuilds the real State array by merging edited display text (which
 * may have reordered/added/removed non-image blocks, and still contains
 * the placeholder in place of the image's data) back with the real,
 * tracked image data. If the display text no longer contains an image
 * block at all (removed by editing), the image is dropped. Throws if
 * `displayText` isn't valid JSON -- callers should catch this the same
 * way they already handle invalid State JSON. */
export function mergeDisplayTextWithImage(displayText: string, image: ImageBlockData | null): unknown {
  const parsed = JSON.parse(displayText);
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((b) => {
    if (isImageBlock(b) && b.data === PLACEHOLDER) {
      return image ? { ...b, data: image.data, mimeType: image.mimeType } : null;
    }
    return b;
  }).filter((b) => b !== null);
}

export function imageDataUri(image: ImageBlockData): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

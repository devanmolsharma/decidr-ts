import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { useMemo } from "react";

/** A dark CodeMirror theme + syntax highlight style built from our own
 * tokens, rather than a stock CodeMirror theme package -- both pieces
 * are required: EditorView.theme alone only styles the editor's chrome
 * (gutter, cursor, selection), not the JSON token colors themselves,
 * which otherwise fall back to CodeMirror's default light-mode palette
 * and read as broken on a dark page. Matches TypeSafe's own playground,
 * which edits both State and Questions as raw JSON in a code editor
 * rather than a form UI (verified against a saved DOM capture of the
 * real console). */
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--secondary)", color: "var(--foreground)", fontSize: "13px", borderRadius: "var(--radius-md)" },
    ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--signal)", padding: "10px 0" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { color: "var(--muted-foreground)" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--signal) 30%, transparent) !important",
    },
    ".cm-cursor": { borderLeftColor: "var(--signal)" },
    ".cm-scroller": { fontFamily: "var(--font-mono)" },
    ".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: "color-mix(in srgb, var(--cyan) 20%, transparent)" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--cyan)" },
  { tag: t.string, color: "var(--signal)" },
  { tag: t.number, color: "var(--signal)" },
  { tag: t.bool, color: "var(--signal)" },
  { tag: t.null, color: "var(--muted-foreground)" },
  { tag: [t.bracket, t.punctuation], color: "var(--muted-foreground)" },
]);

export function JsonEditor({
  value,
  onChange,
  height,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fixed height so this editor fills its column instead of growing
   * with content -- the column's own scroll (not the editor's) is what
   * should move when JSON is longer than the available space. */
  height?: string;
}) {
  const extensions = useMemo(() => [json(), editorTheme, syntaxHighlighting(highlightStyle)], []);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
      height={height}
      style={{ borderRadius: "var(--radius-md)", overflow: "hidden" }}
    />
  );
}

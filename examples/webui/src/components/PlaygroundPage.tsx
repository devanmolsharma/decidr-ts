import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { JsonEditor } from "@/components/JsonEditor";
import { PanelToolbar } from "@/components/PanelToolbar";
import { QuestionResultView } from "@/components/QuestionResultView";
import { QuestionCard } from "@/components/QuestionCard";
import { StateImageCard } from "@/components/StateImageCard";
import { ErrorBox } from "@/components/ErrorBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EXAMPLE_PRESETS, type ExamplePreset } from "@/lib/examples";
import { parseQuestions, QuestionsParseError, type PlaygroundState, type QuestionSpec } from "@/lib/question-types";
import { runQuestion, type QuestionResult } from "@/lib/run-question";
import { extractImageData, imageDataUri, mergeDisplayTextWithImage, toDisplayText, type ImageBlockData } from "@/lib/state-image";
import { useApiKey, currentProvider, resolveBaseURL } from "@/hooks/useApiKey";
import { useSharedBackend } from "@/hooks/useSharedBackend";

const DOCS_BASE = "https://github.com/devanmolsharma/decidr-ts/blob/main/docs";

/** decidr-ts's playground: a thin TopBar (provider/model/key, example
 * picker) above three equal-width columns that sit side by side, each
 * scrolling independently: State, then Questions + Run, then Results.
 *
 * Questions can be edited as raw JSON or through a Builder UI (one card
 * per question, matching TypeSafe's own console shape) -- both views
 * edit the exact same underlying text, so switching between them never
 * loses anything the other view doesn't understand.
 *
 * Each question still runs as its own separate request under the hood --
 * decidr-ts has no real multi-question batching yet (see
 * docs/BATCHING_DESIGN.md), so this doesn't claim TypeSafe's
 * request-count optimization, only its Choice/Score/Noun primitive
 * shape. */
export default function PlaygroundPage() {
  const { apiKey, setKeyStatus, providerId, model, customBaseURL } = useApiKey();
  const getBackend = useSharedBackend();
  const provider = currentProvider(providerId);

  const initial = EXAMPLE_PRESETS[0];
  const initialImage = useMemo(() => extractImageData(JSON.parse(initial.stateText)), [initial]);
  const [activePresetId, setActivePresetId] = useState(initial.id);
  // `image` holds the real base64 payload, tracked separately from the
  // editor's own text so the editor never has to render (or re-parse on
  // every keystroke) a multi-hundred-KB base64 string -- see
  // src/lib/state-image.ts. `displayText` is what the JSON editor
  // actually shows/edits, with the image's data field replaced by a
  // short placeholder; the two are merged back together before a run.
  const [image, setImage] = useState<ImageBlockData | null>(initialImage);
  const [displayText, setDisplayText] = useState(() => toDisplayText(JSON.parse(initial.stateText), initial.stateText));
  const [questionsText, setQuestionsText] = useState(initial.questionsText);
  const [questionsMode, setQuestionsMode] = useState<"builder" | "json">("builder");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ question: QuestionSpec; result: QuestionResult }[]>([]);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [exhaustive, setExhaustive] = useState(false);

  // Builder mode edits `questions` (parsed from questionsText); JSON mode
  // edits questionsText directly. A parse failure in Builder mode is
  // shown inline rather than crashing the view -- switching to JSON mode
  // always shows the raw text so it's never unrecoverable.
  let builderQuestions: QuestionSpec[] | null = null;
  let builderParseError: string | null = null;
  try {
    builderQuestions = parseQuestions(questionsText);
  } catch (e) {
    builderParseError = e instanceof Error ? e.message : String(e);
  }

  function setBuilderQuestions(next: QuestionSpec[]) {
    setQuestionsText(JSON.stringify(next, null, 2));
  }

  function updateQuestion(index: number, next: QuestionSpec) {
    if (!builderQuestions) return;
    const copy = builderQuestions.slice();
    copy[index] = next;
    setBuilderQuestions(copy);
  }

  function removeQuestion(index: number) {
    if (!builderQuestions) return;
    setBuilderQuestions(builderQuestions.filter((_, i) => i !== index));
  }

  function addQuestion() {
    const next: QuestionSpec = {
      id: `q${(builderQuestions?.length ?? 0) + 1}`,
      type: "choice",
      instructions: "",
      criteria: [
        { id: "option_a", description: "" },
        { id: "option_b", description: "" },
      ],
    };
    setBuilderQuestions([...(builderQuestions ?? []), next]);
  }

  function loadPreset(preset: ExamplePreset) {
    setActivePresetId(preset.id);
    const parsedState = JSON.parse(preset.stateText);
    setImage(extractImageData(parsedState));
    setDisplayText(toDisplayText(parsedState, preset.stateText));
    setQuestionsText(preset.questionsText);
    setResults([]);
    setTotalMs(null);
    setError(null);
  }

  async function run() {
    if (provider.needsKey && !apiKey) {
      setError(`Enter your ${provider.label} API key in the top bar first.`);
      return;
    }
    if (!model) {
      setError("Enter a model id in the top bar first.");
      return;
    }

    let state: PlaygroundState;
    let questions: QuestionSpec[];
    try {
      state = mergeDisplayTextWithImage(displayText || '""', image) as PlaygroundState;
      questions = parseQuestions(questionsText);
    } catch (e) {
      setError(e instanceof QuestionsParseError ? e.message : `State is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (questions.length === 0) {
      setError("Add at least one question first.");
      return;
    }

    setRunning(true);
    setError(null);
    setResults([]);
    setTotalMs(null);
    const runStart = performance.now();
    try {
      const baseURL = resolveBaseURL(providerId, customBaseURL);
      const backend = getBackend(apiKey, baseURL);
      const out: { question: QuestionSpec; result: QuestionResult }[] = [];
      for (const question of questions) {
        const result = await runQuestion(model, backend, state, question, exhaustive);
        out.push({ question, result });
        setResults([...out]);
      }
      setKeyStatus("ok");
    } catch (e) {
      setKeyStatus("bad");
      const message = e instanceof Error ? e.message : String(e);
      // A generic "Failed to fetch"/"Connection error" against Ollama
      // usually means either it isn't running, or (when this page isn't
      // itself served from localhost/127.0.0.1 -- e.g. the hosted
      // playground) Ollama's default CORS policy is blocking the
      // request, since it only allows localhost/127.0.0.1 origins out of
      // the box. The openai SDK reports a blocked fetch as its own
      // generic "Connection error." (see openai/core/error.ts), not the
      // browser's real CORS message -- so match that string too, not
      // just the raw fetch-failure wording.
      const looksLikeNetworkFailure = /failed to fetch|networkerror|load failed|connection error/i.test(message);
      const isLocalOrigin = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
      setError(
        providerId === "ollama" && looksLikeNetworkFailure
          ? isLocalOrigin
            ? `${message} -- make sure Ollama is running (\`ollama serve\`) and the model is pulled.`
            : `${message} -- this page isn't served from localhost, so Ollama's default CORS policy blocks it. Restart Ollama with OLLAMA_ORIGINS set to allow this page's origin, e.g. OLLAMA_ORIGINS=${window.location.origin} ollama serve`
          : message,
      );
    } finally {
      setTotalMs(performance.now() - runStart);
      setRunning(false);
    }
  }

  return (
    <div className="h-screen flex flex-col">
      <TopBar activePresetId={activePresetId} onLoadPreset={loadPreset} />

      <div className="flex-1 min-h-0 flex">
        <section className="flex-1 min-w-0 flex flex-col border-r border-border">
          <PanelToolbar label="State" />
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <p className="text-[11.5px] text-muted-foreground mb-2">
              The evidence every question below is asked about. Plain text, JSON, or an array with an image (see{" "}
              <a href={`${DOCS_BASE}/SPEC.md`} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                docs
              </a>
              ).
            </p>
            <JsonEditor value={displayText} onChange={setDisplayText} />
            {image && (
              <StateImageCard
                src={imageDataUri(image)}
                onReplace={(data, mimeType) => setImage({ data, mimeType })}
                onRemove={() => {
                  // Strip the image block from the display text too --
                  // otherwise it would still show the placeholder for an
                  // image that no longer exists.
                  try {
                    const withoutImage = mergeDisplayTextWithImage(displayText, null);
                    setDisplayText(JSON.stringify(withoutImage, null, 2));
                  } catch {
                    // display text wasn't valid JSON -- leave it for the
                    // user to fix, removing the image state is still safe
                  }
                  setImage(null);
                }}
              />
            )}
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col border-r border-border">
          <PanelToolbar label="Questions">
            <div className="flex items-center gap-1 rounded-md bg-secondary p-0.5">
              <button
                onClick={() => setQuestionsMode("builder")}
                className={`px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                  questionsMode === "builder" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Builder
              </button>
              <button
                onClick={() => setQuestionsMode("json")}
                className={`px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                  questionsMode === "json" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                JSON
              </button>
            </div>
          </PanelToolbar>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            {questionsMode === "json" ? (
              <JsonEditor value={questionsText} onChange={setQuestionsText} height="100%" />
            ) : builderParseError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-[12.5px] text-destructive">
                Can't show the builder -- Questions JSON is invalid: {builderParseError}. Switch to JSON mode to fix it.
              </div>
            ) : (
              <>
                {(builderQuestions ?? []).map((question, i) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    onChange={(next) => updateQuestion(i, next)}
                    onRemove={() => removeQuestion(i)}
                  />
                ))}
                <Button variant="outline" onClick={addQuestion} className="w-fit">
                  + add question
                </Button>
              </>
            )}

            <div className="rounded-xl border border-border bg-card p-4 shrink-0">
              <div className="flex items-start justify-between mb-1 gap-3">
                <label htmlFor="exhaustive-toggle" className="flex items-center gap-2 text-[12.5px] text-foreground cursor-pointer">
                  <Switch id="exhaustive-toggle" checked={exhaustive} onCheckedChange={setExhaustive} />
                  Exhaustive mode
                </label>
                <span className="text-[11px] text-muted-foreground">{exhaustive ? "full coverage" : "cheaper, partial"}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                {exhaustive
                  ? "Every branch of a hierarchical Choice is raced, so every option gets a real, comparable probability -- more requests."
                  : "Only the winning path is explored; a losing branch with sub-options goes to “eliminated” instead of a real number — fewer requests."}{" "}
                <a
                  href={`${DOCS_BASE}/HIERARCHY.md#exhaustive-vs-cheap-new-clientmodel--exhaustive-`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan hover:underline"
                >
                  Full explanation
                </a>
                .
              </p>
              <Button onClick={run} disabled={running} className="w-full">
                {running ? "running…" : "Run request"}
              </Button>
              {error && <ErrorBox message={error} />}
            </div>
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col">
          <PanelToolbar label="Results">
            {totalMs !== null && (
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">total {totalMs.toFixed(0)}ms</span>
            )}
          </PanelToolbar>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            {results.length === 0 && !running ? (
              <div className="flex-1 flex items-center justify-center text-center px-6">
                <p className="text-[13px] text-muted-foreground max-w-70">
                  Pick an example from the top bar, or write your own State and Questions, then hit{" "}
                  <span className="text-foreground">Run request</span>.
                </p>
              </div>
            ) : (
              results.map(({ question, result }) => <QuestionResultView key={question.id} question={question} result={result} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

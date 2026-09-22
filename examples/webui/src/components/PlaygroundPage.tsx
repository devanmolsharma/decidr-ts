import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { JsonEditor } from "@/components/JsonEditor";
import { PanelToolbar } from "@/components/PanelToolbar";
import { QuestionResultView } from "@/components/QuestionResultView";
import { ErrorBox } from "@/components/ErrorBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EXAMPLE_PRESETS, type ExamplePreset } from "@/lib/examples";
import { parseQuestions, QuestionsParseError, type PlaygroundState, type QuestionSpec } from "@/lib/question-types";
import { runQuestion, type QuestionResult } from "@/lib/run-question";
import { useApiKey, currentProvider, resolveBaseURL } from "@/hooks/useApiKey";
import { useSharedBackend } from "@/hooks/useSharedBackend";

/** decidr-ts's playground: a thin TopBar (provider/model/key, example
 * picker -- everything that used to be a permanent side column) above
 * three equal-width columns that sit side by side, each scrolling
 * independently within the remaining viewport height: State, then
 * Questions + Run, then Results. Three columns rather than either a
 * cramped multi-panel IDE split or one long vertically-scrolling page --
 * each section gets real width and its own scroll, none of them
 * fighting the others for vertical space.
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
  const [activePresetId, setActivePresetId] = useState(initial.id);
  const [stateText, setStateText] = useState(initial.stateText);
  const [questionsText, setQuestionsText] = useState(initial.questionsText);
  const [imagePreview, setImagePreview] = useState<string | undefined>(initial.imagePreview);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ question: QuestionSpec; result: QuestionResult }[]>([]);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [exhaustive, setExhaustive] = useState(false);

  function loadPreset(preset: ExamplePreset) {
    setActivePresetId(preset.id);
    setStateText(preset.stateText);
    setQuestionsText(preset.questionsText);
    setImagePreview(preset.imagePreview);
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
      state = JSON.parse(stateText || '""');
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
      setError(e instanceof Error ? e.message : String(e));
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
            <JsonEditor value={stateText} onChange={setStateText} height="100%" />
            {imagePreview && (
              <div className="mt-3">
                <img src={imagePreview} className="max-w-full rounded-lg block border border-border" alt="preview" />
              </div>
            )}
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col border-r border-border">
          <PanelToolbar label="Questions" />
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            <JsonEditor value={questionsText} onChange={setQuestionsText} height="100%" />

            <div className="rounded-xl border border-border bg-card p-4 shrink-0">
              <div className="flex items-center justify-between mb-3 gap-3">
                <label htmlFor="exhaustive-toggle" className="flex items-center gap-2 text-[12.5px] text-foreground cursor-pointer">
                  <Switch id="exhaustive-toggle" checked={exhaustive} onCheckedChange={setExhaustive} />
                  Exhaustive mode
                </label>
                <span
                  className="text-[11px] text-muted-foreground truncate"
                  title="On: every branch of a hierarchical Choice is raced for a complete distribution. Off: only the winning path is explored -- losing multi-option branches go to eliminated instead of getting a real number."
                >
                  {exhaustive ? "full coverage" : "cheaper, partial"}
                </span>
              </div>
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

import { useState } from "react";
import type { Decision } from "decidr-ts";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DistributionChart } from "@/components/DistributionChart";
import { fmtPct } from "@/lib/format";
import type { QuestionSpec } from "@/lib/question-types";
import type { QuestionResult } from "@/lib/run-question";
import type { RecordedCall } from "@/lib/record-backend";
import { cn } from "@/lib/utils";

/** ≤15 words, one line -- the label above each real artifact. No
 * paragraphs; the artifact itself is the explanation. */
function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-5 h-5 rounded-full bg-signal/15 border border-signal/40 text-signal font-mono font-bold text-[10.5px] flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-[12.5px] font-semibold text-foreground">{text}</span>
    </div>
  );
}

/** The real request body sent to the provider, for one round. Real
 * `ChatMessage[]`, not a summary of it. */
function RawRequest({ call }: { call: RecordedCall }) {
  const userMsg = call.messages.find((m) => m.role === "user");
  const assistantPrefix = call.messages.find((m) => m.role === "assistant");
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 font-mono text-[11.5px] space-y-1.5">
      <div>
        <span className="text-muted-foreground">role: user &rarr;</span>{" "}
        <span className="text-foreground">
          {typeof userMsg?.content === "string" ? userMsg.content.slice(0, 140) : "[multimodal content]"}
          {typeof userMsg?.content === "string" && userMsg.content.length > 140 ? "…" : ""}
        </span>
      </div>
      {assistantPrefix && (
        <div>
          <span className="text-muted-foreground">role: assistant (prefix) &rarr;</span>{" "}
          <span className="text-signal">"{String(assistantPrefix.content)}"</span>
        </div>
      )}
    </div>
  );
}

/** The real API response for one round -- every candidate token the
 * model actually considered, with its real logprob, not just the
 * winner. This is `topLogprobs` verbatim. */
function RawTopLogprobs({ call }: { call: RecordedCall }) {
  const entry = call.result.logprobs[0];
  if (!entry) return <div className="text-[11.5px] text-muted-foreground">no logprobs on this response</div>;
  const sorted = [...entry.topLogprobs].sort((a, b) => b.logprob - a.logprob).slice(0, 6);
  return (
    <div className="rounded-lg border border-cyan/30 bg-cyan/5 overflow-hidden">
      <table className="w-full text-[11.5px] font-mono">
        <thead>
          <tr className="border-b border-cyan/20 text-muted-foreground">
            <th className="text-left px-2.5 py-1.5 font-normal">token</th>
            <th className="text-right px-2.5 py-1.5 font-normal">logprob</th>
            <th className="text-right px-2.5 py-1.5 font-normal">e^logprob</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.token} className={cn(t.token === entry.token && "bg-cyan/10")}>
              <td className="px-2.5 py-1 text-foreground">"{t.token}"{t.token === entry.token ? " ←" : ""}</td>
              <td className="px-2.5 py-1 text-right text-muted-foreground">{t.logprob.toFixed(4)}</td>
              <td className="px-2.5 py-1 text-right text-cyan">{Math.exp(t.logprob).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawJsonToggle({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-cyan hover:underline font-mono">
        {open ? "hide raw JSON" : "view raw JSON"}
      </button>
      {open && (
        <pre className="mt-1.5 rounded-lg border border-border bg-background/60 p-3 text-[10.5px] font-mono overflow-x-auto max-h-52 overflow-y-auto text-foreground/90">
          {JSON.stringify(data, (_, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2)}
        </pre>
      )}
    </div>
  );
}

export function ExplainStepByStepDialog({ result }: { question: QuestionSpec; result: QuestionResult }) {
  const decision: Decision = result.type === "choice" ? result.decision : result.result.decision;
  const { rawAnswer, choice, probabilities } = decision;
  const confidence = probabilities.get(choice) ?? 0;
  const allIds = result.type === "choice" ? result.allOptionIds : result.type === "score" ? result.allLevelIds : ["true", "false"];

  const finalLabel =
    result.type === "choice"
      ? choice
      : result.type === "score"
        ? `${result.result.score.toFixed(2)} / ${result.allLevelIds.length - 1}`
        : `${fmtPct(result.result.truth)} true`;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="text-[11.5px]">
            Explain step by step
          </Button>
        }
      />
      <DialogContent className="w-[min(600px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>The real data, step by step</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {result.calls.length === 0 && (
            <div className="text-[11.5px] text-muted-foreground">no requests recorded for this result</div>
          )}

          {result.calls.map((call, i) => (
            <div key={i}>
              <StepLabel n={i * 2 + 1} text={`Round ${i + 1} -- real request sent to the provider`} />
              <RawRequest call={call} />
              <div className="mt-3">
                <StepLabel n={i * 2 + 2} text={`Round ${i + 1} -- real response, every token, real logprob`} />
                <RawTopLogprobs call={call} />
              </div>
            </div>
          ))}

          <div>
            <StepLabel n={result.calls.length * 2 + 1} text="Every round's logprob, summed → real probability per candidate" />
            <DistributionChart allOptionIds={allIds} decision={decision} />
            <RawJsonToggle
              data={{ logprobs: decision.logprobs, probabilities: decision.probabilities, unscored: decision.unscored }}
            />
          </div>

          <div>
            <StepLabel n={result.calls.length * 2 + 2} text="Final result" />
            <div className="rounded-lg border border-signal/40 bg-signal/10 p-4 flex items-center justify-between gap-3">
              <span className={cn("font-mono font-bold text-signal", result.type === "choice" ? "text-[18px]" : "text-[16px]")}>
                {finalLabel}
              </span>
              {result.type === "choice" && (
                <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{fmtPct(confidence)}</span>
              )}
            </div>
            {rawAnswer && (
              <div className="text-[11px] text-muted-foreground mt-1.5 font-mono">
                model's literal first reply: "{rawAnswer}"
              </div>
            )}
          </div>
        </div>

        <DialogClose
          render={
            <Button variant="outline" className="w-full mt-6">
              Close
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

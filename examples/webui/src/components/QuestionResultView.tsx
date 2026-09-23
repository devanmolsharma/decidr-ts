import { DistributionChart } from "@/components/DistributionChart";
import { PrimitiveBadge } from "@/components/PrimitiveBadge";
import { ExplainStepByStepDialog } from "@/components/ExplainStepByStepDialog";
import { fmtPct } from "@/lib/format";
import type { QuestionSpec } from "@/lib/question-types";
import type { QuestionResult } from "@/lib/run-question";
import { cn } from "@/lib/utils";

function ResultBody({ result }: { result: QuestionResult }) {
  if (result.type === "choice") {
    return <DistributionChart allOptionIds={result.allOptionIds} decision={result.decision} />;
  }

  if (result.type === "score") {
    const { score, decision } = result.result;
    const maxLevel = result.allLevelIds.length - 1;
    const pct = maxLevel > 0 ? (score / maxLevel) * 100 : 0;
    return (
      <div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-6 bg-secondary border border-border rounded-md overflow-hidden relative">
            <div
              className="h-full rounded-md bg-gradient-to-r from-signal-dim to-signal transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(pct, 1.2)}%` }}
            />
          </div>
          <div className="font-mono text-signal font-bold tabular-nums w-16 text-right">{score.toFixed(2)}</div>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground mt-1.5">
          on a 0&ndash;{maxLevel} scale &mdash; weighted by the model's own probability across every level, not just the top one
        </div>
        <div className="mt-3">
          <DistributionChart allOptionIds={result.allLevelIds} decision={decision} />
        </div>
      </div>
    );
  }

  const { truth } = result.result;
  const isTrue = truth >= 0.5;
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-6 bg-secondary border border-border rounded-md overflow-hidden relative">
          <div
            className={cn(
              "h-full rounded-md transition-[width] duration-500 ease-out",
              isTrue ? "bg-gradient-to-r from-signal-dim to-signal" : "bg-gradient-to-r from-cyan/40 to-cyan/70",
            )}
            style={{ width: `${Math.max(truth * 100, 1.2)}%` }}
          />
        </div>
        <div className={cn("font-mono font-bold tabular-nums w-20 text-right", isTrue ? "text-signal" : "text-cyan")}>
          {fmtPct(truth)}
        </div>
      </div>
      <div className="text-[11px] font-mono text-muted-foreground mt-1.5">
        probability true &mdash; the number itself is the signal, not just which side of 50% it lands on
      </div>
    </div>
  );
}

export function QuestionResultView({ question, result }: { question: QuestionSpec; result: QuestionResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <PrimitiveBadge type={question.type} />
        <span className="text-[13px] text-foreground flex-1">{question.instructions}</span>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">{result.latencyMs.toFixed(0)}ms</span>
      </div>
      <ResultBody result={result} />
      <div className="mt-3 pt-3 border-t border-border/60">
        <ExplainStepByStepDialog question={question} result={result} />
      </div>
    </div>
  );
}

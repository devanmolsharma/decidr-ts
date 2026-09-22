import type { Decision } from "decidr-ts";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Renders the FULL option space every time -- every id in `allOptionIds`
 * gets a row, always, whether or not it ended up scored. A demo that only
 * shows the handful of options that happened to get a nonzero probability
 * looks like it's hiding the ones that didn't, even though the mechanism
 * genuinely raced and reported on all of them (unscored/eliminated are
 * real, honest outcomes -- see docs/PREFIX_MATCHING.md and
 * docs/HIERARCHY.md). Rows are grouped by status so the real distribution
 * (measured, stopped early) is visually distinct from the two "no number"
 * outcomes (unscored, eliminated).
 */
export function DistributionChart({ allOptionIds, decision }: { allOptionIds: string[]; decision: Decision }) {
  const { probabilities, choice, unscored, eliminated, stoppedEarly } = decision;

  type Status = "measured" | "stopped" | "unscored" | "eliminated";
  const rows = allOptionIds.map((id) => {
    if (probabilities.has(id)) {
      const status: Status = stoppedEarly.includes(id) ? "stopped" : "measured";
      return { id, p: probabilities.get(id) ?? 0, status };
    }
    if (unscored.includes(id)) return { id, p: 0, status: "unscored" as Status };
    if (eliminated.includes(id)) return { id, p: 0, status: "eliminated" as Status };
    return { id, p: 0, status: "unscored" as Status };
  });

  const order: Record<Status, number> = { measured: 0, stopped: 0, unscored: 1, eliminated: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.p - a.p);

  const maxP = Math.max(...rows.map((r) => r.p), 0.0001);

  return (
    <div>
      {rows.map(({ id, p, status }) => {
        const isWinner = id === choice;
        const isMeasured = status === "measured" || status === "stopped";
        const widthPct = isMeasured ? Math.max((p / maxP) * 100, 1.2) : 0;
        const marker = status === "unscored" ? "*" : status === "eliminated" ? "**" : "";

        return (
          <div key={id} className="grid grid-cols-[minmax(0,220px)_1fr_88px] items-center gap-3 text-[13px] py-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={cn(
                  "font-mono truncate",
                  isWinner ? "text-signal font-bold" : isMeasured ? "text-slate-200" : "text-muted-foreground",
                )}
                title={id}
              >
                {id}
                {isWinner ? " ←" : ""}
                {marker}
              </span>
              {status === "stopped" && (
                <span
                  className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-muted-foreground"
                  title="Scored on a partial probability -- no other option was still competing for its prefix, so it was stopped there rather than walked to the end of its own id."
                >
                  partial
                </span>
              )}
            </div>

            <div className="h-6 bg-secondary border border-border rounded-md overflow-hidden relative">
              <div
                className={cn(
                  "h-full rounded-md transition-[width] duration-500 ease-out",
                  isWinner
                    ? "bg-gradient-to-r from-signal-dim to-signal"
                    : isMeasured
                      ? "bg-gradient-to-r from-cyan/40 to-cyan/70"
                      : "bg-muted-foreground/30",
                )}
                style={{ width: `${widthPct}%` }}
              />
            </div>

            <div
              className={cn(
                "text-right font-mono tabular-nums",
                isWinner ? "text-signal font-bold" : isMeasured ? "text-slate-300" : "text-muted-foreground",
              )}
            >
              {fmtPct(p)}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-border text-[11px] font-mono text-muted-foreground">
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-signal-dim to-signal align-middle mr-1.5" />
          chosen
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan/60 align-middle mr-1.5" />
          measured, real probability &mdash;{" "}
          <span className="text-muted-foreground/80">"partial" means no competition remained, so it stopped early</span>
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted-foreground/30 align-middle mr-1.5" />* not measured
          &mdash; never appeared in the model's top tokens, ** eliminated &mdash; lost a real race, branch not explored further
        </span>
      </div>
    </div>
  );
}

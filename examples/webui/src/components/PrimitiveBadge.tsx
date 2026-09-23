import { cn } from "@/lib/utils";
import type { PrimitiveType } from "@/lib/question-types";

const STYLES: Record<PrimitiveType, string> = {
  choice: "bg-cyan/10 text-cyan border-cyan/30",
  score: "bg-signal/10 text-signal border-signal/30",
  noun: "bg-accent-foreground/10 text-accent-foreground border-accent-foreground/30",
};

const LABELS: Record<PrimitiveType, string> = { choice: "Choice", score: "Score", noun: "Noun" };

export function PrimitiveBadge({ type, className }: { type: PrimitiveType; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold uppercase tracking-wider",
        STYLES[type],
        className,
      )}
    >
      {LABELS[type]}
    </span>
  );
}

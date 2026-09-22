import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** TypeSafe's own panel header pattern: a thin fixed-height bar, label
 * on the left, actions right-aligned, a bottom border separating it from
 * the panel body -- used identically by both the State and Questions
 * panels in the real console (verified against a saved DOM capture). */
export function PanelToolbar({ label, children, className }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-10 shrink-0 items-center border-b border-border px-3", className)}>
      <div className="flex-1 truncate text-[13px] font-medium text-muted-foreground">{label}</div>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  );
}

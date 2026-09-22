import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-xl p-6 mb-5", className)}>
      <h3 className="m-0 mb-3.5 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

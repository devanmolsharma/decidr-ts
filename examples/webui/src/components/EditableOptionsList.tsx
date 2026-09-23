import type { RowOption } from "decidr-ts";
import { cn } from "@/lib/utils";

const idInputClass =
  "w-[132px] shrink-0 bg-transparent border-b border-border/60 px-0.5 py-1 text-[12px] font-mono text-cyan outline-none focus:border-ring transition-colors";
const descInputClass =
  "flex-1 bg-transparent border-b border-transparent px-0.5 py-1 text-[13px] text-foreground/90 outline-none focus:border-ring transition-colors";

/** Choice's criteria editor: a plain list of id/description rows, add
 * and remove freely -- unlike Score's levels, Choice options have no
 * inherent order that matters to the mechanism. */
export function EditableOptionsList({ options, onChange }: { options: RowOption[]; onChange: (options: RowOption[]) => void }) {
  function update(i: number, field: "id" | "description", value: string) {
    const next = options.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  }

  function remove(i: number) {
    onChange(options.filter((_, idx) => idx !== i));
  }

  function add() {
    onChange([...options, { id: `option_${options.length + 1}`, description: "" }]);
  }

  return (
    <div>
      <div className="text-muted-foreground text-[10.5px] uppercase tracking-wider mb-1.5">Options &middot; {options.length}</div>
      <div className="flex flex-col rounded-lg border border-border/70 divide-y divide-border/70 overflow-hidden bg-background/30">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-3 items-center px-3 py-1.5 group">
            <input
              className={idInputClass}
              value={opt.id}
              onChange={(e) => update(i, "id", e.target.value)}
              placeholder="option_id"
              spellCheck={false}
            />
            <input
              className={descInputClass}
              value={opt.description}
              onChange={(e) => update(i, "description", e.target.value)}
              placeholder="description"
            />
            <button
              onClick={() => remove(i)}
              className="shrink-0 text-muted-foreground/50 hover:text-destructive text-[13px] opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove option ${opt.id}`}
            >
              &times;
            </button>
          </div>
        ))}
        <div className="px-3 py-1.5">
          <button onClick={add} className={cn("text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors")}>
            + add option
          </button>
        </div>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

const descInputClass =
  "flex-1 bg-transparent border-b border-transparent px-0.5 py-1 text-[13px] text-foreground/90 outline-none focus:border-ring transition-colors";

/** Score's ordered-rubric editor -- levels are position-ordered (low to
 * high), unlike Choice's unordered option list, so rows are only ever
 * appended/removed from the end to keep the low-to-high reading intact.
 * Ids are auto-assigned ("lv0", "lv1", ...) since the level's position
 * is what carries meaning here, not a caller-chosen id -- see
 * docs/NAMING_IDS.md's note on why a shared "level" segment (e.g.
 * "level_0") would accidentally create an unwanted id hierarchy. */
export function EditableLevelsList({ levels, onChange }: { levels: string[]; onChange: (levels: string[]) => void }) {
  function update(i: number, description: string) {
    const next = levels.slice();
    next[i] = description;
    onChange(next);
  }

  function remove(i: number) {
    onChange(levels.filter((_, idx) => idx !== i));
  }

  function add() {
    onChange([...levels, ""]);
  }

  return (
    <div>
      <div className="text-muted-foreground text-[10.5px] uppercase tracking-wider mb-1.5">Levels, low to high &middot; {levels.length}</div>
      <div className="flex flex-col rounded-lg border border-border/70 divide-y divide-border/70 overflow-hidden bg-background/30">
        {levels.map((description, i) => (
          <div key={i} className="flex gap-3 items-center px-3 py-1.5 group">
            <span
              className={cn(
                "w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-mono font-bold",
                i === levels.length - 1 ? "bg-signal/15 text-signal" : "bg-secondary text-muted-foreground",
              )}
            >
              {i}
            </span>
            <input
              className={descInputClass}
              value={description}
              onChange={(e) => update(i, e.target.value)}
              placeholder="level description"
            />
            <button
              onClick={() => remove(i)}
              className="shrink-0 text-muted-foreground/50 hover:text-destructive text-[13px] opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove level ${i}`}
            >
              &times;
            </button>
          </div>
        ))}
        <div className="px-3 py-1.5">
          <button onClick={add} className="text-[12px] font-mono text-muted-foreground hover:text-foreground transition-colors">
            + add level
          </button>
        </div>
      </div>
    </div>
  );
}

import type { RowOption } from "decidr-ts";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { EditableOptionsList } from "@/components/EditableOptionsList";
import { EditableLevelsList } from "@/components/EditableLevelsList";
import { PrimitiveBadge } from "@/components/PrimitiveBadge";
import { cn } from "@/lib/utils";
import type { PrimitiveType, QuestionSpec } from "@/lib/question-types";

const PRIMITIVE_HINTS: Record<PrimitiveType, string> = {
  choice: "Which of these options?",
  score: "Where on this rubric?",
  noun: "Is this true?",
};

function defaultCriteria(type: PrimitiveType): RowOption[] | string[] | undefined {
  if (type === "choice") return [{ id: "option_a", description: "" }, { id: "option_b", description: "" }];
  if (type === "score") return ["low", "high"];
  return undefined;
}

/** One question card in Builder mode: a primitive-type badge (doubling
 * as a dropdown), an instructions field, and a type-specific criteria
 * editor -- matches TypeSafe's own console shape (badge/dropdown +
 * instructions + criteria), restyled for this page's dark palette. */
export function QuestionCard({
  question,
  onChange,
  onRemove,
}: {
  question: QuestionSpec;
  onChange: (question: QuestionSpec) => void;
  onRemove: () => void;
}) {
  function setType(type: PrimitiveType) {
    onChange({ ...question, type, criteria: defaultCriteria(type) });
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/70 bg-secondary/30">
        <Select value={question.type} onValueChange={(v) => setType(v as PrimitiveType)}>
          <SelectTrigger className="w-auto h-auto p-0 border-0 shadow-none bg-transparent [&_svg]:hidden">
            <PrimitiveBadge type={question.type} className="cursor-pointer hover:brightness-125 transition-[filter]" />
          </SelectTrigger>
          <SelectContent>
            {(["choice", "score", "noun"] as PrimitiveType[]).map((t) => (
              <SelectItem key={t} value={t} className="text-[13px] font-mono capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          className={cn("flex-1 bg-transparent border-0 outline-none text-[14px] text-foreground placeholder:text-muted-foreground/70")}
          value={question.instructions}
          onChange={(e) => onChange({ ...question, instructions: e.target.value })}
          placeholder={PRIMITIVE_HINTS[question.type]}
        />

        <button
          onClick={onRemove}
          className="shrink-0 text-muted-foreground/60 hover:text-destructive text-base leading-none px-1"
          aria-label="Remove question"
        >
          &times;
        </button>
      </div>

      <div className="p-4">
        {question.type === "choice" && (
          <EditableOptionsList
            options={(question.criteria as RowOption[] | undefined) ?? []}
            onChange={(options) => onChange({ ...question, criteria: options })}
          />
        )}
        {question.type === "score" && (
          <EditableLevelsList
            levels={(question.criteria as string[] | undefined) ?? []}
            onChange={(levels) => onChange({ ...question, criteria: levels })}
          />
        )}
        {question.type === "noun" && (
          <p className="text-[12px] text-muted-foreground">No criteria needed &mdash; answers with a single true/false probability.</p>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiKey, currentProvider } from "@/hooks/useApiKey";
import { PROVIDERS } from "@/lib/providers";
import { EXAMPLE_PRESETS, type ExamplePreset } from "@/lib/examples";
import { cn } from "@/lib/utils";

const inputClass =
  "bg-secondary border border-border rounded-md px-2.5 h-8 text-[13px] font-mono text-foreground outline-none focus:border-ring transition-colors";

const CUSTOM_MODEL_VALUE = "__custom__";

/** A single, thin app-shell header replacing what used to be a permanent
 * left sidebar: provider/model/key on the left, the example picker on
 * the right. Everything else on the page is three equal-width columns
 * side by side (State / Questions / Results) instead of a tall single
 * column or a cramped multi-panel split. */
export function TopBar({ activePresetId, onLoadPreset }: { activePresetId: string; onLoadPreset: (preset: ExamplePreset) => void }) {
  const { providerId, setProviderId, model, setModel, apiKey, setApiKey, customBaseURL, setCustomBaseURL, keyStatus } =
    useApiKey();
  const provider = currentProvider(providerId);

  // "Custom model" is a per-provider escape hatch, not a separate
  // provider -- every listed provider only ships a handful of ids known
  // to return real logprobs (see providers.ts), but a provider may add
  // more models over time, or a visitor may know one that works that
  // isn't listed yet.
  const [usingCustomModel, setUsingCustomModel] = useState(false);

  function selectProvider(id: string) {
    setProviderId(id);
    setUsingCustomModel(false);
    const next = PROVIDERS.find((p) => p.id === id);
    if (next && next.models.length > 0 && !next.models.some((m) => m.id === model)) {
      setModel(next.models[0].id);
    }
  }

  function selectModel(value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setUsingCustomModel(true);
      setModel("");
    } else {
      setUsingCustomModel(false);
      setModel(value);
    }
  }

  return (
    <header className="h-14 shrink-0 border-b border-border px-5 flex items-center gap-3 overflow-x-auto">
      <span className="font-mono font-bold text-[14px] tracking-tight text-foreground shrink-0">decidr-ts</span>
      <div className="w-px h-6 bg-border shrink-0" />

      <Select value={providerId} onValueChange={selectProvider}>
        <SelectTrigger className="w-auto min-w-32 h-8 text-[13px] font-mono shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-[13px] font-mono">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {provider.models.length > 0 && !usingCustomModel && (
        <Select value={model} onValueChange={selectModel}>
          <SelectTrigger className="w-auto min-w-40 h-8 text-[13px] font-mono shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {provider.models.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-[13px] font-mono">
                {m.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MODEL_VALUE} className="text-[13px] font-mono text-muted-foreground">
              Custom model…
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {(provider.models.length === 0 || usingCustomModel) && (
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model-id"
          className={cn(inputClass, "w-40 shrink-0")}
          spellCheck={false}
        />
      )}

      {usingCustomModel && provider.models.length > 0 && (
        <button
          onClick={() => {
            setUsingCustomModel(false);
            setModel(provider.models[0].id);
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
          title="Back to the model list"
        >
          &times;
        </button>
      )}

      {provider.id === "custom" && (
        <input
          value={customBaseURL}
          onChange={(e) => setCustomBaseURL(e.target.value)}
          placeholder="https://your-host.example.com/v1"
          className={cn(inputClass, "w-56 shrink-0")}
          spellCheck={false}
        />
      )}

      {provider.needsKey && (
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="password"
            placeholder={provider.keyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={cn(inputClass, "w-40")}
            autoComplete="off"
            spellCheck={false}
          />
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              keyStatus === "ok" && "bg-cyan",
              keyStatus === "bad" && "bg-destructive",
              keyStatus === null && "bg-transparent",
            )}
            title={keyStatus === "ok" ? "key works" : keyStatus === "bad" ? "key or request failed" : undefined}
          />
          <a
            href="https://github.com/devanmolsharma/decidr-ts/tree/main/examples/webui"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-cyan hover:underline shrink-0 whitespace-nowrap"
            title="Your key stays in this tab's memory and goes straight from your browser to the provider you picked -- never to any server we control. Check the source yourself."
          >
            key never leaves your browser &middot; view source
          </a>
        </div>
      )}

      <div className="flex-1 min-w-3" />

      <Select value={activePresetId} onValueChange={(id) => onLoadPreset(EXAMPLE_PRESETS.find((p) => p.id === id)!)}>
        <SelectTrigger className="w-auto min-w-52 h-8 text-[13px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXAMPLE_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id} className="text-[13px]">
              {preset.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}

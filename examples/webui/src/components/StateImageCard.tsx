import { useRef } from "react";
import { Button } from "@/components/ui/button";

/** A proper card for the State panel's attached image -- not just a bare
 * `<img>` -- with a real "replace" action that swaps in a file the
 * visitor picks, base64-encoded the same way the built-in example
 * images are. */
export function StateImageCard({
  src,
  onReplace,
  onRemove,
}: {
  src: string;
  onReplace: (dataBase64: string, mimeType: string) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:image/png;base64,AAAA..."
      const match = /^data:([^;]+);base64,(.*)$/s.exec(result);
      if (!match) return;
      const [, mimeType, base64] = match;
      onReplace(base64, mimeType);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mt-3">
      <img src={src} className="w-full max-h-56 object-contain bg-background/40" alt="State image" />
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <span className="text-[11px] font-mono text-muted-foreground">image content block</span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Replace…
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

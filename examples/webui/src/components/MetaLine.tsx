export function MetaLine({ pairs }: { pairs: [string, string | number][] }) {
  return (
    <div className="flex gap-5 flex-wrap text-[12.5px] font-mono text-muted-foreground mt-4">
      {pairs.map(([label, value]) => (
        <span key={label}>
          {label}: <b className="text-slate-100">{value}</b>
        </span>
      ))}
    </div>
  );
}

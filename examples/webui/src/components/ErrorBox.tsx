export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="text-destructive text-[13px] font-mono bg-destructive/10 border border-destructive/30 rounded-lg p-3.5 mt-4">
      {message}
    </div>
  );
}

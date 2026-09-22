export function fmtPct(p: number): string {
  return (p * 100).toFixed(p < 0.001 ? 4 : 2) + "%";
}

"use client";

interface Row {
  label: string;
  total: number;
  correct: number;
  rate: number;
}

/**
 * Inline horizontal bar chart for topic / difficulty / Bloom breakdowns.
 * No chart library — just flex + background fills.
 */
export function BreakdownBars({
  rows,
  emptyMessage = "No data yet.",
}: {
  rows: Row[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">{emptyMessage}</p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = Math.round(r.rate * 100);
        const colorClass =
          r.rate >= 0.8
            ? "bg-green-500/60"
            : r.rate >= 0.5
              ? "bg-amber-500/60"
              : "bg-red-500/60";
        return (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{r.label}</span>
              <span className="text-muted-foreground tabular-nums text-xs">
                {r.correct} / {r.total} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${colorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

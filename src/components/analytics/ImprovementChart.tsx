"use client";

interface Point {
  trial: number;
  completedAt: string;
  score: number;
}

/**
 * Inline SVG line chart — score per trial. Zero dependencies, no chart
 * library needed for this simple visualization.
 */
export function ImprovementChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No completed attempts yet.
      </p>
    );
  }

  const width = 640;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xs = (i: number) =>
    padding.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const ys = (score: number) =>
    padding.top + (1 - score) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i).toFixed(1)} ${ys(p.score).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Y-axis gridlines at 0%, 25%, 50%, 75%, 100% */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
        <g key={frac}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={ys(frac)}
            y2={ys(frac)}
            stroke="currentColor"
            className="text-border"
            strokeDasharray={frac === 0 || frac === 1 ? "" : "2,4"}
          />
          <text
            x={padding.left - 6}
            y={ys(frac) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {Math.round(frac * 100)}%
          </text>
        </g>
      ))}

      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="2"
      />

      {/* Points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={xs(i)}
            cy={ys(p.score)}
            r="4"
            fill="currentColor"
            className="text-primary"
          />
          <text
            x={xs(i)}
            y={height - padding.bottom + 14}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            #{p.trial}
          </text>
        </g>
      ))}
    </svg>
  );
}

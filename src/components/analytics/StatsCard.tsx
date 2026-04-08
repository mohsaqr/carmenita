import { Card, CardContent } from "@/components/ui/card";

export function StatsCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
          {label}
        </div>
        {sublabel && (
          <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
        )}
      </CardContent>
    </Card>
  );
}

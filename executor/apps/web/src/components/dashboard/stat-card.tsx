import { Card, CardContent } from "@/components/ui/card";

export function DashboardStatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "green" | "amber" | "red" | "default";
}) {
  const accentClass = {
    green: "text-terminal-green",
    amber: "text-terminal-amber",
    red: "text-terminal-red",
    default: "text-muted-foreground",
  }[accent ?? "default"];

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={`text-2xl font-semibold mt-1 font-mono ${accentClass}`}>{value}</p>
          </div>
          <div className={`${accentClass} opacity-40`}>
            <Icon className="h-8 w-8" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

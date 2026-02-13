import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type SetupStep = {
  label: string;
  done: boolean;
  href: string;
  pendingText: string;
  doneText: string;
};

export function DashboardSetupCard({
  taskCount,
  setupSteps,
}: {
  taskCount: number;
  setupSteps: SetupStep[];
}) {
  return (
    <Card className="border-border bg-gradient-to-br from-card to-muted/25">
      <CardContent className="p-5 md:p-6 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Landing View</p>
            <h2 className="text-lg font-semibold tracking-tight">
              {taskCount === 0
                ? "Connect tools and run your first task"
                : "Your task activity and approval queue are live"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Tasks is the primary workflow. Use the advanced runner only when you want direct code
              execution.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="h-8 text-xs">
              <a href="/tasks">Open task activity</a>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <a href="/tools">Manage tools</a>
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {setupSteps.map((step) => (
            <a
              key={step.label}
              href={step.href}
              className="rounded-md border border-border/70 bg-background/70 px-3 py-2.5 hover:bg-accent/25 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{step.label}</span>
                {step.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-terminal-green" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {step.done ? step.doneText : step.pendingText}
              </p>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

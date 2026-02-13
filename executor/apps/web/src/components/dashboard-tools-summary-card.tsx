import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ChevronRight, Globe, Server, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ToolDescriptor } from "@/lib/types";
import { groupToolsBySource } from "@/components/dashboard-view-helpers";

export function DashboardToolsSummaryCard({ tools }: { tools: ToolDescriptor[] }) {
  const navigate = useNavigate();
  const groups = useMemo(() => groupToolsBySource(tools), [tools]);
  const totalApprovals = tools.filter((tool) => tool.approval === "required").length;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            Tool Sources
            <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {tools.length} tools
            </span>
            {totalApprovals > 0 && (
              <span className="text-[10px] font-mono bg-terminal-amber/10 text-terminal-amber px-1.5 py-0.5 rounded">
                {totalApprovals} gated
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => navigate("/tools")}
          >
            Manage
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-1">
          {groups.map((group) => {
            const SourceIcon = group.type === "mcp" ? Server : Globe;

            return (
              <button
                key={group.name}
                onClick={() => navigate(`/tools?source=${encodeURIComponent(group.name)}`)}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/40 transition-colors text-left group/row w-full"
              >
                <div className="h-7 w-7 rounded bg-muted flex items-center justify-center shrink-0">
                  <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-foreground">{group.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
                      {group.type}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {group.tools.length} tool{group.tools.length !== 1 ? "s" : ""}
                    {group.namespaces.size > 0 && (
                      <> · {group.namespaces.size} namespace{group.namespaces.size !== 1 ? "s" : ""}</>
                    )}
                    {group.approvalCount > 0 && (
                      <>
                        {" "}
                        · <span className="text-terminal-amber">{group.approvalCount} gated</span>
                      </>
                    )}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0" />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

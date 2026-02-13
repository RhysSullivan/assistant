"use client";

import { CheckCircle2, Play, ShieldCheck, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { DashboardSetupCard } from "@/components/dashboard/setup-card";
import { DashboardStatCard } from "@/components/dashboard/stat-card";
import { DashboardPendingApprovalsCard } from "@/components/dashboard/pending-approvals-card";
import { DashboardRecentTasksCard } from "@/components/dashboard/recent-tasks-card";
import { DashboardToolsSummaryCard } from "@/components/dashboard/tools-summary-card";
import { useSession } from "@/lib/session-context";
import { useWorkspaceTools } from "@/hooks/use-workspace-tools";
import { useQuery } from "convex/react";
import { convexApi } from "@/lib/convex-api";
import {
  getPendingApprovals,
  getRecentTasks,
  getSetupSteps,
  getTaskStats,
} from "@/components/dashboard/view-helpers";
import { workspaceQueryArgs } from "@/lib/workspace-query-args";

export function DashboardView() {
  const { context, loading: sessionLoading } = useSession();

  const tasks = useQuery(
    convexApi.workspace.listTasks,
    workspaceQueryArgs(context),
  );

  const approvals = useQuery(
    convexApi.workspace.listPendingApprovals,
    workspaceQueryArgs(context),
  );

  const sources = useQuery(
    convexApi.workspace.listToolSources,
    workspaceQueryArgs(context),
  );

  const { tools } = useWorkspaceTools(context ?? null);

  if (sessionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const pendingCount = approvals?.length ?? 0;
  const sourceCount = sources?.length ?? 0;
  const taskItems = tasks ?? [];
  const { runningCount, completedCount, failedCount } = getTaskStats(taskItems);
  const recentTasks = getRecentTasks(taskItems);
  const pendingApprovals = getPendingApprovals(approvals ?? []);
  const setupSteps = getSetupSteps({ sourceCount, taskCount: taskItems.length, pendingCount });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace Home"
        description="Start from the current status, then jump straight to execution"
      />

      <DashboardSetupCard taskCount={taskItems.length} setupSteps={setupSteps} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardStatCard
          label="Pending Approvals"
          value={pendingCount}
          icon={ShieldCheck}
          accent={pendingCount > 0 ? "amber" : "default"}
        />
        <DashboardStatCard
          label="Running"
          value={runningCount}
          icon={Play}
          accent={runningCount > 0 ? "green" : "default"}
        />
        <DashboardStatCard
          label="Completed"
          value={completedCount}
          icon={CheckCircle2}
          accent="green"
        />
        <DashboardStatCard
          label="Failed"
          value={failedCount}
          icon={XCircle}
          accent={failedCount > 0 ? "red" : "default"}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <DashboardPendingApprovalsCard pendingCount={pendingCount} approvals={pendingApprovals} />
        <DashboardRecentTasksCard recentTasks={recentTasks} />
      </div>

      {tools.length > 0 && <DashboardToolsSummaryCard tools={tools} />}
    </div>
  );
}

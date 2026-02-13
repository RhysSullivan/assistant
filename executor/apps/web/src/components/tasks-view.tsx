"use client";

import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Play, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskDetail } from "@/components/task-detail";
import { TaskComposer } from "@/components/task-composer";
import { TaskListItem } from "@/components/task-list-item";
import { useSession } from "@/lib/session-context";
import { useQuery } from "convex/react";
import { convexApi } from "@/lib/convex-api";
import { workspaceQueryArgs } from "@/lib/workspace-query-args";
import type {
  TaskRecord,
  PendingApprovalRecord,
} from "@/lib/types";
// ── Tasks View ──

export function TasksView() {
  const { context, loading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"activity" | "runner">("activity");
  const selectedId = searchParams.get("selected");

  const tasks = useQuery(
    convexApi.workspace.listTasks,
    workspaceQueryArgs(context),
  );
  const tasksLoading = !!context && tasks === undefined;
  const taskItems = tasks ?? [];

  const approvals = useQuery(
    convexApi.workspace.listPendingApprovals,
    workspaceQueryArgs(context),
  );
  const pendingApprovals = approvals ?? [];

  const selectedTask = taskItems.find((t: TaskRecord) => t.id === selectedId);
  const selectedTaskApprovals = selectedTask
    ? pendingApprovals.filter((approval: PendingApprovalRecord) => approval.taskId === selectedTask.id)
    : [];

  const selectTask = useCallback(
    (taskId: string | null) => {
      if (taskId) {
        navigate(`/tasks?selected=${taskId}`);
      } else {
        navigate("/tasks");
      }
    },
    [navigate],
  );

  if (sessionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Task activity first, with an advanced editor when you need it"
      >
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setActiveTab("runner")}>
          Advanced runner
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/approvals")}>
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
          {pendingApprovals.length} pending
        </Button>
      </PageHeader>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "activity" | "runner")}>
        <TabsList className="bg-muted/50 h-9">
          <TabsTrigger value="activity" className="text-xs data-[state=active]:bg-background">
            Activity
            <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">{taskItems.length}</span>
          </TabsTrigger>
          <TabsTrigger value="runner" className="text-xs data-[state=active]:bg-background">
            Runner (Advanced)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  Task History
                  {tasks && (
                    <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                      {taskItems.length}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {tasksLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                ) : taskItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                    <p>No tasks yet.</p>
                    <Button size="sm" className="h-8 text-xs" onClick={() => setActiveTab("runner")}>Run your first task</Button>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[620px] overflow-y-auto">
                    {taskItems.map((task: TaskRecord) => (
                      <TaskListItem
                        key={task.id}
                        task={task}
                        selected={task.id === selectedId}
                        onClick={() => selectTask(task.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div>
              {selectedTask && context ? (
                <TaskDetail
                  task={selectedTask}
                  workspaceId={context.workspaceId}
                  sessionId={context?.sessionId}
                  pendingApprovals={selectedTaskApprovals}
                  onClose={() => selectTask(null)}
                />
              ) : (
                <Card className="bg-card border-border">
                  <CardContent className="flex items-center justify-center py-24">
                    <p className="text-sm text-muted-foreground">
                      Select a task to view logs, output, and approval actions
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="runner" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <TaskComposer />
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Play className="h-4 w-4 text-terminal-green" />
                  Before you run
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3 text-xs text-muted-foreground">
                <p>
                  This editor is the advanced path for direct code execution. Most day-to-day work happens in Activity.
                </p>
                <p>
                  New runs appear in Task History, and any gated tool calls can be approved inline from the selected task.
                </p>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setActiveTab("activity")}>
                  Back to activity view
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

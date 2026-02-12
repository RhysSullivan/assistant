"use client";

import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Play,
  ChevronRight,
  X,
  Send,
  ShieldCheck,
  ShieldX,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/code-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskStatusBadge } from "@/components/status-badge";
import { FormattedCodeBlock } from "@/components/formatted-code-block";
import { useSession } from "@/lib/session-context";
import { useWorkspaceTools } from "@/hooks/use-workspace-tools";
import { useMutation, useQuery } from "convex/react";
import { convexApi } from "@/lib/convex-api";
import type {
  RuntimeTargetDescriptor,
  TaskRecord,
  PendingApprovalRecord,
} from "@/lib/types";
import type { Id } from "@executor/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DEFAULT_CODE = `// Example: call some tools and return a compact result
const time = await tools.utils.get_time();
const sum = await tools.math.add({ a: 7, b: 35 });

// This will require approval:
await tools.admin.send_announcement({
  channel: "general",
  message: "Hello from executor!"
});

return {
  isoTime: time.iso,
  total: sum.result,
};`;
const DEFAULT_TIMEOUT_MS = 300_000;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResult(result: unknown): string {
  if (result === undefined) {
    return "";
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatApprovalInput(
  input: unknown,
): {
  content: string;
  language: "json" | "text";
} | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return {
        content: JSON.stringify(JSON.parse(trimmed), null, 2),
        language: "json",
      };
    } catch {
      return {
        content: trimmed,
        language: "text",
      };
    }
  }

  try {
    return {
      content: JSON.stringify(input, null, 2),
      language: "json",
    };
  } catch {
    const fallback = String(input).trim();
    if (!fallback) {
      return null;
    }

    return {
      content: fallback,
      language: "text",
    };
  }
}

// ── Task Composer ──

function TaskComposer() {
  const { context } = useSession();
  const [code, setCode] = useState(DEFAULT_CODE);
  const [runtimeId, setRuntimeId] = useState("local-bun");
  const [timeoutMs, setTimeoutMs] = useState(String(DEFAULT_TIMEOUT_MS));
  const [submitting, setSubmitting] = useState(false);

  const runtimes = useQuery(convexApi.workspace.listRuntimeTargets, {});
  const createTask = useMutation(convexApi.executor.createTask);
  const { tools, dtsUrls, loadingTools, loadingTypes } = useWorkspaceTools(context ?? null);

  const handleSubmit = async () => {
    if (!context || !code.trim()) return;
    setSubmitting(true);
    try {
      const data = await createTask({
        code,
        runtimeId,
        timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        clientId: context.clientId,
      });
      toast.success(`Task created: ${data.task.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create task",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Play className="h-4 w-4 text-terminal-green" />
          New Task
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Runtime</Label>
            <Select value={runtimeId} onValueChange={setRuntimeId}>
              <SelectTrigger className="h-8 text-xs font-mono bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(runtimes ?? []).map((r: RuntimeTargetDescriptor) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Timeout (ms)
            </Label>
            <Input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              className="h-8 text-xs font-mono bg-background"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Code</Label>
            <span className="text-[10px] font-mono text-muted-foreground">
              {loadingTools
                ? "Loading tool inventory..."
                : loadingTypes
                  ? `${tools.length} tool${tools.length === 1 ? "" : "s"} loaded, type defs warming...`
                  : `${tools.length} tool${tools.length === 1 ? "" : "s"} ready`}
            </span>
          </div>
          {!loadingTools && loadingTypes && tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
              {tools.slice(0, 8).map((tool) => (
                <span
                  key={tool.path}
                  className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                >
                  {tool.path}
                </span>
              ))}
              {tools.length > 8 && (
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  +{tools.length - 8} more
                </span>
              )}
            </div>
          )}
          <div className="rounded-md border border-border">
            <CodeEditor
              value={code}
              onChange={setCode}
              tools={tools}
              dtsUrls={dtsUrls}
              typesLoading={loadingTypes}
              height="400px"
            />
          </div>
        </div>
        <Button
          onClick={handleSubmit}
          disabled={submitting || !code.trim()}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-9"
          size="sm"
        >
          <Send className="h-3.5 w-3.5 mr-2" />
          {submitting ? "Creating..." : "Execute Task"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Task List ──

function TaskListItem({
  task,
  selected,
  onClick,
}: {
  task: TaskRecord;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-left group",
        selected
          ? "bg-primary/10 border border-primary/20"
          : "hover:bg-accent/50 border border-transparent",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-foreground truncate">
            {task.id}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono text-muted-foreground">
            {task.runtimeId}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatDate(task.createdAt)}
          </span>
        </div>
      </div>
      <TaskStatusBadge status={task.status} />
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

// ── Task Detail ──

function TaskDetail({
  task,
  workspaceId,
  sessionId,
  pendingApprovals,
  onClose,
}: {
  task: TaskRecord;
  workspaceId: Id<"workspaces">;
  sessionId?: string;
  pendingApprovals: PendingApprovalRecord[];
  onClose: () => void;
}) {
  const resolveApproval = useMutation(convexApi.executor.resolveApproval);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const liveTaskData = useQuery(
    convexApi.workspace.getTaskInWorkspace,
    workspaceId ? { taskId: task.id, workspaceId, sessionId } : "skip",
  );

  const liveTask = liveTaskData ?? task;
  const liveResult = formatResult(liveTask.result);

  const duration =
    liveTask.completedAt && liveTask.startedAt
      ? `${((liveTask.completedAt - liveTask.startedAt) / 1000).toFixed(2)}s`
      : liveTask.startedAt
        ? "running..."
        : "—";

  const handleResolveApproval = async (
    approvalId: string,
    decision: "approved" | "denied",
    toolPath: string,
  ) => {
    setResolvingApprovalId(approvalId);
    try {
      await resolveApproval({
        workspaceId,
        sessionId,
        approvalId,
        decision,
      });
      toast.success(
        decision === "approved"
          ? `Approved: ${toolPath}`
          : `Denied: ${toolPath}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resolve approval");
    } finally {
      setResolvingApprovalId(null);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium font-mono truncate pr-4">
            {liveTask.id}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metadata grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Status", value: <TaskStatusBadge status={liveTask.status} /> },
            { label: "Runtime", value: <span className="font-mono text-xs">{liveTask.runtimeId}</span> },
            { label: "Duration", value: <span className="font-mono text-xs">{duration}</span> },
            {
              label: "Exit Code",
              value: (
                <span className={cn("font-mono text-xs", liveTask.exitCode === 0 ? "text-terminal-green" : liveTask.exitCode ? "text-terminal-red" : "text-muted-foreground")}>
                  {liveTask.exitCode ?? "—"}
                </span>
              ),
            },
          ].map((item) => (
            <div key={item.label}>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">
                {item.label}
              </span>
              {item.value}
            </div>
          ))}
        </div>

        {pendingApprovals.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-terminal-amber">
                  Pending approvals
                </span>
                <span className="text-[10px] font-mono bg-terminal-amber/10 text-terminal-amber px-1.5 py-0.5 rounded">
                  {pendingApprovals.length}
                </span>
              </div>
              {pendingApprovals.map((approval) => {
                const input = formatApprovalInput(approval.input);
                const resolving = resolvingApprovalId === approval.id;
                return (
                  <div
                    key={approval.id}
                    className="rounded-md border border-terminal-amber/30 bg-terminal-amber/6 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-foreground truncate">
                          {approval.toolPath}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Requested {formatDate(approval.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10"
                          disabled={resolvingApprovalId !== null}
                          onClick={() =>
                            void handleResolveApproval(
                              approval.id,
                              "approved",
                              approval.toolPath,
                            )
                          }
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {resolving ? "Approving..." : "Approve"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10"
                          disabled={resolvingApprovalId !== null}
                          onClick={() =>
                            void handleResolveApproval(
                              approval.id,
                              "denied",
                              approval.toolPath,
                            )
                          }
                        >
                          <ShieldX className="h-3 w-3 mr-1" />
                          {resolving ? "Denying..." : "Deny"}
                        </Button>
                      </div>
                    </div>
                    {input ? (
                      <FormattedCodeBlock
                        content={input.content}
                        language={input.language}
                        className="max-h-40 overflow-y-auto"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <Separator />

        {/* Code */}
        <div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-2">
            Code
          </span>
          <FormattedCodeBlock
            content={liveTask.code}
            language="typescript"
            className="max-h-48 overflow-y-auto"
          />
        </div>

        {/* Result */}
        {liveResult && (
          <div>
            <span className="text-[10px] uppercase tracking-widest text-terminal-green block mb-2">
              Result
            </span>
            <FormattedCodeBlock
              content={liveResult}
              language="json"
              className="max-h-48 overflow-y-auto"
            />
          </div>
        )}

        {/* Error */}
        {liveTask.error && (
          <div>
            <span className="text-[10px] uppercase tracking-widest text-terminal-red block mb-2">
              Error
            </span>
            <FormattedCodeBlock
              content={liveTask.error}
              language="text"
              tone="red"
              className="max-h-48 overflow-y-auto"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tasks View ──

export function TasksView() {
  const { context, loading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"activity" | "runner">("activity");
  const selectedId = searchParams.get("selected");

  const tasks = useQuery(
    convexApi.workspace.listTasks,
    context ? { workspaceId: context.workspaceId, sessionId: context.sessionId } : "skip",
  );
  const tasksLoading = !!context && tasks === undefined;
  const taskItems = tasks ?? [];

  const approvals = useQuery(
    convexApi.workspace.listPendingApprovals,
    context ? { workspaceId: context.workspaceId, sessionId: context.sessionId } : "skip",
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
              {selectedTask ? (
                <TaskDetail
                  task={selectedTask}
                  workspaceId={context!.workspaceId}
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

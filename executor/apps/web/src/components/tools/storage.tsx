"use client";

import { useMemo, useState } from "react";
import { Database, FolderOpen, Plus, Trash2, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { StorageDurability, StorageInstanceRecord, StorageScopeType } from "@/lib/types";
import { cn } from "@/lib/utils";

type CreateStorageArgs = {
  scopeType: StorageScopeType;
  durability: StorageDurability;
  purpose?: string;
  ttlHours?: number;
};

function prettyBytes(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let bytes = value;
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  const precision = bytes >= 100 || index === 0 ? 0 : 1;
  return `${bytes.toFixed(precision)} ${units[index]}`;
}

function asLocalDate(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function StoragePanel({
  instances,
  loading,
  creating,
  busyInstanceId,
  onCreate,
  onClose,
  onDelete,
}: {
  instances: StorageInstanceRecord[];
  loading: boolean;
  creating: boolean;
  busyInstanceId?: string;
  onCreate: (args: CreateStorageArgs) => Promise<void>;
  onClose: (instanceId: string) => Promise<void>;
  onDelete: (instanceId: string) => Promise<void>;
}) {
  const [scopeType, setScopeType] = useState<StorageScopeType>("scratch");
  const [durability, setDurability] = useState<StorageDurability>("ephemeral");
  const [purpose, setPurpose] = useState("");
  const [ttlHours, setTtlHours] = useState("24");

  const visibleInstances = useMemo(
    () => [...instances].sort((a, b) => b.updatedAt - a.updatedAt),
    [instances],
  );

  const submitCreate = async () => {
    const parsedTtl = Number.parseInt(ttlHours, 10);
    await onCreate({
      scopeType,
      durability,
      ...(purpose.trim().length > 0 ? { purpose: purpose.trim() } : {}),
      ...(durability === "ephemeral" && Number.isFinite(parsedTtl) ? { ttlHours: parsedTtl } : {}),
    });
    setPurpose("");
  };

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col rounded-none border border-border/50 bg-card/30">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center border border-border/60 bg-background/80">
            <Database className="h-4 w-4 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-medium">Storage Instances</h2>
        </div>
        <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          {visibleInstances.length}
        </Badge>
      </div>

      <div className="border-b border-border/40 bg-background/40 px-4 py-3 sm:px-5">
        <div className="grid gap-2 md:grid-cols-5">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Scope
            <select
              className="h-8 rounded-none border border-border/60 bg-background px-2 text-xs text-foreground"
              value={scopeType}
              onChange={(event) => {
                const next = event.target.value as StorageScopeType;
                setScopeType(next);
                if (next !== "scratch") {
                  setDurability("durable");
                }
              }}
            >
              <option value="scratch">scratch</option>
              <option value="account">account</option>
              <option value="workspace">workspace</option>
              <option value="organization">organization</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Durability
            <select
              className="h-8 rounded-none border border-border/60 bg-background px-2 text-xs text-foreground"
              value={durability}
              onChange={(event) => setDurability(event.target.value as StorageDurability)}
            >
              <option value="ephemeral">ephemeral</option>
              <option value="durable">durable</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground md:col-span-2">
            Purpose
            <Input
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="scratch for repo indexing"
              className="h-8 rounded-none text-xs"
            />
          </label>

          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
              TTL (hours)
              <Input
                value={ttlHours}
                onChange={(event) => setTtlHours(event.target.value)}
                disabled={durability !== "ephemeral"}
                className="h-8 rounded-none text-xs"
              />
            </label>
            <Button size="sm" className="h-8 rounded-none text-xs" disabled={creating} onClick={() => void submitCreate()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : visibleInstances.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 border border-dashed border-border/50 bg-background/50">
            <div className="flex h-10 w-10 items-center justify-center border border-border/60 bg-muted/40">
              <FolderOpen className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No storage instances yet</p>
            <p className="text-[11px] text-muted-foreground/70 text-center max-w-md">
              Create a scratch instance for short-lived runs or durable instances for shared state.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleInstances.map((instance) => {
              const busy = busyInstanceId === instance.id;
              return (
                <div
                  key={instance.id}
                  className={cn(
                    "group flex items-center gap-3 border border-border/50 bg-background/70 px-3 py-2.5 transition-colors",
                    busy ? "opacity-60" : "hover:border-border hover:bg-accent/20",
                  )}
                  style={{ boxShadow: "inset 2px 0 0 0 color-mix(in oklch, var(--border) 70%, transparent)" }}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border/60 bg-muted/50 overflow-hidden">
                    <Database className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate">{instance.purpose || instance.id}</span>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">{instance.scopeType}</Badge>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">{instance.durability}</Badge>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">{instance.provider}</Badge>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">{instance.status}</Badge>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      {prettyBytes(instance.sizeBytes)} - {instance.fileCount ?? "-"} inode{instance.fileCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Last used {asLocalDate(instance.lastSeenAt)}
                      {instance.expiresAt ? ` - expires ${asLocalDate(instance.expiresAt)}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-none text-[11px]"
                      disabled={busy}
                      onClick={() => void onClose(instance.id)}
                    >
                      <Power className="mr-1 h-3 w-3" />
                      Close
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-none text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={busy}
                      onClick={() => void onDelete(instance.id)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

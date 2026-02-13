import { Loader2 } from "lucide-react";
import { displaySourceName } from "@/lib/tool-source-utils";
import type { ToolSourceRecord } from "@/lib/types";

export function ToolExplorerLoading({ sources }: { sources: ToolSourceRecord[] }) {
  const enabledSources = sources.filter((source) => source.enabled);

  return (
    <div className="space-y-3 rounded-md border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tool inventory...
      </div>

      {enabledSources.length > 0 && (
        <div className="space-y-1">
          {enabledSources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-xs"
            >
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="truncate font-medium">
                {displaySourceName(source.name)}
              </span>
              <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {source.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

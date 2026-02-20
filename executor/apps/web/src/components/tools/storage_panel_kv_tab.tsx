import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { JsonPreview } from "./storage_panel_json_preview";

type StorageKvTabContentProps = {
  canInspect: boolean;
  kvPrefix: string;
  kvLimit: string;
  kvItems: Array<{ key: string; value: unknown }>;
  kvLoading: boolean;
  kvError: string | null;
  expandedKvKey: string | null;
  onKvPrefixChange: (value: string) => void;
  onKvLimitChange: (value: string) => void;
  onRefreshKv: () => Promise<void>;
  onToggleKvKey: (key: string) => void;
};

export function StorageKvTabContent(props: StorageKvTabContentProps) {
  const {
    canInspect,
    kvPrefix,
    kvLimit,
    kvItems,
    kvLoading,
    kvError,
    expandedKvKey,
    onKvPrefixChange,
    onKvLimitChange,
    onRefreshKv,
    onToggleKvKey,
  } = props;

  return (
    <TabsContent value="kv" className="flex-1 min-h-0 overflow-hidden">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2 bg-muted/20">
          <Input
            value={kvPrefix}
            onChange={(event) => onKvPrefixChange(event.target.value)}
            className="h-7 flex-1 rounded-md text-[11px]"
            placeholder="Filter by key prefix..."
          />
          <Input
            value={kvLimit}
            onChange={(event) => onKvLimitChange(event.target.value)}
            className="h-7 w-16 rounded-md text-[11px] text-center"
            placeholder="100"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 rounded-md px-2 text-[10px] text-muted-foreground"
            disabled={kvLoading || !canInspect}
            onClick={() => void onRefreshKv()}
          >
            Refresh
          </Button>
        </div>

        {kvError && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-1.5 text-[11px] text-destructive">
            {kvError}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {kvLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : kvItems.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground/60">No key-value entries</p>
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {kvItems.map((item) => {
                const isExpanded = expandedKvKey === item.key;
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
                      onClick={() => onToggleKvKey(item.key)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 min-w-0 truncate font-mono text-[11px] font-medium text-foreground/90">
                        {item.key}
                      </span>
                      <span className="shrink-0 max-w-[40%] truncate font-mono text-[10px] text-muted-foreground/60">
                        {typeof item.value === "string"
                          ? item.value.length > 60 ? item.value.slice(0, 60) + "..." : item.value
                          : typeof item.value === "object"
                            ? Array.isArray(item.value) ? `Array(${item.value.length})` : "Object"
                            : String(item.value)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/10 bg-muted/20 px-4 py-3 pl-10">
                        <JsonPreview data={item.value} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
}

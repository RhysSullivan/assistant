import { File, Folder, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { joinStoragePath, prettyBytes, type StorageDirectoryEntry } from "./storage_panel_shared";
import { JsonPreview } from "./storage_panel_json_preview";

type StorageFsTabContentProps = {
  canInspect: boolean;
  fsPath: string;
  pathSegments: string[];
  fsEntries: StorageDirectoryEntry[];
  fsLoading: boolean;
  fsError: string | null;
  filePreviewPath: string | null;
  filePreviewContent: string;
  filePreviewBytes: number | null;
  filePreviewLoading: boolean;
  parsedFilePreviewJson: unknown | null;
  onRefreshDirectory: (nextPath?: string) => Promise<void>;
  onReadFilePreview: (path: string) => Promise<void>;
  onCloseFilePreview: () => void;
};

export function StorageFsTabContent(props: StorageFsTabContentProps) {
  const {
    canInspect,
    fsPath,
    pathSegments,
    fsEntries,
    fsLoading,
    fsError,
    filePreviewPath,
    filePreviewContent,
    filePreviewBytes,
    filePreviewLoading,
    parsedFilePreviewJson,
    onRefreshDirectory,
    onReadFilePreview,
    onCloseFilePreview,
  } = props;

  return (
    <TabsContent value="fs" className="flex-1 min-h-0 overflow-hidden">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2 bg-muted/20">
          <div className="flex items-center gap-1 min-w-0 flex-1 text-[11px]">
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => void onRefreshDirectory("/")}
            >
              /
            </button>
            {pathSegments.map((segment, i) => {
              const segmentPath = "/" + pathSegments.slice(0, i + 1).join("/");
              return (
                <span key={segmentPath} className="flex items-center gap-1">
                  <span className="text-muted-foreground/40">/</span>
                  <button
                    type="button"
                    className={cn(
                      "hover:text-foreground transition-colors truncate",
                      i === pathSegments.length - 1 ? "text-foreground font-medium" : "text-muted-foreground",
                    )}
                    onClick={() => void onRefreshDirectory(segmentPath)}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 rounded-md px-2 text-[10px] text-muted-foreground"
            disabled={fsLoading || !canInspect}
            onClick={() => void onRefreshDirectory()}
          >
            Refresh
          </Button>
        </div>

        {fsError && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-1.5 text-[11px] text-destructive">
            {fsError}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {fsLoading ? (
            <div className="p-4 space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-md" />
              ))}
            </div>
          ) : fsEntries.length === 0 && !filePreviewPath ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground/60">Empty directory</p>
            </div>
          ) : (
            <div>
              {fsEntries.length > 0 && (
                <div className="divide-y divide-border/20">
                  {fsPath !== "/" && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/30 transition-colors"
                      onClick={() => {
                        const parent = fsPath.split("/").slice(0, -1).join("/") || "/";
                        void onRefreshDirectory(parent);
                      }}
                    >
                      <Folder className="h-3.5 w-3.5 text-muted-foreground/50" />
                      <span className="text-[11px] text-muted-foreground">..</span>
                    </button>
                  )}
                  {fsEntries.map((entry) => {
                    const nextPath = joinStoragePath(fsPath, entry.name);
                    const isDir = entry.type === "directory";
                    return (
                      <button
                        key={`${entry.type}:${entry.name}`}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                          "hover:bg-accent/30",
                          filePreviewPath === nextPath && "bg-primary/5",
                        )}
                        onClick={() => {
                          if (isDir) {
                            void onRefreshDirectory(nextPath);
                          } else if (entry.type === "file") {
                            void onReadFilePreview(nextPath);
                          }
                        }}
                      >
                        {isDir ? (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-terminal-amber/70" />
                        ) : (
                          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        )}
                        <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-foreground/90">
                          {entry.name}
                        </span>
                        {typeof entry.size === "number" && (
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">{prettyBytes(entry.size)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {filePreviewPath && (
                <div className="border-t border-border/30">
                  <div className="flex items-center justify-between border-b border-border/20 bg-muted/20 px-4 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <File className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[11px] font-medium text-foreground/80">
                        {filePreviewPath.split("/").pop()}
                      </span>
                      {filePreviewBytes !== null && (
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {prettyBytes(filePreviewBytes)}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 shrink-0 rounded p-0 text-muted-foreground hover:text-foreground"
                      onClick={onCloseFilePreview}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="max-h-[60vh] overflow-auto p-4">
                    {filePreviewLoading ? (
                      <div className="space-y-1">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 rounded" style={{ width: `${40 + Math.random() * 50}%` }} />
                        ))}
                      </div>
                    ) : parsedFilePreviewJson !== null ? (
                      <JsonPreview data={parsedFilePreviewJson} />
                    ) : (
                      <pre className="font-mono text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                        {filePreviewContent}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
}

import { JsonView } from "react-json-view-lite";
import { cn } from "@/lib/utils";
import { jsonViewerStyles, shouldExpandJsonNode } from "./storage_panel_shared";

export function JsonPreview({ data, className }: { data: unknown; className?: string }) {
  if (data === null || data === undefined || typeof data !== "object") {
    return <pre className={cn("font-mono text-xs leading-relaxed whitespace-pre-wrap break-words", className)}>{String(data)}</pre>;
  }

  return (
    <div className={cn("json-viewer-root font-mono text-xs", className)}>
      <JsonView data={data as object} style={jsonViewerStyles} shouldExpandNode={shouldExpandJsonNode} />
    </div>
  );
}

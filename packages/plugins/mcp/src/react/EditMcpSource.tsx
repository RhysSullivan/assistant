import { Button } from "@executor/ui/components/button";
import { Badge } from "@executor/ui/components/badge";

// ---------------------------------------------------------------------------
// Edit MCP Source — config view for an existing MCP source
// ---------------------------------------------------------------------------

export default function EditMcpSource({
  sourceId,
  onSave,
}: {
  readonly sourceId: string;
  readonly onSave: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Edit MCP Source</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Manage settings for this MCP connection.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <svg viewBox="0 0 16 16" className="size-4">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">{sourceId}</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          MCP
        </Badge>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div />
        <Button onClick={onSave}>Done</Button>
      </div>
    </div>
  );
}

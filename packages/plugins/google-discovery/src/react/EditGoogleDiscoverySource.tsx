import { Badge } from "@executor/ui/components/badge";
import { Button } from "@executor/ui/components/button";

export default function EditGoogleDiscoverySource({
  sourceId,
  onSave,
}: {
  readonly sourceId: string;
  readonly onSave: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Edit Google Discovery Source
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          This source is managed from its Discovery document and can be refreshed from the source header.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">
            {sourceId}
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          Google Discovery
        </Badge>
      </div>

      <div className="flex items-center justify-end border-t border-border pt-4">
        <Button onClick={onSave}>Done</Button>
      </div>
    </div>
  );
}

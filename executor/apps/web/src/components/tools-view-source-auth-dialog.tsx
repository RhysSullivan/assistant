"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/session-context";
import { convexApi } from "@/lib/convex-api";
import type { SourceAuthProfile, ToolSourceRecord } from "@/lib/types";
import {
  readSourceAuth,
  sourceKeyForSource,
  type SourceAuthMode,
  type SourceAuthType,
} from "@/lib/tools-source-helpers";

export function ConfigureSourceAuthDialog({
  source,
  inferredProfile,
}: {
  source: ToolSourceRecord;
  inferredProfile?: SourceAuthProfile;
}) {
  const { context } = useSession();
  const upsertToolSource = useMutation(convexApi.workspace.upsertToolSource);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentAuth = readSourceAuth(source, inferredProfile);
  const editableInitialAuthType = currentAuth.type === "mixed" ? "bearer" : currentAuth.type;
  const [authType, setAuthType] = useState<Exclude<SourceAuthType, "mixed">>(
    editableInitialAuthType,
  );
  const [authMode, setAuthMode] = useState<SourceAuthMode>(currentAuth.mode ?? "workspace");
  const [apiKeyHeader, setApiKeyHeader] = useState(currentAuth.header ?? "x-api-key");

  const configurable = source.type === "openapi" || source.type === "graphql";

  const resetFromSource = () => {
    const auth = readSourceAuth(source, inferredProfile);
    setAuthType(auth.type === "mixed" ? "bearer" : auth.type);
    setAuthMode(auth.mode ?? "workspace");
    setApiKeyHeader(auth.header ?? "x-api-key");
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      resetFromSource();
    }
  };

  const handleSave = async () => {
    if (!context || !configurable) {
      return;
    }

    setSaving(true);
    try {
      const authConfig: Record<string, unknown> =
        authType === "none"
          ? { type: "none" }
          : authType === "apiKey"
            ? { type: "apiKey", mode: authMode, header: apiKeyHeader.trim() || "x-api-key" }
            : { type: authType, mode: authMode };

      await upsertToolSource({
        id: source.id,
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        name: source.name,
        type: source.type,
        config: {
          ...source.config,
          auth: authConfig,
        },
      });

      toast.success(`Updated auth for ${source.name}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update auth");
    } finally {
      setSaving(false);
    }
  };

  if (!configurable) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <Pencil className="h-3 w-3 mr-1.5" />
          Auth
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Configure Source Auth</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Source</Label>
            <Input value={source.name} readOnly className="h-8 text-xs font-mono bg-background" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auth Type</Label>
            <Select
              value={authType}
              onValueChange={(value) => setAuthType(value as Exclude<SourceAuthType, "mixed">)}
            >
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                <SelectItem value="bearer" className="text-xs">Bearer token</SelectItem>
                <SelectItem value="apiKey" className="text-xs">API key header</SelectItem>
                <SelectItem value="basic" className="text-xs">Basic auth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {currentAuth.inferred && (
            <p className="text-[11px] text-muted-foreground">
              Suggested from spec inference. Save to pin an explicit auth config.
            </p>
          )}

          {authType !== "none" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Credential Scope</Label>
                <Select value={authMode} onValueChange={(value) => setAuthMode(value as SourceAuthMode)}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace" className="text-xs">Workspace</SelectItem>
                    <SelectItem value="actor" className="text-xs">Per-user (actor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {authType === "apiKey" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Header Name</Label>
                  <Input
                    value={apiKeyHeader}
                    onChange={(event) => setApiKeyHeader(event.target.value)}
                    placeholder="x-api-key"
                    className="h-8 text-xs font-mono bg-background"
                  />
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Save this first, then add a connection in the Connections tab using source key
                <code className="ml-1">{sourceKeyForSource(source)}</code>.
              </p>
            </>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full h-9" size="sm">
            {saving ? "Saving..." : "Save Auth"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

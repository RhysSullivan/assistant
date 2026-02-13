"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import { useSession } from "@/lib/session-context";
import { convexApi } from "@/lib/convex-api";
import type {
  CredentialRecord,
  CredentialScope,
  SourceAuthProfile,
  ToolSourceRecord,
} from "@/lib/types";
import {
  connectionDisplayName,
  parseHeaderOverrides,
} from "@/lib/credentials-source-helpers";
import { ConnectionAuthFields } from "./connection-auth-fields";
import { type ConnectionMode } from "./connection-form-dialog-state";
import { useConnectionFormDialogForm } from "./connection-form-dialog-form";
import {
  buildSecretJson,
  connectionSubmitCopy,
  connectionSuccessCopy,
} from "./connection-form-save";

export function ConnectionFormDialog({
  open,
  onOpenChange,
  editing,
  initialSourceKey,
  sources,
  credentials,
  sourceAuthProfiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CredentialRecord | null;
  initialSourceKey?: string | null;
  sources: ToolSourceRecord[];
  credentials: CredentialRecord[];
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
}) {
  const { context, clientConfig } = useSession();
  const upsertCredential = useAction(convexApi.credentialsNode.upsertCredential);
  const [saving, setSaving] = useState(false);
  const {
    sourceKey,
    scope,
    actorId,
    connectionMode,
    existingConnectionId,
    tokenValue,
    apiKeyValue,
    basicUsername,
    basicPassword,
    customHeadersText,
    sourceOptions,
    connectionOptions,
    compatibleConnectionOptions,
    selectedAuth,
    authBadge,
    setScope,
    setActorId,
    setConnectionMode,
    setExistingConnectionId,
    setTokenValue,
    setApiKeyValue,
    setBasicUsername,
    setBasicPassword,
    setCustomHeadersText,
    handleSourceKeyChange,
  } = useConnectionFormDialogForm({
    open,
    editing,
    initialSourceKey,
    sources,
    credentials,
    sourceAuthProfiles,
    actorIdFallback: context?.actorId,
  });

  const storageCopy = clientConfig?.authProviderMode === "workos"
    ? "Stored encrypted"
    : "Stored locally on this machine";

  const handleSave = async () => {
    if (!context) {
      return;
    }
    if (!sourceKey.trim()) {
      toast.error("Source key is required");
      return;
    }
    if (scope === "actor" && !actorId.trim()) {
      toast.error("Actor ID is required for actor-scoped credentials");
      return;
    }

    const parsedHeaders = parseHeaderOverrides(customHeadersText);
    if (!parsedHeaders.value) {
      toast.error(parsedHeaders.error ?? "Invalid header overrides");
      return;
    }

    const linkExisting = !editing && connectionMode === "existing";
    if (linkExisting && !existingConnectionId) {
      toast.error("Select an existing connection to link");
      return;
    }
    if (linkExisting && !compatibleConnectionOptions.some((connection) => connection.id === existingConnectionId)) {
      toast.error("Selected connection does not match this scope");
      return;
    }

    if (selectedAuth.type === "none") {
      toast.error("This source does not require auth");
      return;
    }

    if (selectedAuth.type === "mixed" && !linkExisting && !editing) {
      toast.error("Mixed-auth sources must link to an existing connection");
      return;
    }

    const secretResult = buildSecretJson({
      selectedAuthType: selectedAuth.type,
      linkExisting,
      editing: Boolean(editing),
      basicUsername,
      basicPassword,
      apiKeyValue,
      tokenValue,
      parsedHeaders: parsedHeaders.value,
    });

    if (!secretResult.secretJson) {
      toast.error(secretResult.error ?? "Failed to prepare secret payload");
      return;
    }

    setSaving(true);
    try {
      await upsertCredential({
        ...(editing ? { id: editing.id } : linkExisting ? { id: existingConnectionId } : {}),
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        sourceKey: sourceKey.trim(),
        scope,
        ...(scope === "actor" ? { actorId: actorId.trim() } : {}),
        secretJson: secretResult.secretJson,
      });

      toast.success(connectionSuccessCopy(Boolean(editing), linkExisting));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {editing ? "Edit Connection" : "Add Connection"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Source</Label>
            {sourceOptions.length > 0 ? (
              <Select value={sourceKey} onValueChange={handleSourceKeyChange}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key} className="text-xs">
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={sourceKey}
                onChange={(e) => handleSourceKeyChange(e.target.value)}
                placeholder="source:<source-id>"
                className="h-8 text-xs font-mono bg-background"
              />
            )}
            {sourceKey && (
              <p className="text-[10px] text-muted-foreground font-mono">key: {sourceKey}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">Detected auth</span>
            <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
              {authBadge}
            </Badge>
            {selectedAuth.inferred && (
              <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
                inferred
              </Badge>
            )}
            {selectedAuth.type === "apiKey" && selectedAuth.header && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                header: {selectedAuth.header}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Scope</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as CredentialScope)}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace" className="text-xs">Workspace</SelectItem>
                  <SelectItem value="actor" className="text-xs">Per-user (actor)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Storage</Label>
              <Input value={storageCopy} readOnly className="h-8 text-xs bg-background" />
            </div>
          </div>

          {scope === "actor" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Actor ID</Label>
              <Input
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder="actor_123"
                className="h-8 text-xs font-mono bg-background"
              />
            </div>
          )}

          {!editing && connectionOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Connection Mode</Label>
              <Select value={connectionMode} onValueChange={(value) => setConnectionMode(value as ConnectionMode)}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new" className="text-xs">Create new connection</SelectItem>
                  <SelectItem value="existing" className="text-xs">Use existing connection</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!editing && connectionMode === "existing" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Existing Connection</Label>
              <Select value={existingConnectionId} onValueChange={setExistingConnectionId}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Select a connection" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleConnectionOptions.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id} className="text-xs">
                      {connectionDisplayName(sources, connection)} ({connection.sourceKeys.size} source{connection.sourceKeys.size === 1 ? "" : "s"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compatibleConnectionOptions.length === 0 && (
                <p className="text-[10px] text-muted-foreground">No compatible existing connections for this scope.</p>
              )}
            </div>
          )}

          <ConnectionAuthFields
            editing={Boolean(editing)}
            connectionMode={connectionMode}
            selectedAuth={selectedAuth}
            tokenValue={tokenValue}
            apiKeyValue={apiKeyValue}
            basicUsername={basicUsername}
            basicPassword={basicPassword}
            onTokenValueChange={setTokenValue}
            onApiKeyValueChange={setApiKeyValue}
            onBasicUsernameChange={setBasicUsername}
            onBasicPasswordChange={setBasicPassword}
          />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Custom Headers (optional)</Label>
            <Textarea
              value={customHeadersText}
              onChange={(e) => setCustomHeadersText(e.target.value)}
              rows={4}
              placeholder="x-tenant-id: acme\nx-env: staging"
              className="text-xs font-mono bg-background"
            />
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full h-9" size="sm">
            {connectionSubmitCopy(Boolean(editing), saving, connectionMode)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

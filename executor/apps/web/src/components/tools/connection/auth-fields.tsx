"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SourceAuthType } from "@/lib/types";
import type { ConnectionMode } from "./form/dialog-state";

type SelectedAuth = {
  type: SourceAuthType;
};

type ConnectionAuthFieldsProps = {
  editing: boolean;
  connectionMode: ConnectionMode;
  selectedAuth: SelectedAuth;
  tokenValue: string;
  apiKeyValue: string;
  basicUsername: string;
  basicPassword: string;
  onTokenValueChange: (value: string) => void;
  onApiKeyValueChange: (value: string) => void;
  onBasicUsernameChange: (value: string) => void;
  onBasicPasswordChange: (value: string) => void;
};

export function ConnectionAuthFields({
  editing,
  connectionMode,
  selectedAuth,
  tokenValue,
  apiKeyValue,
  basicUsername,
  basicPassword,
  onTokenValueChange,
  onApiKeyValueChange,
  onBasicUsernameChange,
  onBasicPasswordChange,
}: ConnectionAuthFieldsProps) {
  if (!editing && connectionMode !== "new") {
    return null;
  }

  return (
    <>
      {editing && (
        <p className="text-[11px] text-muted-foreground">
          Existing secret values are hidden. Enter new values to rotate credentials, or leave blank to keep them.
        </p>
      )}

      {selectedAuth.type === "none" ? (
        <p className="text-[11px] text-terminal-amber">This source does not currently require auth.</p>
      ) : selectedAuth.type === "mixed" ? (
        <p className="text-[11px] text-terminal-amber">
          This API uses multiple auth schemes. Reuse compatible saved credentials for now.
        </p>
      ) : selectedAuth.type === "apiKey" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">API Key Value</Label>
          <Input
            value={apiKeyValue}
            onChange={(e) => onApiKeyValueChange(e.target.value)}
            placeholder="sk_live_..."
            className="h-8 text-xs font-mono bg-background"
          />
        </div>
      ) : selectedAuth.type === "basic" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input
              value={basicUsername}
              onChange={(e) => onBasicUsernameChange(e.target.value)}
              className="h-8 text-xs font-mono bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={basicPassword}
              onChange={(e) => onBasicPasswordChange(e.target.value)}
              className="h-8 text-xs font-mono bg-background"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Bearer Token</Label>
          <Input
            type="password"
            value={tokenValue}
            onChange={(e) => onTokenValueChange(e.target.value)}
            placeholder="ghp_..."
            className="h-8 text-xs font-mono bg-background"
          />
        </div>
      )}
    </>
  );
}

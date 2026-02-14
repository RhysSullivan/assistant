import { KeyRound, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InferredSpecAuth } from "@/lib/openapi-spec-inspector";
import type { CredentialScope, SourceAuthType } from "@/lib/types";
import type { SourceType } from "./add-source-dialog-helpers";

export type SourceAuthPanelEditableField =
  | "apiKeyHeader"
  | "tokenValue"
  | "apiKeyValue"
  | "basicUsername"
  | "basicPassword";

export type SourceAuthPanelModel = {
  sourceType: SourceType;
  specStatus: "idle" | "detecting" | "ready" | "error";
  inferredSpecAuth: InferredSpecAuth | null;
  specError: string;
  authType: Exclude<SourceAuthType, "mixed">;
  authScope: CredentialScope;
  apiKeyHeader: string;
  tokenValue: string;
  apiKeyValue: string;
  basicUsername: string;
  basicPassword: string;
  hasExistingCredential: boolean;
};

function inferredAuthBadge(inferredSpecAuth: InferredSpecAuth | null): string | null {
  if (!inferredSpecAuth) {
    return null;
  }
  if (inferredSpecAuth.type === "mixed") {
    return "Mixed auth";
  }
  if (inferredSpecAuth.type === "apiKey") {
    return `API key${inferredSpecAuth.header ? ` (${inferredSpecAuth.header})` : ""}`;
  }
  if (inferredSpecAuth.type === "basic") {
    return "Basic";
  }
  if (inferredSpecAuth.type === "bearer") {
    return "Bearer";
  }
  return "No auth";
}

export function SourceAuthPanel({
  model,
  onAuthTypeChange,
  onAuthScopeChange,
  onFieldChange,
}: {
  model: SourceAuthPanelModel;
  onAuthTypeChange: (value: Exclude<SourceAuthType, "mixed">) => void;
  onAuthScopeChange: (value: CredentialScope) => void;
  onFieldChange: (field: SourceAuthPanelEditableField, value: string) => void;
}) {
  const {
    sourceType,
    specStatus,
    inferredSpecAuth,
    specError,
    authType,
    authScope,
    apiKeyHeader,
    tokenValue,
    apiKeyValue,
    basicUsername,
    basicPassword,
    hasExistingCredential,
  } = model;

  if (sourceType !== "openapi" && sourceType !== "graphql") {
    return null;
  }

  const badge = inferredAuthBadge(inferredSpecAuth);
  const scopeHint = authScope === "workspace" ? "Shared with workspace" : "Private to your user";

  return (
    <div className="rounded-xl border border-border/70 bg-gradient-to-br from-muted/60 via-muted/30 to-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Authentication
          </div>
          <p className="text-[11px] text-muted-foreground">
            Configure runtime and spec access credentials together.
          </p>
        </div>
        {sourceType === "openapi" ? (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {specStatus === "detecting"
              ? "Inspecting"
              : specStatus === "ready"
                ? "Schema ready"
                : specStatus === "error"
                  ? "Schema error"
                  : "Awaiting URL"}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            GraphQL
          </Badge>
        )}
      </div>

      {sourceType === "openapi" ? (
        <div className="flex items-center gap-2 flex-wrap">
          {badge ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {badge}
            </Badge>
          ) : null}
          {specError ? <span className="text-[10px] text-terminal-amber">{specError}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Auth Type</Label>
          <Select value={authType} onValueChange={(value) => onAuthTypeChange(value as Exclude<SourceAuthType, "mixed">)}>
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

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Scope</Label>
          <Select
            value={authScope}
            onValueChange={(value) => onAuthScopeChange(value as CredentialScope)}
            disabled={authType === "none"}
          >
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspace" className="text-xs">Workspace</SelectItem>
              <SelectItem value="actor" className="text-xs">Only me</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">{scopeHint}</p>
        </div>
      </div>

      {authType === "apiKey" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">API Key Header</Label>
          <Input
            value={apiKeyHeader}
            onChange={(event) => onFieldChange("apiKeyHeader", event.target.value)}
            placeholder="x-api-key"
            className="h-8 text-xs font-mono bg-background"
          />
        </div>
      ) : null}

      {authType === "bearer" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <LockKeyhole className="h-3 w-3" />
            Bearer Token
          </Label>
          <Input
            type="password"
            value={tokenValue}
            onChange={(event) => onFieldChange("tokenValue", event.target.value)}
            placeholder={hasExistingCredential ? "Leave blank to keep saved token" : "tok_..."}
            className="h-8 text-xs font-mono bg-background"
          />
        </div>
      ) : null}

      {authType === "apiKey" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" />
            API Key Value
          </Label>
          <Input
            type="password"
            value={apiKeyValue}
            onChange={(event) => onFieldChange("apiKeyValue", event.target.value)}
            placeholder={hasExistingCredential ? "Leave blank to keep saved key" : "sk_live_..."}
            className="h-8 text-xs font-mono bg-background"
          />
        </div>
      ) : null}

      {authType === "basic" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <UserRound className="h-3 w-3" />
              Username
            </Label>
            <Input
              value={basicUsername}
              onChange={(event) => onFieldChange("basicUsername", event.target.value)}
              placeholder={hasExistingCredential ? "Leave blank to keep saved value" : "username"}
              className="h-8 text-xs font-mono bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={basicPassword}
              onChange={(event) => onFieldChange("basicPassword", event.target.value)}
              placeholder={hasExistingCredential ? "Leave blank to keep saved value" : "password"}
              className="h-8 text-xs font-mono bg-background"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

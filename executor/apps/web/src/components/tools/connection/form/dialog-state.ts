import type {
  CredentialRecord,
  CredentialScope,
  OwnerScopeType,
  SourceAuthType,
  ToolSourceRecord,
} from "@/lib/types";
import {
  sourceOptionLabel,
  type SourceOption,
} from "@/lib/credentials/source-helpers";
import { sourceKeyForSource } from "@/lib/tools/source-helpers";

export type ConnectionMode = "new" | "existing";

export type ConnectionOption = {
  key: string;
  id: string;
  ownerScopeType: OwnerScopeType;
  scope: CredentialScope;
  accountId?: string;
  sourceKeys: Set<string>;
  updatedAt: number;
};

export function buildSourceOptions(sources: ToolSourceRecord[]): SourceOption[] {
  return sources
    .map((source) => {
      const key = sourceKeyForSource(source);
      return {
        source,
        key,
        label: sourceOptionLabel(source),
      };
    })
    .filter((entry): entry is SourceOption => entry.key !== null);
}

export function buildConnectionOptions(credentials: CredentialRecord[]): ConnectionOption[] {
  const grouped = new Map<string, ConnectionOption>();

  for (const credential of credentials) {
    const ownerScopeType = credential.ownerScopeType ?? "workspace";
    const groupKey = `${ownerScopeType}:${credential.id}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.sourceKeys.add(credential.sourceKey);
      existing.updatedAt = Math.max(existing.updatedAt, credential.updatedAt);
    } else {
        grouped.set(groupKey, {
          key: groupKey,
          id: credential.id,
          ownerScopeType,
          scope: credential.scopeType,
          accountId: credential.accountId,
          sourceKeys: new Set([credential.sourceKey]),
          updatedAt: credential.updatedAt,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function compatibleConnections(
  options: ConnectionOption[],
  ownerScopeType: OwnerScopeType,
  scope: CredentialScope,
  accountId: string,
): ConnectionOption[] {
  return options.filter((connection) => {
    if (connection.ownerScopeType !== ownerScopeType) {
      return false;
    }
    if (connection.scope !== scope) {
      return false;
    }
    if (scope === "account") {
      return connection.accountId === accountId.trim();
    }
    return true;
  });
}

export function selectedAuthBadge(type: SourceAuthType, mode?: CredentialScope): string {
  if (type === "none") {
    return "No auth";
  }
  if (type === "mixed") {
    return "Mixed auth";
  }
  const authLabel =
    type === "apiKey"
      ? "API key"
      : type === "basic"
        ? "Basic"
        : "Bearer";
  return `${authLabel} (${mode === "account" ? "per-user" : "workspace"})`;
}

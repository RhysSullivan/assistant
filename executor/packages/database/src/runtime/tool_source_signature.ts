/** Cache version - bump when registry build/type-hint semantics change. */
const TOOL_SOURCE_CACHE_VERSION = "v26";

export function sourceSignature(
  workspaceId: string,
  sources: Array<{
    id: string;
    type?: string;
    scopeType?: string;
    organizationId?: string;
    workspaceId?: string;
    specHash?: string;
    authFingerprint?: string;
    updatedAt: number;
    enabled: boolean;
  }>,
): string {
  const parts = sources
    .map((source) => {
      const type = source.type ?? "unknown";
      const scopeType = source.scopeType ?? "workspace";
      const org = source.organizationId ?? "";
      const ws = source.workspaceId ?? "";
      const specHash = source.specHash ?? "";
      const authFingerprint = source.authFingerprint ?? "";
      const enabled = source.enabled ? 1 : 0;
      return `${source.id}:${type}:${scopeType}:${org}:${ws}:${specHash}:${authFingerprint}:${source.updatedAt}:${enabled}`;
    })
    .sort();
  return `${TOOL_SOURCE_CACHE_VERSION}|${workspaceId}|${parts.join(",")}`;
}

import type { OpenApiAuth } from "../../../core/src/tool/source-types";
import type { ToolApprovalMode } from "../../../core/src/types";
import { asRecord } from "../lib/object";

type ToolSourceType = "mcp" | "openapi" | "graphql";

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredTrimmedString(value: unknown, fieldName: string): string {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) {
    throw new Error(`Tool source ${fieldName} is required`);
  }
  return trimmed;
}

function normalizeStringMap(value: unknown, fieldName: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (typeof rawValue !== "string") {
      throw new Error(`Tool source ${fieldName}.${normalizedKey} must be a string`);
    }
    normalized[normalizedKey] = rawValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeApprovalMode(value: unknown, fieldName: string): ToolApprovalMode | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "required") {
    return value;
  }
  throw new Error(`Tool source ${fieldName} must be 'auto' or 'required'`);
}

function normalizeOverrides(value: unknown, fieldName: string): Record<string, { approval?: ToolApprovalMode }> | undefined {
  if (value === undefined) return undefined;
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) {
    return undefined;
  }

  const normalized: Record<string, { approval?: ToolApprovalMode }> = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.trim();
    if (!key) continue;
    const entry = asRecord(rawValue);
    const approval = normalizeApprovalMode(entry.approval, `${fieldName}.${key}.approval`);
    normalized[key] = approval ? { approval } : {};
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAuthMode(value: unknown): "static" | "workspace" | "actor" | undefined {
  if (value === undefined) return undefined;
  if (value === "static" || value === "workspace" || value === "actor") {
    return value;
  }
  throw new Error("Tool source auth.mode must be 'static', 'workspace', or 'actor'");
}

function normalizeAuth(value: unknown): OpenApiAuth | undefined {
  if (value === undefined) return undefined;

  const auth = asRecord(value);
  const authType = optionalTrimmedString(auth.type);
  if (!authType) {
    throw new Error("Tool source auth.type is required when auth is provided");
  }

  if (authType === "none") {
    return { type: "none" };
  }

  if (authType === "basic") {
    return {
      type: "basic",
      mode: normalizeAuthMode(auth.mode),
      username: optionalTrimmedString(auth.username),
      password: optionalTrimmedString(auth.password),
    };
  }

  if (authType === "bearer") {
    return {
      type: "bearer",
      mode: normalizeAuthMode(auth.mode),
      token: optionalTrimmedString(auth.token),
    };
  }

  if (authType === "apiKey") {
    const header = requiredTrimmedString(auth.header, "auth.header");
    return {
      type: "apiKey",
      mode: normalizeAuthMode(auth.mode),
      header,
      value: optionalTrimmedString(auth.value),
    };
  }

  throw new Error(`Unsupported tool source auth.type '${authType}'`);
}

function normalizeSpec(value: unknown): string | Record<string, unknown> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Tool source spec is required");
    }
    return trimmed;
  }

  const specObject = asRecord(value);
  if (Object.keys(specObject).length === 0) {
    throw new Error("Tool source spec must be a non-empty string or object");
  }
  return specObject;
}

export function normalizeToolSourceConfig(type: ToolSourceType, rawConfig: unknown): Record<string, unknown> {
  const config = asRecord(rawConfig);

  if (type === "mcp") {
    const url = requiredTrimmedString(config.url, "url");
    const transport = config.transport;
    if (transport !== undefined && transport !== "sse" && transport !== "streamable-http") {
      throw new Error("Tool source transport must be 'sse' or 'streamable-http'");
    }

    return {
      url,
      transport,
      auth: normalizeAuth(config.auth),
      queryParams: normalizeStringMap(config.queryParams, "queryParams"),
      discoveryHeaders: normalizeStringMap(config.discoveryHeaders, "discoveryHeaders"),
      defaultApproval: normalizeApprovalMode(config.defaultApproval, "defaultApproval"),
      overrides: normalizeOverrides(config.overrides, "overrides"),
    };
  }

  if (type === "graphql") {
    const endpoint = requiredTrimmedString(config.endpoint, "endpoint");

    return {
      endpoint,
      schema: Object.keys(asRecord(config.schema)).length > 0 ? asRecord(config.schema) : undefined,
      auth: normalizeAuth(config.auth),
      defaultQueryApproval: normalizeApprovalMode(config.defaultQueryApproval, "defaultQueryApproval"),
      defaultMutationApproval: normalizeApprovalMode(config.defaultMutationApproval, "defaultMutationApproval"),
      overrides: normalizeOverrides(config.overrides, "overrides"),
    };
  }

  return {
    spec: normalizeSpec(config.spec),
    collectionUrl: optionalTrimmedString(config.collectionUrl),
    postmanProxyUrl: optionalTrimmedString(config.postmanProxyUrl),
    baseUrl: optionalTrimmedString(config.baseUrl),
    auth: normalizeAuth(config.auth),
    defaultReadApproval: normalizeApprovalMode(config.defaultReadApproval, "defaultReadApproval"),
    defaultWriteApproval: normalizeApprovalMode(config.defaultWriteApproval, "defaultWriteApproval"),
    overrides: normalizeOverrides(config.overrides, "overrides"),
  };
}

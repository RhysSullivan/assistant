import type { OpenApiAuth } from "./source-types";
import type { ToolCredentialSpec } from "../types";
import { z } from "zod";

export type CredentialHeaderAuthSpec = {
  authType: "bearer" | "apiKey" | "basic";
  headerName?: string;
};

const secretRecordSchema = z.record(z.unknown());
const credentialOverrideHeadersSchema = z.object({
  headers: z.record(z.coerce.string()).optional(),
});

function toRecord(value: unknown): Record<string, unknown> {
  const parsed = secretRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function getTrimmedString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readSecretValue(record: Record<string, unknown>, aliases: string[]): string {
  const entries = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    entries.set(key.toLowerCase(), value);
  }

  for (const alias of aliases) {
    const value = entries.get(alias.toLowerCase());
    const trimmed = getTrimmedString(value);
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
}

export function buildCredentialAuthHeaders(
  auth: CredentialHeaderAuthSpec,
  secret: unknown,
): Record<string, string> {
  const payload = toRecord(secret);

  if (auth.authType === "bearer") {
    const token = readSecretValue(payload, ["token", "accessToken", "bearerToken", "value"]);
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  if (auth.authType === "apiKey") {
    const discoveredHeader = readSecretValue(payload, ["headerName", "header", "keyName"]);
    const headerName = (auth.headerName ?? discoveredHeader) || "x-api-key";
    const value = readSecretValue(payload, ["value", "token", "apiKey", "key", "accessToken"]);
    return value ? { [headerName]: value } : {};
  }

  const username = readSecretValue(payload, ["username", "user"]);
  const password = readSecretValue(payload, ["password", "pass"]);
  if (!username && !password) {
    return {};
  }

  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return { authorization: `Basic ${encoded}` };
}

export function readCredentialOverrideHeaders(value: unknown): Record<string, string> {
  const parsed = credentialOverrideHeadersSchema.safeParse(value);
  const rawHeaders = parsed.success ? (parsed.data.headers ?? {}) : {};

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(rawHeaders)) {
    const key = rawKey.trim();
    if (!key) continue;
    normalized[key] = rawValue;
  }

  return normalized;
}

export function buildStaticAuthHeaders(auth?: OpenApiAuth): Record<string, string> {
  if (!auth || auth.type === "none") return {};
  const mode = auth.mode ?? "static";
  if (mode !== "static") return {};

  if (auth.type === "basic") {
    const username = auth.username ?? "";
    const password = auth.password ?? "";
    if (!username && !password) return {};
    const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return { authorization: `Basic ${encoded}` };
  }

  if (auth.type === "bearer") {
    if (!auth.token) return {};
    return { authorization: `Bearer ${auth.token}` };
  }

  if (!auth.value) return {};
  return { [auth.header]: auth.value };
}

export function buildCredentialSpec(sourceKey: string, auth?: OpenApiAuth): ToolCredentialSpec | undefined {
  if (!auth || auth.type === "none") return undefined;
  const mode = auth.mode ?? "static";
  if (mode === "static") return undefined;

  if (auth.type === "bearer") {
    return {
      sourceKey,
      mode,
      authType: "bearer",
    };
  }

  if (auth.type === "basic") {
    return {
      sourceKey,
      mode,
      authType: "basic",
    };
  }

  return {
    sourceKey,
    mode,
    authType: "apiKey",
    headerName: auth.header,
  };
}

export function getCredentialSourceKey(config: {
  type: "mcp" | "openapi" | "graphql";
  name: string;
  sourceKey?: string;
}): string {
  return config.sourceKey ?? `${config.type}:${config.name}`;
}

import { Result } from "better-result";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SourceAuthType } from "@/lib/types";

type SupportedAuthType = Exclude<SourceAuthType, "none" | "mixed">;

type OpenApiInspectionResult = {
  spec: Record<string, unknown>;
  inferredAuth: InferredSpecAuth;
};

export type InferredSpecAuth = {
  type: "none" | "bearer" | "apiKey" | "basic" | "mixed";
  mode?: "workspace" | "account" | "organization";
  header?: string;
  inferred: true;
};

const generatedPreparedInferredAuthSchema = z.object({
  type: z.enum(["none", "bearer", "apiKey", "basic", "mixed"]),
  mode: z.enum(["workspace", "account", "organization"]).optional(),
  header: z.string().optional(),
}).optional();

const generatedPreparedSpecSchema = z.object({
  servers: z.array(z.string()).optional(),
  inferredAuth: generatedPreparedInferredAuthSchema,
});

const generatedResponseSchema = z.object({
  status: z.enum(["ready", "failed"]).optional(),
  prepared: z.unknown().optional(),
  error: z.string().optional(),
});

const recordSchema = z.record(z.string(), z.unknown());

const securityRequirementSchema = z.record(z.string(), z.array(z.unknown()).optional());

const securitySchemeSchema = z.object({
  type: z.string().optional(),
  scheme: z.string().optional(),
  in: z.string().optional(),
  name: z.string().optional(),
});

function toRecordValue(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function parseObjectFromText(text: string, format: "json" | "yaml"): Record<string, unknown> | null {
  const parsed = format === "json"
    ? Result.try(() => JSON.parse(text))
    : Result.try(() => parseYaml(text));
  if (parsed.isErr()) {
    return null;
  }

  const parsedRecord = recordSchema.safeParse(parsed.value);
  if (!parsedRecord.success || Object.keys(parsedRecord.data).length === 0) {
    return null;
  }

  return parsedRecord.data;
}

function parseOpenApiPayload(raw: string, sourceUrl: string, contentType: string): Record<string, unknown> {
  const loweredContentType = contentType.toLowerCase();
  const loweredUrl = sourceUrl.toLowerCase();
  const preferJson = loweredContentType.includes("json") || loweredUrl.endsWith(".json");

  const primary = preferJson
    ? parseObjectFromText(raw, "json")
    : parseObjectFromText(raw, "yaml");
  const fallback = preferJson
    ? parseObjectFromText(raw, "yaml")
    : parseObjectFromText(raw, "json");
  const parsed = primary ?? fallback;

  if (!parsed) {
    throw new Error("Spec payload is empty or not an object");
  }

  return parsed;
}

function formatStatus(status?: number, statusText?: string): string {
  if (typeof status !== "number" || status <= 0) {
    return "request failed";
  }
  const normalizedStatusText = typeof statusText === "string" ? statusText.trim() : "";
  return normalizedStatusText ? `${status} ${normalizedStatusText}` : String(status);
}

export function createSpecFetchErrorMessage(input: {
  status?: number;
  statusText?: string;
  detail?: string;
}): string {
  const statusLabel = formatStatus(input.status, input.statusText);
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  if (!detail) {
    return `Failed to fetch spec (${statusLabel})`;
  }
  return `Failed to fetch spec (${statusLabel}): ${detail}`;
}

export function inspectOpenApiPayload(input: {
  raw: string;
  sourceUrl: string;
  contentType?: string;
}): OpenApiInspectionResult {
  if (!input.raw.trim()) {
    throw new Error("Spec response was empty");
  }

  const spec = parseOpenApiPayload(input.raw, input.sourceUrl, input.contentType ?? "");
  const inferredAuth = inferSecuritySchemaAuth(spec);
  return { spec, inferredAuth };
}

function normalizeAuthScheme(scheme: unknown): {
  type: SupportedAuthType;
  header?: string;
} | null {
  const parsedScheme = securitySchemeSchema.safeParse(scheme);
  if (!parsedScheme.success) {
    return null;
  }

  const type = (parsedScheme.data.type ?? "").toLowerCase();

  if (type === "http") {
    const httpScheme = (parsedScheme.data.scheme ?? "").toLowerCase();
    if (httpScheme === "bearer") {
      return { type: "bearer" };
    }
    if (httpScheme === "basic") {
      return { type: "basic" };
    }
    return null;
  }

  if (type === "apikey") {
    const location = (parsedScheme.data.in ?? "").toLowerCase();
    const header = (parsedScheme.data.name ?? "").trim();
    if (location === "header" && header.length > 0) {
      return { type: "apiKey", header };
    }
    return null;
  }

  if (type === "oauth2" || type === "openidconnect") {
    return { type: "bearer" };
  }

  return null;
}

function inferSecuritySchemaAuth(spec: Record<string, unknown>): InferredSpecAuth {
  const components = toRecordValue(spec.components);
  const securitySchemes = toRecordValue(components.securitySchemes);
  const schemeNames = Object.keys(securitySchemes);
  if (schemeNames.length === 0) {
    return { type: "none", inferred: true };
  }

  const globalSecurity = Array.isArray(spec.security)
    ? spec.security.flatMap((entry) => {
      const parsed = securityRequirementSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    : [];
  const referencedSchemeNames = globalSecurity.flatMap((entry) => Object.keys(entry));
  const securitySchemeNames = new Set(schemeNames);
  const candidateNames = referencedSchemeNames.length > 0
    ? [...new Set(referencedSchemeNames.filter((name) => securitySchemeNames.has(name)))]
    : schemeNames;

  const normalized = candidateNames
    .map((name) => normalizeAuthScheme(securitySchemes[name]))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (normalized.length === 0) {
    return { type: "none", inferred: true };
  }

  const deduped = new Map<string, { type: SupportedAuthType; header?: string }>();
  for (const entry of normalized) {
    const key = entry.type === "apiKey" ? `${entry.type}:${entry.header ?? ""}` : entry.type;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  if (deduped.size > 1) {
    return { type: "mixed", inferred: true };
  }

  const selected = [...deduped.values()][0];
  return {
    type: selected.type,
    mode: "workspace",
    ...(selected.type === "apiKey" && selected.header ? { header: selected.header } : {}),
    inferred: true,
  };
}

export async function fetchAndInspectOpenApiSpec(input: {
  specUrl: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<OpenApiInspectionResult> {
  const hasHeaders = Object.keys(input.headers ?? {}).length > 0;
  const params = new URLSearchParams({
    specUrl: input.specUrl,
    sourceName: "openapi-inspect",
    includeDts: "0",
    profile: "inventory",
  });

  if (hasHeaders) {
    params.set("headers", JSON.stringify(input.headers ?? {}));
  }

  const response = await fetch(`/api/generate?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal: input.signal,
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const generatedPayload = generatedResponseSchema.safeParse(payload);
    const detail = generatedPayload.success
      ? (generatedPayload.data.error ?? "")
      : "";
    throw new Error(createSpecFetchErrorMessage({ status: response.status, statusText: response.statusText, detail }));
  }

  const generatedPayload = generatedResponseSchema.safeParse(payload);
  if (!generatedPayload.success || generatedPayload.data.status === "failed") {
    throw new Error("Spec generation returned an invalid response");
  }

  const preparedParsed = generatedPreparedSpecSchema.safeParse(generatedPayload.data.prepared);
  if (!preparedParsed.success) {
    throw new Error("Spec generation did not return a valid prepared document");
  }

  const servers = (preparedParsed.data.servers ?? [])
    .filter((server): server is string => typeof server === "string" && server.trim().length > 0)
    .map((url) => ({ url }));

  const generatedInferredAuth = preparedParsed.data.inferredAuth;
  const inferredAuth: InferredSpecAuth = generatedInferredAuth
    ? {
      type: generatedInferredAuth.type,
      ...(generatedInferredAuth.mode ? { mode: generatedInferredAuth.mode } : {}),
      ...(generatedInferredAuth.type === "apiKey" && generatedInferredAuth.header
        ? { header: generatedInferredAuth.header }
        : {}),
      inferred: true,
    }
    : { type: "none", inferred: true };

  return {
    spec: { servers },
    inferredAuth,
  };
}

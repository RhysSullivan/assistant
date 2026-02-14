import { parse as parseYaml } from "yaml";
import type { CredentialScope, SourceAuthType } from "@/lib/types";

type SupportedAuthType = Exclude<SourceAuthType, "none" | "mixed">;

export type InferredSpecAuth = {
  type: SourceAuthType;
  mode?: CredentialScope;
  header?: string;
  inferred: true;
};

type OpenApiInspectionResult = {
  spec: Record<string, unknown>;
  inferredAuth: InferredSpecAuth;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseOpenApiPayload(raw: string, sourceUrl: string, contentType: string): Record<string, unknown> {
  const loweredContentType = contentType.toLowerCase();
  const loweredUrl = sourceUrl.toLowerCase();
  const preferJson = loweredContentType.includes("json") || loweredUrl.endsWith(".json");

  const tryJson = () => asRecord(JSON.parse(raw));
  const tryYaml = () => asRecord(parseYaml(raw));

  const parsed = preferJson
    ? (() => {
        try {
          return tryJson();
        } catch {
          return tryYaml();
        }
      })()
    : (() => {
        try {
          return tryYaml();
        } catch {
          return tryJson();
        }
      })();

  if (Object.keys(parsed).length === 0) {
    throw new Error("Spec payload is empty or not an object");
  }

  return parsed;
}

function normalizeAuthScheme(scheme: Record<string, unknown>): {
  type: SupportedAuthType;
  header?: string;
} | null {
  const type = String(scheme.type ?? "").toLowerCase();

  if (type === "http") {
    const httpScheme = String(scheme.scheme ?? "").toLowerCase();
    if (httpScheme === "bearer") {
      return { type: "bearer" };
    }
    if (httpScheme === "basic") {
      return { type: "basic" };
    }
    return null;
  }

  if (type === "apikey") {
    const location = String(scheme.in ?? "").toLowerCase();
    const header = typeof scheme.name === "string" ? scheme.name.trim() : "";
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
  const components = asRecord(spec.components);
  const securitySchemes = asRecord(components.securitySchemes);
  const schemeNames = Object.keys(securitySchemes);
  if (schemeNames.length === 0) {
    return { type: "none", inferred: true };
  }

  const globalSecurity = Array.isArray(spec.security)
    ? spec.security.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    : [];
  const referencedSchemeNames = globalSecurity.flatMap((entry) => Object.keys(entry));
  const candidateNames = referencedSchemeNames.length > 0
    ? [...new Set(referencedSchemeNames.filter((name) => typeof securitySchemes[name] === "object"))]
    : schemeNames;

  const normalized = candidateNames
    .map((name) => normalizeAuthScheme(asRecord(securitySchemes[name])))
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
  const response = await fetch(input.specUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.8",
      ...(input.headers ?? {}),
    },
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch spec (${response.status} ${response.statusText})`);
  }

  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error("Spec response was empty");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const spec = parseOpenApiPayload(raw, input.specUrl, contentType);
  const inferredAuth = inferSecuritySchemaAuth(spec);
  return { spec, inferredAuth };
}

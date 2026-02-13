import type { OpenApiAuth } from "./tool-source-types";
import { asRecord } from "./utils";

export function inferOpenApiAuth(spec: Record<string, unknown>): OpenApiAuth | undefined {
  const components = asRecord(spec.components);
  const securitySchemes = asRecord(components.securitySchemes);
  if (Object.keys(securitySchemes).length === 0) {
    return undefined;
  }

  const security = Array.isArray(spec.security)
    ? spec.security.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    : [];

  const referencedSchemeName = security
    .flatMap((entry) => Object.keys(entry))
    .find((name) => typeof securitySchemes[name] === "object");

  const schemeName = referencedSchemeName ?? Object.keys(securitySchemes)[0];
  if (!schemeName) return undefined;

  const scheme = asRecord(securitySchemes[schemeName]);
  const type = String(scheme.type ?? "").toLowerCase();

  if (type === "http") {
    const httpScheme = String(scheme.scheme ?? "").toLowerCase();
    if (httpScheme === "bearer") {
      return { type: "bearer", mode: "workspace" };
    }
    if (httpScheme === "basic") {
      return { type: "basic", mode: "workspace" };
    }
    return undefined;
  }

  if (type === "apikey") {
    const location = String(scheme.in ?? "").toLowerCase();
    const header = typeof scheme.name === "string" ? scheme.name.trim() : "";
    if (location === "header" && header.length > 0) {
      return { type: "apiKey", mode: "workspace", header };
    }
    return undefined;
  }

  if (type === "oauth2" || type === "openidconnect") {
    return { type: "bearer", mode: "workspace" };
  }

  return undefined;
}

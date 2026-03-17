import {
  asString,
  defaultNameFromEndpoint,
  executeHttpProbe,
  isRecord,
  namespaceFromSourceName,
  noneAuthInference,
  supportedAuthInference,
  type SourceAuthInference,
  type SourceDiscoveryProbeInput,
  type SourceDiscoveryResult,
  trimOrNull,
  unknownAuthInference,
  unsupportedAuthInference,
} from "@executor/source-core";
import * as Effect from "effect/Effect";

import { parseOpenApiDocument } from "./document";
import { extractOpenApiManifest } from "./extraction";

type OpenApiSecurityCandidate = {
  name: string;
  kind: "bearer" | "oauth2" | "apiKey" | "basic" | "unknown";
  supported: boolean;
  headerName: string | null;
  prefix: string | null;
  parameterName: string | null;
  parameterLocation: "header" | "query" | "cookie" | null;
  oauthAuthorizationUrl: string | null;
  oauthTokenUrl: string | null;
  oauthScopes: string[];
  reason: string;
};

const readLocalRef = (document: Record<string, unknown>, ref: string): unknown => {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  let current: unknown = document;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

const resolveSecurityScheme = (
  document: Record<string, unknown>,
  input: unknown,
  depth = 0,
): Record<string, unknown> | null => {
  if (!isRecord(input)) {
    return null;
  }

  const ref = asString(input["$ref"]);
  if (ref && depth < 5) {
    return resolveSecurityScheme(document, readLocalRef(document, ref), depth + 1);
  }

  return input;
};

const collectAppliedSecurityCandidates = (document: Record<string, unknown>): Array<{
  name: string;
  scopes: string[];
}> => {
  const seen = new Set<string>();
  const candidates: Array<{ name: string; scopes: string[] }> = [];

  const addRequirementArray = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }

    for (const requirement of value) {
      if (!isRecord(requirement)) {
        continue;
      }

      for (const [name, scopesValue] of Object.entries(requirement)) {
        if (name.length === 0 || seen.has(name)) {
          continue;
        }

        seen.add(name);
        candidates.push({
          name,
          scopes: Array.isArray(scopesValue)
            ? scopesValue.filter((scope): scope is string => typeof scope === "string")
            : [],
        });
      }
    }
  };

  addRequirementArray(document.security);

  const paths = document.paths;
  if (!isRecord(paths)) {
    return candidates;
  }

  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }

    addRequirementArray(pathItem.security);

    for (const operation of Object.values(pathItem)) {
      if (!isRecord(operation)) {
        continue;
      }
      addRequirementArray(operation.security);
    }
  }

  return candidates;
};

const securityCandidateFromScheme = (input: {
  name: string;
  scopes: string[];
  scheme: Record<string, unknown>;
}): OpenApiSecurityCandidate => {
  const type = asString(input.scheme.type)?.toLowerCase() ?? "";

  if (type === "oauth2") {
    const flows = isRecord(input.scheme.flows) ? input.scheme.flows : {};
    const flow = Object.values(flows).find(isRecord) ?? null;
    const declaredScopes = flow && isRecord(flow.scopes)
      ? Object.keys(flow.scopes).filter((scope) => scope.length > 0)
      : [];
    const oauthScopes = [...new Set([...input.scopes, ...declaredScopes])].sort();

    return {
      name: input.name,
      kind: "oauth2",
      supported: true,
      headerName: "Authorization",
      prefix: "Bearer ",
      parameterName: null,
      parameterLocation: null,
      oauthAuthorizationUrl: flow ? trimOrNull(asString(flow.authorizationUrl)) : null,
      oauthTokenUrl: flow ? trimOrNull(asString(flow.tokenUrl)) : null,
      oauthScopes,
      reason: `OpenAPI security scheme "${input.name}" declares OAuth2`,
    };
  }

  if (type === "http") {
    const scheme = asString(input.scheme.scheme)?.toLowerCase() ?? "";
    if (scheme === "bearer") {
      return {
        name: input.name,
        kind: "bearer",
        supported: true,
        headerName: "Authorization",
        prefix: "Bearer ",
        parameterName: null,
        parameterLocation: null,
        oauthAuthorizationUrl: null,
        oauthTokenUrl: null,
        oauthScopes: input.scopes,
        reason: `OpenAPI security scheme "${input.name}" declares HTTP bearer auth`,
      };
    }

    if (scheme === "basic") {
      return {
        name: input.name,
        kind: "basic",
        supported: false,
        headerName: "Authorization",
        prefix: "Basic ",
        parameterName: null,
        parameterLocation: null,
        oauthAuthorizationUrl: null,
        oauthTokenUrl: null,
        oauthScopes: input.scopes,
        reason: `OpenAPI security scheme "${input.name}" declares HTTP basic auth`,
      };
    }
  }

  if (type === "apiKey") {
    const location = asString(input.scheme.in);
    const parameterLocation = location === "header" || location === "query" || location === "cookie"
      ? location
      : null;

    return {
      name: input.name,
      kind: "apiKey",
      supported: false,
      headerName: parameterLocation === "header" ? trimOrNull(asString(input.scheme.name)) : null,
      prefix: null,
      parameterName: trimOrNull(asString(input.scheme.name)),
      parameterLocation,
      oauthAuthorizationUrl: null,
      oauthTokenUrl: null,
      oauthScopes: input.scopes,
      reason: `OpenAPI security scheme "${input.name}" declares API key auth`,
    };
  }

  return {
    name: input.name,
    kind: "unknown",
    supported: false,
    headerName: null,
    prefix: null,
    parameterName: null,
    parameterLocation: null,
    oauthAuthorizationUrl: null,
    oauthTokenUrl: null,
    oauthScopes: input.scopes,
    reason: `OpenAPI security scheme "${input.name}" uses unsupported type ${type || "unknown"}`,
  };
};

const inferOpenApiAuth = (document: Record<string, unknown>): SourceAuthInference => {
  const components = isRecord(document.components) ? document.components : {};
  const securitySchemes = isRecord(components.securitySchemes)
    ? components.securitySchemes
    : {};
  const appliedCandidates = collectAppliedSecurityCandidates(document);

  if (appliedCandidates.length === 0) {
    if (Object.keys(securitySchemes).length === 0) {
      return noneAuthInference("OpenAPI document does not declare security requirements");
    }

    const fallbackCandidate = Object.entries(securitySchemes)
      .map(([name, value]) => securityCandidateFromScheme({
        name,
        scopes: [],
        scheme: resolveSecurityScheme(document, value) ?? {},
      }))
      .sort((left, right) => {
        const priority = { oauth2: 0, bearer: 1, apiKey: 2, basic: 3, unknown: 4 } as const;
        return priority[left.kind] - priority[right.kind] || left.name.localeCompare(right.name);
      })[0];

    if (!fallbackCandidate) {
      return noneAuthInference("OpenAPI document does not declare security requirements");
    }

    const confidence = fallbackCandidate.kind === "unknown" ? "low" : "medium";
    if (fallbackCandidate.kind === "oauth2") {
      return supportedAuthInference("oauth2", {
        confidence,
        reason: `${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`,
        headerName: fallbackCandidate.headerName,
        prefix: fallbackCandidate.prefix,
        parameterName: fallbackCandidate.parameterName,
        parameterLocation: fallbackCandidate.parameterLocation,
        oauthAuthorizationUrl: fallbackCandidate.oauthAuthorizationUrl,
        oauthTokenUrl: fallbackCandidate.oauthTokenUrl,
        oauthScopes: fallbackCandidate.oauthScopes,
      });
    }

    if (fallbackCandidate.kind === "bearer") {
      return supportedAuthInference("bearer", {
        confidence,
        reason: `${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`,
        headerName: fallbackCandidate.headerName,
        prefix: fallbackCandidate.prefix,
        parameterName: fallbackCandidate.parameterName,
        parameterLocation: fallbackCandidate.parameterLocation,
        oauthAuthorizationUrl: fallbackCandidate.oauthAuthorizationUrl,
        oauthTokenUrl: fallbackCandidate.oauthTokenUrl,
        oauthScopes: fallbackCandidate.oauthScopes,
      });
    }

    if (fallbackCandidate.kind === "apiKey") {
      return unsupportedAuthInference("apiKey", {
        confidence,
        reason: `${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`,
        headerName: fallbackCandidate.headerName,
        prefix: fallbackCandidate.prefix,
        parameterName: fallbackCandidate.parameterName,
        parameterLocation: fallbackCandidate.parameterLocation,
        oauthAuthorizationUrl: fallbackCandidate.oauthAuthorizationUrl,
        oauthTokenUrl: fallbackCandidate.oauthTokenUrl,
        oauthScopes: fallbackCandidate.oauthScopes,
      });
    }

    if (fallbackCandidate.kind === "basic") {
      return unsupportedAuthInference("basic", {
        confidence,
        reason: `${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`,
        headerName: fallbackCandidate.headerName,
        prefix: fallbackCandidate.prefix,
        parameterName: fallbackCandidate.parameterName,
        parameterLocation: fallbackCandidate.parameterLocation,
        oauthAuthorizationUrl: fallbackCandidate.oauthAuthorizationUrl,
        oauthTokenUrl: fallbackCandidate.oauthTokenUrl,
        oauthScopes: fallbackCandidate.oauthScopes,
      });
    }

    return unknownAuthInference(
      `${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`,
    );
  }

  const resolvedCandidates = appliedCandidates
    .map(({ name, scopes }) => {
      const scheme = resolveSecurityScheme(document, securitySchemes[name]);
      return scheme == null ? null : securityCandidateFromScheme({ name, scopes, scheme });
    })
    .filter((candidate): candidate is OpenApiSecurityCandidate => candidate !== null)
    .sort((left, right) => {
      const priority = { oauth2: 0, bearer: 1, apiKey: 2, basic: 3, unknown: 4 } as const;
      return priority[left.kind] - priority[right.kind] || left.name.localeCompare(right.name);
    });

  const selected = resolvedCandidates[0];
  if (!selected) {
    return unknownAuthInference(
      "OpenAPI security requirements reference schemes that could not be resolved",
    );
  }

  if (selected.kind === "oauth2") {
    return supportedAuthInference("oauth2", {
      confidence: "high",
      reason: selected.reason,
      headerName: selected.headerName,
      prefix: selected.prefix,
      parameterName: selected.parameterName,
      parameterLocation: selected.parameterLocation,
      oauthAuthorizationUrl: selected.oauthAuthorizationUrl,
      oauthTokenUrl: selected.oauthTokenUrl,
      oauthScopes: selected.oauthScopes,
    });
  }

  if (selected.kind === "bearer") {
    return supportedAuthInference("bearer", {
      confidence: "high",
      reason: selected.reason,
      headerName: selected.headerName,
      prefix: selected.prefix,
      parameterName: selected.parameterName,
      parameterLocation: selected.parameterLocation,
      oauthAuthorizationUrl: selected.oauthAuthorizationUrl,
      oauthTokenUrl: selected.oauthTokenUrl,
      oauthScopes: selected.oauthScopes,
    });
  }

  if (selected.kind === "apiKey") {
    return unsupportedAuthInference("apiKey", {
      confidence: "high",
      reason: selected.reason,
      headerName: selected.headerName,
      prefix: selected.prefix,
      parameterName: selected.parameterName,
      parameterLocation: selected.parameterLocation,
      oauthAuthorizationUrl: selected.oauthAuthorizationUrl,
      oauthTokenUrl: selected.oauthTokenUrl,
      oauthScopes: selected.oauthScopes,
    });
  }

  if (selected.kind === "basic") {
    return unsupportedAuthInference("basic", {
      confidence: "high",
      reason: selected.reason,
      headerName: selected.headerName,
      prefix: selected.prefix,
      parameterName: selected.parameterName,
      parameterLocation: selected.parameterLocation,
      oauthAuthorizationUrl: selected.oauthAuthorizationUrl,
      oauthTokenUrl: selected.oauthTokenUrl,
      oauthScopes: selected.oauthScopes,
    });
  }

  return unknownAuthInference(selected.reason);
};

const deriveOpenApiEndpoint = (input: {
  normalizedUrl: string;
  document: Record<string, unknown>;
}): string => {
  const servers = input.document.servers;
  if (Array.isArray(servers)) {
    const first = servers.find(isRecord);
    const serverUrl = first ? trimOrNull(asString(first.url)) : null;
    if (serverUrl) {
      try {
        return new URL(serverUrl, input.normalizedUrl).toString();
      } catch {
        return input.normalizedUrl;
      }
    }
  }

  return new URL(input.normalizedUrl).origin;
};

export const detectOpenApiSource = (
  input: SourceDiscoveryProbeInput,
): Effect.Effect<SourceDiscoveryResult | null, never, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.either(executeHttpProbe({
      method: "GET",
      url: input.normalizedUrl,
      headers: input.headers,
    }));

    if (response._tag === "Left") {
      console.warn(
        `[discovery] OpenAPI probe HTTP fetch failed for ${input.normalizedUrl}:`,
        response.left.message,
      );
      return null;
    }

    if (response.right.status < 200 || response.right.status >= 300) {
      console.warn(
        `[discovery] OpenAPI probe got status ${response.right.status} for ${input.normalizedUrl}`,
      );
      return null;
    }

    const manifest = yield* Effect.either(
      extractOpenApiManifest(input.normalizedUrl, response.right.text),
    );
    if (manifest._tag === "Left") {
      console.warn(
        `[discovery] OpenAPI manifest extraction failed for ${input.normalizedUrl}:`,
        manifest.left instanceof Error ? manifest.left.message : String(manifest.left),
      );
      return null;
    }

    const document = yield* Effect.either(Effect.try({
      try: () => parseOpenApiDocument(response.right.text) as unknown,
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
    }));

    const parsedDocument = document._tag === "Right" && isRecord(document.right)
      ? document.right
      : {};
    const endpoint = deriveOpenApiEndpoint({
      normalizedUrl: input.normalizedUrl,
      document: parsedDocument,
    });
    const name = trimOrNull(
      asString(parsedDocument.info && isRecord(parsedDocument.info) ? parsedDocument.info.title : null),
    ) ?? defaultNameFromEndpoint(endpoint);

    return {
      detectedKind: "openapi",
      confidence: "high",
      endpoint,
      specUrl: input.normalizedUrl,
      name,
      namespace: namespaceFromSourceName(name),
      transport: null,
      authInference: inferOpenApiAuth(parsedDocument),
      toolCount: manifest.right.tools.length,
      warnings: [],
    } satisfies SourceDiscoveryResult;
  }).pipe(
    Effect.catchAll((error: unknown) => {
      console.warn(
        `[discovery] OpenAPI detection unexpected error for ${input.normalizedUrl}:`,
        error instanceof Error ? error.message : String(error),
      );
      return Effect.succeed(null);
    }),
  );

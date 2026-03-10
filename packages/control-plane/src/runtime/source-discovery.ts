import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import {
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
} from "@executor/codemode-mcp";
import {
  extractOpenApiManifest,
  parseOpenApiDocument,
} from "@executor/codemode-openapi";
import {
  type SourceAuthInference,
  type SourceDiscoveryResult,
  type SourceProbeAuth,
} from "#schema";
import * as Effect from "effect/Effect";
import { getIntrospectionQuery } from "graphql";
import { startMcpOAuthAuthorization } from "./mcp-oauth";
import { namespaceFromSourceName } from "./source-names";

const GRAPHQL_INTROSPECTION_QUERY = getIntrospectionQuery();

type HttpProbeResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  text: string;
};

type OpenApiProbeResult = {
  result: SourceDiscoveryResult;
};

type GraphqlProbeResult = {
  result: SourceDiscoveryResult;
};

type McpProbeResult = {
  result: SourceDiscoveryResult;
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const defaultNameFromEndpoint = (endpoint: string): string => new URL(endpoint).hostname;

const normalizeUrl = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Source URL is required");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Source URL must use http or https");
  }

  return parsed.toString();
};

const unsupportedAuthInference = (
  kind: SourceAuthInference["suggestedKind"],
  input: Omit<SourceAuthInference, "suggestedKind" | "supported">,
): SourceAuthInference => ({
  ...input,
  suggestedKind: kind,
  supported: false,
});

const supportedAuthInference = (
  kind: Extract<SourceAuthInference["suggestedKind"], "none" | "bearer" | "oauth2">,
  input: Omit<SourceAuthInference, "suggestedKind" | "supported">,
): SourceAuthInference => ({
  ...input,
  suggestedKind: kind,
  supported: true,
});

const unknownAuthInference = (reason: string): SourceAuthInference => ({
  suggestedKind: "unknown",
  confidence: "low",
  supported: false,
  reason,
  headerName: null,
  prefix: null,
  parameterName: null,
  parameterLocation: null,
  oauthAuthorizationUrl: null,
  oauthTokenUrl: null,
  oauthScopes: [],
});

const noneAuthInference = (
  reason: string,
  confidence: SourceAuthInference["confidence"] = "high",
): SourceAuthInference => supportedAuthInference("none", {
  confidence,
  reason,
  headerName: null,
  prefix: null,
  parameterName: null,
  parameterLocation: null,
  oauthAuthorizationUrl: null,
  oauthTokenUrl: null,
  oauthScopes: [],
});

const parseChallengeAuthInference = (
  headers: Readonly<Record<string, string>>,
  fallbackReason: string,
): SourceAuthInference => {
  const challenge = headers["www-authenticate"] ?? headers["WWW-Authenticate"];
  if (!challenge) {
    return unknownAuthInference(fallbackReason);
  }

  const normalized = challenge.toLowerCase();
  if (normalized.includes("bearer")) {
    return supportedAuthInference("bearer", {
      confidence: normalized.includes("realm=") ? "medium" : "low",
      reason: `Derived from HTTP challenge: ${challenge}`,
      headerName: "Authorization",
      prefix: "Bearer ",
      parameterName: null,
      parameterLocation: null,
      oauthAuthorizationUrl: null,
      oauthTokenUrl: null,
      oauthScopes: [],
    });
  }

  if (normalized.includes("basic")) {
    return unsupportedAuthInference("basic", {
      confidence: "medium",
      reason: `Derived from HTTP challenge: ${challenge}`,
      headerName: "Authorization",
      prefix: "Basic ",
      parameterName: null,
      parameterLocation: null,
      oauthAuthorizationUrl: null,
      oauthTokenUrl: null,
      oauthScopes: [],
    });
  }

  return unknownAuthInference(fallbackReason);
};

const probeHeadersFromAuth = (probeAuth: SourceProbeAuth | null | undefined): Record<string, string> => {
  if (probeAuth == null || probeAuth.kind === "none") {
    return {};
  }

  if (probeAuth.kind === "headers") {
    return { ...probeAuth.headers };
  }

  if (probeAuth.kind === "basic") {
    return {
      Authorization: `Basic ${Buffer.from(`${probeAuth.username}:${probeAuth.password}`).toString("base64")}`,
    };
  }

  return {
    [trimOrNull(probeAuth.headerName) ?? "Authorization"]: `${probeAuth.prefix ?? "Bearer "}${probeAuth.token}`,
  };
};

const executeHttpProbe = (input: {
  method: "GET" | "POST";
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}): Effect.Effect<HttpProbeResponse, Error, never> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    let request = HttpClientRequest.make(input.method)(input.url, {
      headers: input.headers ?? {},
    });

    if (input.body !== undefined) {
      request = HttpClientRequest.bodyText(
        request,
        input.body,
        input.headers?.["content-type"] ?? input.headers?.["Content-Type"] ?? "application/json",
      );
    }

    const response = yield* client.execute(request).pipe(
      Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))),
    );

    const text = yield* response.text.pipe(
      Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))),
    );

    return {
      status: response.status,
      headers: response.headers,
      text,
    } satisfies HttpProbeResponse;
  }).pipe(Effect.provide(FetchHttpClient.layer));

const parseStructuredDocument = (value: string): unknown =>
  parseOpenApiDocument(value) as unknown;

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
      reason: `OpenAPI security scheme \"${input.name}\" declares OAuth2`,
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
        reason: `OpenAPI security scheme \"${input.name}\" declares HTTP bearer auth`,
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
        reason: `OpenAPI security scheme \"${input.name}\" declares HTTP basic auth`,
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
      reason: `OpenAPI security scheme \"${input.name}\" declares API key auth`,
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
    reason: `OpenAPI security scheme \"${input.name}\" uses unsupported type ${type || "unknown"}`,
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

    return unknownAuthInference(`${fallbackCandidate.reason}; scheme is defined but not explicitly applied to operations`);
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
    return unknownAuthInference("OpenAPI security requirements reference schemes that could not be resolved");
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

const tryDetectOpenApi = (input: {
  normalizedUrl: string;
  headers: Readonly<Record<string, string>>;
}): Effect.Effect<OpenApiProbeResult | null, never, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.either(executeHttpProbe({
      method: "GET",
      url: input.normalizedUrl,
      headers: input.headers,
    }));

    if (response._tag === "Left") {
      console.warn(`[discovery] OpenAPI probe HTTP fetch failed for ${input.normalizedUrl}:`, response.left.message);
      return null;
    }

    if (response.right.status < 200 || response.right.status >= 300) {
      console.warn(`[discovery] OpenAPI probe got status ${response.right.status} for ${input.normalizedUrl}`);
      return null;
    }

    const manifest = yield* Effect.either(
      extractOpenApiManifest(input.normalizedUrl, response.right.text),
    );
    if (manifest._tag === "Left") {
      console.warn(`[discovery] OpenAPI manifest extraction failed for ${input.normalizedUrl}:`, manifest.left instanceof Error ? manifest.left.message : String(manifest.left));
      return null;
    }

    const document = yield* Effect.either(Effect.try({
      try: () => parseStructuredDocument(response.right.text),
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
    }));

    const parsedDocument = document._tag === "Right" && isRecord(document.right)
      ? document.right
      : {};
    const endpoint = deriveOpenApiEndpoint({
      normalizedUrl: input.normalizedUrl,
      document: parsedDocument,
    });
    const name = trimOrNull(asString(parsedDocument.info && isRecord(parsedDocument.info) ? parsedDocument.info.title : null))
      ?? defaultNameFromEndpoint(endpoint);

    return {
      result: {
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
      },
    } satisfies OpenApiProbeResult;
  }).pipe(Effect.catchAll((error: unknown) => {
    console.warn(`[discovery] OpenAPI detection unexpected error for ${input.normalizedUrl}:`, error instanceof Error ? error.message : String(error));
    return Effect.succeed(null);
  }));

const looksLikeGraphqlEndpoint = (normalizedUrl: string): boolean =>
  /graphql/i.test(new URL(normalizedUrl).pathname);

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const tryDetectGraphql = (input: {
  normalizedUrl: string;
  headers: Readonly<Record<string, string>>;
}): Effect.Effect<GraphqlProbeResult | null, never, never> =>
  Effect.gen(function* () {
    const response = yield* Effect.either(executeHttpProbe({
      method: "POST",
      url: input.normalizedUrl,
      headers: {
        accept: "application/graphql-response+json, application/json",
        "content-type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }),
    }));

    if (response._tag === "Left") {
      return null;
    }

    const parsed = tryParseJson(response.right.text);
    const contentType = (response.right.headers["content-type"] ?? "").toLowerCase();
    const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : null;
    if (data && isRecord(data.__schema)) {
      const name = defaultNameFromEndpoint(input.normalizedUrl);
      return {
        result: {
          detectedKind: "graphql",
          confidence: "high",
          endpoint: input.normalizedUrl,
          specUrl: null,
          name,
          namespace: namespaceFromSourceName(name),
          transport: null,
          authInference: noneAuthInference("GraphQL introspection succeeded without an advertised auth requirement", "medium"),
          toolCount: null,
          warnings: [],
        },
      } satisfies GraphqlProbeResult;
    }

    const errors = isRecord(parsed) && Array.isArray(parsed.errors)
      ? parsed.errors
      : [];
    const graphqlErrors = errors
      .map((error) => isRecord(error) ? asString(error.message) : null)
      .filter((message): message is string => message !== null);

    const mediumConfidenceGraphql =
      contentType.includes("application/graphql-response+json")
      || (looksLikeGraphqlEndpoint(input.normalizedUrl) && response.right.status >= 400 && response.right.status < 500)
      || graphqlErrors.some((message) => /introspection|graphql|query/i.test(message));

    if (!mediumConfidenceGraphql) {
      return null;
    }

    const name = defaultNameFromEndpoint(input.normalizedUrl);
    return {
      result: {
        detectedKind: "graphql",
        confidence: data ? "high" : "medium",
        endpoint: input.normalizedUrl,
        specUrl: null,
        name,
        namespace: namespaceFromSourceName(name),
        transport: null,
        authInference:
          response.right.status === 401 || response.right.status === 403
            ? parseChallengeAuthInference(
                response.right.headers,
                "GraphQL endpoint rejected introspection and did not advertise a concrete auth scheme",
              )
            : noneAuthInference(
                graphqlErrors.length > 0
                  ? `GraphQL endpoint responded with errors during introspection: ${graphqlErrors[0]}`
                  : "GraphQL endpoint shape detected",
                "medium",
              ),
        toolCount: null,
        warnings: graphqlErrors.length > 0 ? [graphqlErrors[0]] : [],
      },
    } satisfies GraphqlProbeResult;
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

const tryDetectMcp = (input: {
  normalizedUrl: string;
  headers: Readonly<Record<string, string>>;
}): Effect.Effect<McpProbeResult | null, never, never> =>
  Effect.gen(function* () {
    const connector = createSdkMcpConnector({
      endpoint: input.normalizedUrl,
      headers: input.headers,
      transport: "auto",
    });

    const discovered = yield* Effect.either(discoverMcpToolsFromConnector({
      connect: connector,
      sourceKey: "discovery",
      namespace: namespaceFromSourceName(defaultNameFromEndpoint(input.normalizedUrl)),
    }));

    if (discovered._tag === "Right") {
      const name = defaultNameFromEndpoint(input.normalizedUrl);
      return {
        result: {
          detectedKind: "mcp",
          confidence: "high",
          endpoint: input.normalizedUrl,
          specUrl: null,
          name,
          namespace: namespaceFromSourceName(name),
          transport: "auto",
          authInference: noneAuthInference("MCP tool discovery succeeded without an advertised auth requirement", "medium"),
          toolCount: discovered.right.manifest.tools.length,
          warnings: [],
        },
      } satisfies McpProbeResult;
    }

    const oauthProbe = yield* Effect.either(startMcpOAuthAuthorization({
      endpoint: input.normalizedUrl,
      redirectUrl: "http://127.0.0.1/executor/discovery/oauth/callback",
      state: "source-discovery",
    }));

    if (oauthProbe._tag === "Left") {
      return null;
    }

    const name = defaultNameFromEndpoint(input.normalizedUrl);
    return {
      result: {
        detectedKind: "mcp",
        confidence: "high",
        endpoint: input.normalizedUrl,
        specUrl: null,
        name,
        namespace: namespaceFromSourceName(name),
        transport: "auto",
        authInference: supportedAuthInference("oauth2", {
          confidence: "high",
          reason: "MCP endpoint advertised OAuth during discovery",
          headerName: "Authorization",
          prefix: "Bearer ",
          parameterName: null,
          parameterLocation: null,
          oauthAuthorizationUrl: oauthProbe.right.authorizationUrl,
          oauthTokenUrl: oauthProbe.right.authorizationServerUrl,
          oauthScopes: [],
        }),
        toolCount: null,
        warnings: ["OAuth is required before MCP tools can be listed."],
      },
    } satisfies McpProbeResult;
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

const fallbackDiscoveryResult = (normalizedUrl: string): SourceDiscoveryResult => {
  const endpoint = normalizedUrl;
  const name = defaultNameFromEndpoint(endpoint);
  return {
    detectedKind: "unknown",
    confidence: "low",
    endpoint,
    specUrl: null,
    name,
    namespace: namespaceFromSourceName(name),
    transport: null,
    authInference: unknownAuthInference("Could not infer source kind or auth requirements from the provided URL"),
    toolCount: null,
    warnings: ["Could not confirm whether the URL is OpenAPI, GraphQL, or MCP."],
  };
};

export const discoverSource = (input: {
  url: string;
  probeAuth?: SourceProbeAuth | null;
}): Effect.Effect<SourceDiscoveryResult, Error, never> =>
  Effect.gen(function* () {
    const normalizedUrl = normalizeUrl(input.url);
    const headers = probeHeadersFromAuth(input.probeAuth);

    const openApi = yield* tryDetectOpenApi({
      normalizedUrl,
      headers,
    });
    if (openApi) {
      return openApi.result;
    }

    const graphql = yield* tryDetectGraphql({
      normalizedUrl,
      headers,
    });
    if (graphql) {
      return graphql.result;
    }

    const mcp = yield* tryDetectMcp({
      normalizedUrl,
      headers,
    });
    if (mcp) {
      return mcp.result;
    }

    return fallbackDiscoveryResult(normalizedUrl);
  });

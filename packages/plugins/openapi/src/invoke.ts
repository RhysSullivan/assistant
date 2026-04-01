import { Effect, Layer, Match, Option } from "effect";
import {
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";

import {
  type ToolId,
  type ToolInvoker,
  ToolInvocationResult,
  ToolInvocationError,
} from "@executor/sdk";

import { OpenApiInvocationError } from "./errors";
import type { OpenApiOperationStore } from "./operation-store";
import {
  type AuthConfig,
  type OperationBinding,
  InvocationConfig,
  InvocationResult,
  type OperationParameter,
} from "./types";

// ---------------------------------------------------------------------------
// Parameter reading
// ---------------------------------------------------------------------------

const CONTAINER_KEYS: Record<string, readonly string[]> = {
  path: ["path", "pathParams", "params"],
  query: ["query", "queryParams", "params"],
  header: ["headers", "header"],
  cookie: ["cookies", "cookie"],
};

const readParamValue = (
  args: Record<string, unknown>,
  param: OperationParameter,
): unknown => {
  const direct = args[param.name];
  if (direct !== undefined) return direct;

  for (const key of CONTAINER_KEYS[param.location] ?? []) {
    const container = args[key];
    if (
      typeof container === "object" &&
      container !== null &&
      !Array.isArray(container)
    ) {
      const nested = (container as Record<string, unknown>)[param.name];
      if (nested !== undefined) return nested;
    }
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const resolvePath = Effect.fn("OpenApi.resolvePath")(function* (
  pathTemplate: string,
  args: Record<string, unknown>,
  parameters: readonly OperationParameter[],
) {
  let resolved = pathTemplate;

  // Resolve declared path parameters
  for (const param of parameters) {
    if (param.location !== "path") continue;
    const value = readParamValue(args, param);
    if (value === undefined || value === null) {
      if (param.required) {
        return yield* new OpenApiInvocationError({
          message: `Missing required path parameter: ${param.name}`,
          statusCode: Option.none(),
          error: undefined,
        });
      }
      continue;
    }
    resolved = resolved.replaceAll(
      `{${param.name}}`,
      encodeURIComponent(String(value)),
    );
  }

  // Resolve remaining placeholders from raw args (handles specs that
  // don't explicitly list path parameters)
  const remaining = [...resolved.matchAll(/\{([^{}]+)\}/g)]
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string");

  for (const name of remaining) {
    const value = args[name];
    if (value !== undefined && value !== null) {
      resolved = resolved.replaceAll(
        `{${name}}`,
        encodeURIComponent(String(value)),
      );
    }
  }

  const unresolved = [...resolved.matchAll(/\{([^{}]+)\}/g)]
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string");

  if (unresolved.length > 0) {
    return yield* new OpenApiInvocationError({
      message: `Unresolved path parameters: ${[...new Set(unresolved)].join(", ")}`,
      statusCode: Option.none(),
      error: undefined,
    });
  }

  return resolved;
});

// ---------------------------------------------------------------------------
// Auth application
// ---------------------------------------------------------------------------

const applyAuth = (
  request: HttpClientRequest.HttpClientRequest,
  auth: AuthConfig,
): HttpClientRequest.HttpClientRequest =>
  Match.valueTags(auth, {
    NoAuth: () => request,
    BearerAuth: ({ token, headerName, prefix }) =>
      HttpClientRequest.setHeader(request, headerName, `${prefix}${token}`),
    ApiKeyAuth: ({ name, value, in: location }) => {
      if (location === "header") {
        return HttpClientRequest.setHeader(request, name, value);
      }
      if (location === "query") {
        return HttpClientRequest.setUrlParam(request, name, value);
      }
      // cookie
      const existing =
        request.headers["cookie"] ?? "";
      const cookie = `${name}=${encodeURIComponent(value)}`;
      return HttpClientRequest.setHeader(
        request,
        "cookie",
        existing ? `${existing}; ${cookie}` : cookie,
      );
    },
  });

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const isJsonContentType = (ct: string | null | undefined): boolean => {
  if (!ct) return false;
  const normalized = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/json" ||
    normalized.includes("+json") ||
    normalized.includes("json")
  );
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Invoke an OpenAPI operation binding. Requires HttpClient in the context. */
export const invoke = Effect.fn("OpenApi.invoke")(function* (
  operation: OperationBinding,
  args: Record<string, unknown>,
  config: InvocationConfig,
) {
  const client = yield* HttpClient.HttpClient;

  const resolvedPath = yield* resolvePath(
    operation.pathTemplate,
    args,
    operation.parameters,
  );

  const path = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;

  // Build the base request — use just the path; baseUrl is applied to the client
  let request = HttpClientRequest.make(operation.method.toUpperCase() as "GET")(path);

  // Query parameters
  for (const param of operation.parameters) {
    if (param.location !== "query") continue;
    const value = readParamValue(args, param);
    if (value === undefined || value === null) continue;
    request = HttpClientRequest.setUrlParam(
      request,
      param.name,
      String(value),
    );
  }

  // Header parameters
  for (const param of operation.parameters) {
    if (param.location !== "header") continue;
    const value = readParamValue(args, param);
    if (value === undefined || value === null) continue;
    request = HttpClientRequest.setHeader(
      request,
      param.name,
      String(value),
    );
  }

  // Request body
  if (Option.isSome(operation.requestBody)) {
    const rb = operation.requestBody.value;
    const bodyValue = args.body ?? args.input;
    if (bodyValue !== undefined) {
      if (isJsonContentType(rb.contentType)) {
        request = HttpClientRequest.bodyUnsafeJson(request, bodyValue);
      } else {
        request = HttpClientRequest.bodyText(request, String(bodyValue), rb.contentType);
      }
    }
  }

  // Auth
  request = applyAuth(request, config.auth);

  // Execute
  const response = yield* client.execute(request).pipe(
    Effect.mapError(
      (err) =>
        new OpenApiInvocationError({
          message: `HTTP request failed: ${err.message}`,
          statusCode: Option.none(),
          error: err,
        }),
    ),
  );

  const status = response.status;
  const responseHeaders: Record<string, string> = { ...response.headers };

  // Decode body
  const contentType = response.headers["content-type"] ?? null;
  const responseBody: unknown =
    status === 204
      ? null
      : isJsonContentType(contentType)
        ? yield* response.json.pipe(
            Effect.catchAll(() => response.text),
          )
        : yield* response.text;

  const ok = status >= 200 && status < 300;

  return new InvocationResult({
    status,
    headers: responseHeaders,
    data: ok ? responseBody : null,
    error: ok ? null : responseBody,
  });
});

// ---------------------------------------------------------------------------
// ToolInvoker — bridges operation store + HTTP client into SDK invoker
// ---------------------------------------------------------------------------

export const makeOpenApiInvoker = (
  operationStore: OpenApiOperationStore,
  httpClientLayer: Layer.Layer<HttpClient.HttpClient>,
): ToolInvoker => ({
  invoke: (toolId: ToolId, args: unknown, _options) =>
    Effect.gen(function* () {
      const entry = yield* operationStore.get(toolId);
      if (!entry) {
        return yield* new ToolInvocationError({
          toolId,
          message: `No operation found for tool "${toolId}"`,
          cause: undefined,
        });
      }

      const { binding, config } = entry;
      const baseUrl = config.baseUrl;

      const clientWithBaseUrl = baseUrl
        ? Layer.effect(
            HttpClient.HttpClient,
            Effect.map(
              HttpClient.HttpClient,
              HttpClient.mapRequest(
                HttpClientRequest.prependUrl(baseUrl),
              ),
            ),
          ).pipe(Layer.provide(httpClientLayer))
        : httpClientLayer;

      const result = yield* invoke(
        binding,
        (args ?? {}) as Record<string, unknown>,
        config,
      ).pipe(Effect.provide(clientWithBaseUrl));

      return new ToolInvocationResult({
        data: result.data,
        error: result.error,
        status: result.status,
      });
    }).pipe(
      Effect.mapError((err) =>
        err._tag === "ToolInvocationError"
          ? err
          : new ToolInvocationError({
              toolId,
              message: `OpenAPI invocation failed: ${err.message}`,
              cause: err,
            }),
      ),
    ),
});

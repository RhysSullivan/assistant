import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  standardSchemaFromJsonSchema,
  toTool,
  type ToolMap,
  unknownInputSchema,
} from "@executor-v3/codemode-core";

import {
  compileOpenApiToolDefinitions,
  type OpenApiToolDefinition,
} from "./openapi-definitions";
import { buildOpenApiToolPresentation } from "./openapi-tool-presentation";
import {
  extractOpenApiManifest,
  type OpenApiExtractionError,
} from "./openapi-extraction";
import {
  type OpenApiInvocationPayload,
  type OpenApiSpecInput,
  type OpenApiToolManifest,
} from "./openapi-types";

type OpenApiToolArgs = Record<string, unknown>;
type OpenApiToolParameter = OpenApiInvocationPayload["parameters"][number];

export class OpenApiToolInvocationError extends Data.TaggedError(
  "OpenApiToolInvocationError",
)<{
  operation: string;
  message: string;
  details: string | null;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asToolArgs = (value: unknown): OpenApiToolArgs => {
  if (!isRecord(value)) {
    return {};
  }

  return value;
};

const parameterContainerKeys: Record<
  OpenApiToolParameter["location"],
  Array<string>
> = {
  path: ["path", "pathParams", "params"],
  query: ["query", "queryParams", "params"],
  header: ["headers", "header"],
  cookie: ["cookies", "cookie"],
};

const argsValueToString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
  ) {
    return String(value);
  }

  return String(value);
};

const readParameterValue = (
  args: OpenApiToolArgs,
  parameter: OpenApiToolParameter,
): unknown => {
  const directValue = args[parameter.name];
  if (directValue !== undefined) {
    return directValue;
  }

  for (const key of parameterContainerKeys[parameter.location]) {
    const container = args[key];
    if (!isRecord(container)) {
      continue;
    }

    const nestedValue = container[parameter.name];
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  return undefined;
};

const hasRequestBody = (
  args: OpenApiToolArgs,
): args is OpenApiToolArgs & { body: unknown } =>
  Object.prototype.hasOwnProperty.call(args, "body") && args.body !== undefined;

const replacePathTemplate = (
  pathTemplate: string,
  args: OpenApiToolArgs,
  payload: OpenApiInvocationPayload,
): string => {
  let resolvedPath = pathTemplate;

  for (const parameter of payload.parameters) {
    if (parameter.location !== "path") {
      continue;
    }

    const parameterValue = readParameterValue(args, parameter);
    if (parameterValue === undefined || parameterValue === null) {
      if (parameter.required) {
        throw new OpenApiToolInvocationError({
          operation: "resolve_path",
          message: `Missing required path parameter: ${parameter.name}`,
          details: pathTemplate,
        });
      }
      continue;
    }

    resolvedPath = resolvedPath.replaceAll(
      `{${parameter.name}}`,
      encodeURIComponent(String(parameterValue)),
    );
  }

  const unresolvedPathParameters = [...resolvedPath.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const parameterName of unresolvedPathParameters) {
    const parameterValue = args[parameterName]
      ?? (isRecord(args.path) ? args.path[parameterName] : undefined)
      ?? (isRecord(args.pathParams) ? args.pathParams[parameterName] : undefined)
      ?? (isRecord(args.params) ? args.params[parameterName] : undefined);

    if (parameterValue === undefined || parameterValue === null) {
      continue;
    }

    resolvedPath = resolvedPath.replaceAll(
      `{${parameterName}}`,
      encodeURIComponent(String(parameterValue)),
    );
  }

  const stillUnresolvedPathParameters = [...resolvedPath.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (stillUnresolvedPathParameters.length > 0) {
    const names = [...new Set(stillUnresolvedPathParameters)].sort().join(", ");
    throw new OpenApiToolInvocationError({
      operation: "resolve_path",
      message: `Unresolved path parameters after substitution: ${names}`,
      details: resolvedPath,
    });
  }

  return resolvedPath;
};

const normalizeHttpUrl = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new OpenApiToolInvocationError({
      operation: "validate_base_url",
      message: "OpenAPI baseUrl is empty",
      details: null,
    });
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new OpenApiToolInvocationError({
        operation: "validate_base_url",
        message: "OpenAPI baseUrl must be http or https",
        details: parsed.toString(),
      });
    }

    return parsed.toString();
  } catch (cause) {
    if (cause instanceof OpenApiToolInvocationError) {
      throw cause;
    }

    throw new OpenApiToolInvocationError({
      operation: "validate_base_url",
      message: "OpenAPI baseUrl is invalid",
      details: cause instanceof Error ? cause.message : String(cause),
    });
  }
};



const decodeHttpClientResponseBody = (
  response: Awaited<ReturnType<HttpClient.HttpClient["execute"]>> extends Effect.Effect<
    infer Value,
    infer _Error,
    infer _Requirements
  >
    ? Value
    : never,
): Effect.Effect<unknown, Error, never> => {
  const contentType = response.headers["content-type"]?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    return response.json.pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  }

  return response.text.pipe(
    Effect.mapError((cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
    ),
  );
};

const summarizeHttpResponseBody = (body: unknown): string | null => {
  if (body === null || body === undefined) {
    return null;
  }

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
  }

  try {
    const serialized = JSON.stringify(body);
    return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
  } catch {
    return String(body);
  }
};

const inputSchemaFromTypingJson = (inputSchemaJson: string | undefined) => {
  if (!inputSchemaJson) {
    return unknownInputSchema;
  }

  try {
    return standardSchemaFromJsonSchema(JSON.parse(inputSchemaJson), {
      vendor: "openapi",
      fallback: unknownInputSchema,
    });
  } catch {
    return unknownInputSchema;
  }
};

export type CreateOpenApiToolsFromManifestInput = {
  manifest: OpenApiToolManifest;
  baseUrl: string;
  namespace?: string;
  sourceKey?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentialHeaders?: Readonly<Record<string, string>>;
  httpClientLayer?: Layer.Layer<HttpClient.HttpClient, never, never>;
};

const resolveRequestUrl = (baseUrl: string, resolvedPath: string): URL => {
  try {
    return new URL(resolvedPath);
  } catch {
    const base = new URL(baseUrl);
    const basePath =
      base.pathname === "/"
        ? ""
        : base.pathname.endsWith("/")
          ? base.pathname.slice(0, -1)
          : base.pathname;
    const pathPart = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;

    base.pathname = `${basePath}${pathPart}`.replace(/\/{2,}/g, "/");
    base.search = "";
    base.hash = "";

    return base;
  }
};

const buildFetchRequest = (input: {
  payload: OpenApiInvocationPayload;
  args: OpenApiToolArgs;
  baseUrl: string;
  defaultHeaders: Readonly<Record<string, string>>;
  credentialHeaders: Readonly<Record<string, string>>;
}): {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
} => {
  const resolvedPath = replacePathTemplate(
    input.payload.pathTemplate,
    input.args,
    input.payload,
  );
  const url = resolveRequestUrl(input.baseUrl, resolvedPath);

  const headers: Record<string, string> = {
    ...input.defaultHeaders,
  };
  const cookieParts: Array<string> = [];

  for (const parameter of input.payload.parameters) {
    if (parameter.location === "path") {
      continue;
    }

    const parameterValue = readParameterValue(input.args, parameter);
    if (parameterValue === undefined || parameterValue === null) {
      if (parameter.required) {
        throw new OpenApiToolInvocationError({
          operation: "validate_args",
          message: `Missing required ${parameter.location} parameter: ${parameter.name}`,
          details: input.payload.pathTemplate,
        });
      }
      continue;
    }

    const encoded = argsValueToString(parameterValue);

    if (parameter.location === "query") {
      url.searchParams.set(parameter.name, encoded);
    } else if (parameter.location === "header") {
      headers[parameter.name] = encoded;
    } else if (parameter.location === "cookie") {
      cookieParts.push(`${parameter.name}=${encodeURIComponent(encoded)}`);
    }
  }

  if (cookieParts.length > 0) {
    headers.cookie = cookieParts.join("; ");
  }

  let body: string | undefined;

  if (input.payload.requestBody !== null) {
    if (!hasRequestBody(input.args)) {
      if (input.payload.requestBody.required) {
        throw new OpenApiToolInvocationError({
          operation: "validate_args",
          message: "Missing required request body at args.body",
          details: input.payload.pathTemplate,
        });
      }
    } else {
      body = JSON.stringify(input.args.body);

      const preferredContentType = input.payload.requestBody.contentTypes[0];
      if (preferredContentType) {
        headers["content-type"] = preferredContentType;
      } else if (!("content-type" in headers)) {
        headers["content-type"] = "application/json";
      }
    }
  }

  for (const [key, value] of Object.entries(input.credentialHeaders)) {
    headers[key] = value;
  }

  return {
    url,
    method: input.payload.method.toUpperCase(),
    headers,
    body,
  };
};

const createToolPath = (namespace: string | undefined, definition: OpenApiToolDefinition): string =>
  namespace ? `${namespace}.${definition.toolId}` : definition.toolId;

export const createOpenApiToolsFromManifest = (
  input: CreateOpenApiToolsFromManifestInput,
): ToolMap => {
  const baseUrl = normalizeHttpUrl(input.baseUrl);
  const sourceKey = input.sourceKey ?? "openapi.generated";
  const defaultHeaders = input.defaultHeaders ?? {};
  const credentialHeaders = input.credentialHeaders ?? {};
  const httpClientLayer = input.httpClientLayer ?? FetchHttpClient.layer;

  const definitions = compileOpenApiToolDefinitions(input.manifest);
  const result: ToolMap = {};

  for (const definition of definitions) {
    const toolPath = createToolPath(input.namespace, definition);
    const presentation = buildOpenApiToolPresentation({
      manifest: input.manifest,
      definition,
    });

    result[toolPath] = toTool({
      tool: {
        description: definition.description,
        inputSchema: inputSchemaFromTypingJson(
          presentation.inputSchemaJson ?? definition.typing?.inputSchemaJson,
        ),
        execute: async (args: unknown) => {
          const decodedArgs = asToolArgs(args);
          const request = buildFetchRequest({
            payload: definition.invocation,
            args: decodedArgs,
            baseUrl,
            defaultHeaders,
            credentialHeaders,
          });

          return Effect.runPromise(
            Effect.gen(function* () {
              const client = yield* HttpClient.HttpClient;
              let clientRequest = HttpClientRequest.make(
                request.method as Parameters<typeof HttpClientRequest.make>[0],
              )(request.url, {
                headers: request.headers,
              });

              if (request.body !== undefined) {
                clientRequest = HttpClientRequest.bodyText(
                  clientRequest,
                  request.body,
                  request.headers["content-type"],
                );
              }

              const response = yield* client.execute(clientRequest).pipe(
                Effect.mapError((cause) =>
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
              );
              const body = yield* decodeHttpClientResponseBody(response);

              if (response.status < 200 || response.status >= 300) {
                throw new OpenApiToolInvocationError({
                  operation: "http_response",
                  message: `OpenAPI request failed with HTTP ${response.status}`,
                  details: summarizeHttpResponseBody(body),
                });
              }

              return body;
            }).pipe(
              Effect.provide(httpClientLayer),
            ),
          );
        },
      },
      metadata: {
        sourceKey,
        inputType: presentation.inputType,
        outputType: presentation.outputType,
        inputSchemaJson: presentation.inputSchemaJson,
        outputSchemaJson: presentation.outputSchemaJson,
        exampleInputJson: presentation.exampleInputJson,
        exampleOutputJson: presentation.exampleOutputJson,
        providerKind: "openapi",
        providerDataJson: presentation.providerDataJson,
      },
    });
  }

  return result;
};

export const createOpenApiToolsFromSpec = (input: {
  sourceName: string;
  openApiSpec: OpenApiSpecInput;
  baseUrl: string;
  namespace?: string;
  sourceKey?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentialHeaders?: Readonly<Record<string, string>>;
  httpClientLayer?: Layer.Layer<HttpClient.HttpClient, never, never>;
}): Effect.Effect<
  { manifest: OpenApiToolManifest; definitions: Array<OpenApiToolDefinition>; tools: ToolMap },
  OpenApiExtractionError
> =>
  Effect.map(
    extractOpenApiManifest(input.sourceName, input.openApiSpec),
    (manifest: OpenApiToolManifest) => ({
      manifest,
      definitions: compileOpenApiToolDefinitions(manifest),
      tools: createOpenApiToolsFromManifest({
        manifest,
        baseUrl: input.baseUrl,
        namespace: input.namespace,
        sourceKey: input.sourceKey,
        defaultHeaders: input.defaultHeaders,
        credentialHeaders: input.credentialHeaders,
        httpClientLayer: input.httpClientLayer,
      }),
    }),
  );

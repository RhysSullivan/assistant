import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  applyCookiePlacementsToHeaders,
  applyHttpQueryPlacementsToUrl,
  applyJsonBodyPlacements,
  standardSchemaFromJsonSchema,
  toTool,
  type HttpRequestPlacements,
  type ToolMap,
  unknownInputSchema,
} from "@executor/codemode-core";

import {
  compileOpenApiToolDefinitions,
  type OpenApiToolDefinition,
} from "./openapi-definitions";
import {
  httpBodyModeFromContentType,
  serializeOpenApiParameterValue,
  serializeOpenApiRequestBody,
  withSerializedQueryEntries,
  type SerializedOpenApiQueryEntry,
} from "./openapi-http-serialization";
import { buildOpenApiToolPresentation } from "./openapi-tool-presentation";
import { resolveSchemaWithRefHints } from "./openapi-schema-refs";
import {
  extractOpenApiManifest,
  type OpenApiExtractionError,
} from "./openapi-extraction";
import {
  type OpenApiRefHintTable,
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

    const serialized = serializeOpenApiParameterValue(parameter, parameterValue);
    resolvedPath = resolvedPath.replaceAll(
      `{${parameter.name}}`,
      serialized.kind === "path"
        ? serialized.value
        : encodeURIComponent(String(parameterValue)),
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
  if (response.status === 204) {
    return Effect.succeed(null);
  }

  const bodyMode = httpBodyModeFromContentType(response.headers["content-type"]);
  if (bodyMode === "json") {
    return response.json.pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  }

  if (bodyMode === "bytes") {
    return response.arrayBuffer.pipe(
      Effect.map((buffer) => new Uint8Array(buffer)),
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

const inputSchemaFromTyping = (input: {
  inputSchema: unknown;
  refHintTable?: Readonly<OpenApiRefHintTable>;
}) => {
  const resolvedSchema = resolveSchemaWithRefHints(
    input.inputSchema,
    input.refHintTable,
  ) ?? input.inputSchema;

  if (resolvedSchema === undefined || resolvedSchema === null) {
    return unknownInputSchema;
  }

  try {
    return standardSchemaFromJsonSchema(resolvedSchema, {
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
  credentialPlacements?: HttpRequestPlacements;
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
  credentialPlacements: HttpRequestPlacements;
}): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
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
  const queryEntries: SerializedOpenApiQueryEntry[] = [];

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

    const serialized = serializeOpenApiParameterValue(parameter, parameterValue);

    if (serialized.kind === "query") {
      queryEntries.push(...serialized.entries);
    } else if (serialized.kind === "header") {
      headers[parameter.name] = serialized.value;
    } else if (serialized.kind === "cookie") {
      cookieParts.push(
        ...serialized.pairs.map((pair) =>
          `${pair.name}=${encodeURIComponent(pair.value)}`
        ),
      );
    }
  }

  if (cookieParts.length > 0) {
    headers.cookie = cookieParts.join("; ");
  }

  let body: string | Uint8Array | undefined;
  const bodyValues = input.credentialPlacements.bodyValues ?? {};
  const hasCredentialBodyValues = Object.keys(bodyValues).length > 0;

  if (input.payload.requestBody !== null) {
    if (!hasRequestBody(input.args) && !hasCredentialBodyValues) {
      if (input.payload.requestBody.required) {
        throw new OpenApiToolInvocationError({
          operation: "validate_args",
          message: "Missing required request body at args.body",
          details: input.payload.pathTemplate,
        });
      }
    } else {
      const serializedBody = serializeOpenApiRequestBody({
        requestBody: input.payload.requestBody,
        body: applyJsonBodyPlacements({
          body: hasRequestBody(input.args) ? input.args.body : {},
          bodyValues,
          label: `${input.payload.method.toUpperCase()} ${input.payload.pathTemplate}`,
        }),
      });

      body = serializedBody.body;
      headers["content-type"] = serializedBody.contentType;
    }
  }

  const urlWithAuth = applyHttpQueryPlacementsToUrl({
    url,
    queryParams: input.credentialPlacements.queryParams,
  });
  const urlWithQueryParams = withSerializedQueryEntries(urlWithAuth, queryEntries);
  const headersWithAuthCookies = applyCookiePlacementsToHeaders({
    headers,
    cookies: input.credentialPlacements.cookies,
  });

  for (const [key, value] of Object.entries(input.credentialPlacements.headers ?? {})) {
    headersWithAuthCookies[key] = value;
  }

  return {
    url: urlWithQueryParams,
    method: input.payload.method.toUpperCase(),
    headers: headersWithAuthCookies,
    body,
  };
};

const createToolPath = (namespace: string | undefined, definition: OpenApiToolDefinition): string =>
  namespace ? `${namespace}.${definition.toolId}` : definition.toolId;

export type CreateOpenApiToolFromDefinitionInput = {
  definition: OpenApiToolDefinition;
  path: string;
  sourceKey: string;
  baseUrl: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentialHeaders?: Readonly<Record<string, string>>;
  credentialPlacements?: HttpRequestPlacements;
  refHintTable?: Readonly<OpenApiRefHintTable>;
  httpClientLayer?: Layer.Layer<HttpClient.HttpClient, never, never>;
};

const normalizeCredentialPlacements = (input: {
  credentialHeaders?: Readonly<Record<string, string>>;
  credentialPlacements?: HttpRequestPlacements;
}): HttpRequestPlacements => ({
  headers: {
    ...(input.credentialHeaders ?? {}),
    ...(input.credentialPlacements?.headers ?? {}),
  },
  queryParams: input.credentialPlacements?.queryParams,
  cookies: input.credentialPlacements?.cookies,
  bodyValues: input.credentialPlacements?.bodyValues,
});

export const createOpenApiToolFromDefinition = (
  input: CreateOpenApiToolFromDefinitionInput,
) => {
  const defaultHeaders = input.defaultHeaders ?? {};
  const credentialPlacements = normalizeCredentialPlacements({
    credentialHeaders: input.credentialHeaders,
    credentialPlacements: input.credentialPlacements,
  });
  const httpClientLayer = input.httpClientLayer ?? FetchHttpClient.layer;
  const presentation = buildOpenApiToolPresentation({
    definition: input.definition,
    refHintTable: input.refHintTable,
  });

  return toTool({
    tool: {
      description: input.definition.description,
      inputSchema: inputSchemaFromTyping({
        inputSchema: presentation.inputSchema ?? input.definition.typing?.inputSchema,
        refHintTable: input.refHintTable,
      }),
      execute: async (args: unknown) => {
        const decodedArgs = asToolArgs(args);
        const request = buildFetchRequest({
          payload: input.definition.invocation,
          args: decodedArgs,
          baseUrl: input.baseUrl,
          defaultHeaders,
          credentialPlacements,
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
              clientRequest =
                request.body instanceof Uint8Array
                  ? HttpClientRequest.bodyUint8Array(
                      clientRequest,
                      request.body,
                      request.headers["content-type"],
                    )
                  : HttpClientRequest.bodyText(
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
      sourceKey: input.sourceKey,
      inputTypePreview: presentation.inputTypePreview,
      outputTypePreview: presentation.outputTypePreview,
      ...((presentation.inputSchema ?? input.definition.typing?.inputSchema) !== undefined
        ? { inputSchema: presentation.inputSchema ?? input.definition.typing?.inputSchema }
        : {}),
      ...((presentation.outputSchema ?? input.definition.typing?.outputSchema) !== undefined
        ? { outputSchema: presentation.outputSchema ?? input.definition.typing?.outputSchema }
        : {}),
      ...(presentation.exampleInput !== undefined
        ? { exampleInput: presentation.exampleInput }
        : {}),
      ...(presentation.exampleOutput !== undefined
        ? { exampleOutput: presentation.exampleOutput }
        : {}),
      providerKind: "openapi",
      providerData: presentation.providerData,
    },
  });
};

export const createOpenApiToolsFromManifest = (
  input: CreateOpenApiToolsFromManifestInput,
): ToolMap => {
  const baseUrl = normalizeHttpUrl(input.baseUrl);
  const sourceKey = input.sourceKey ?? "openapi.generated";
  const defaultHeaders = input.defaultHeaders ?? {};
  const httpClientLayer = input.httpClientLayer ?? FetchHttpClient.layer;

  const definitions = compileOpenApiToolDefinitions(input.manifest);
  const result: ToolMap = {};

  for (const definition of definitions) {
    const toolPath = createToolPath(input.namespace, definition);
    result[toolPath] = createOpenApiToolFromDefinition({
      definition,
      path: toolPath,
      sourceKey,
      baseUrl,
      defaultHeaders,
      credentialHeaders: input.credentialHeaders,
      credentialPlacements: input.credentialPlacements,
      refHintTable: input.manifest.refHintTable,
      httpClientLayer,
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
  credentialPlacements?: HttpRequestPlacements;
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
        credentialPlacements: input.credentialPlacements,
        httpClientLayer: input.httpClientLayer,
      }),
    }),
  );

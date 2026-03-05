import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { toTool, type ToolMap } from "@executor-v3/codemode-core";

import {
  extractOpenApiManifest,
  type OpenApiExtractionError,
} from "./openapi-extraction";
import {
  type OpenApiInvocationPayload,
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

  if (unresolvedPathParameters.length > 0) {
    const names = [...new Set(unresolvedPathParameters)].sort().join(", ");
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

const decodeFetchResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
};

type CreateOpenApiToolsFromManifestInput = {
  manifest: OpenApiToolManifest;
  baseUrl: string;
  namespace?: string;
  sourceKey?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentialHeaders?: Readonly<Record<string, string>>;
};

const buildFetchRequest = (input: {
  payload: OpenApiInvocationPayload;
  args: OpenApiToolArgs;
  baseUrl: string;
  defaultHeaders: Readonly<Record<string, string>>;
  credentialHeaders: Readonly<Record<string, string>>;
}): {
  url: URL;
  init: RequestInit;
} => {
  const resolvedPath = replacePathTemplate(
    input.payload.pathTemplate,
    input.args,
    input.payload,
  );
  const url = new URL(resolvedPath, input.baseUrl);

  const headers = new Headers(input.defaultHeaders);
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
      headers.set(parameter.name, encoded);
    } else if (parameter.location === "cookie") {
      cookieParts.push(`${parameter.name}=${encodeURIComponent(encoded)}`);
    }
  }

  if (cookieParts.length > 0) {
    headers.set("cookie", cookieParts.join("; "));
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
        headers.set("content-type", preferredContentType);
      } else if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
  }

  for (const [key, value] of Object.entries(input.credentialHeaders)) {
    headers.set(key, value);
  }

  return {
    url,
    init: {
      method: input.payload.method.toUpperCase(),
      headers,
      body,
    },
  };
};

export const createOpenApiToolsFromManifest = (
  input: CreateOpenApiToolsFromManifestInput,
): ToolMap => {
  const baseUrl = normalizeHttpUrl(input.baseUrl);
  const sourceKey = input.sourceKey ?? "openapi.generated";
  const namespace = input.namespace;
  const defaultHeaders = input.defaultHeaders ?? {};
  const credentialHeaders = input.credentialHeaders ?? {};

  const result: ToolMap = {};

  for (const extracted of input.manifest.tools) {
    const toolPath = namespace
      ? `${namespace}.${extracted.toolId}`
      : extracted.toolId;

    const description = extracted.description ?? `${extracted.method.toUpperCase()} ${extracted.path}`;
    result[toolPath] = toTool({
      tool: {
        description,
        execute: async (args: unknown) => {
          const decodedArgs = asToolArgs(args);
          const request = buildFetchRequest({
            payload: extracted.invocation,
            args: decodedArgs,
            baseUrl,
            defaultHeaders,
            credentialHeaders,
          });

          const response = await fetch(request.url, request.init);
          const body = await decodeFetchResponseBody(response);

          return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body,
          };
        },
      },
      metadata: {
        sourceKey,
        inputSchemaJson: extracted.typing?.inputSchemaJson,
        outputSchemaJson: extracted.typing?.outputSchemaJson,
        refHintKeys: extracted.typing?.refHintKeys,
      },
    });
  }

  return result;
};

export const createOpenApiToolsFromSpec = (input: {
  sourceName: string;
  openApiSpec: unknown;
  baseUrl: string;
  namespace?: string;
  sourceKey?: string;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentialHeaders?: Readonly<Record<string, string>>;
}): Effect.Effect<
  { manifest: OpenApiToolManifest; tools: ToolMap },
  OpenApiExtractionError
> =>
  Effect.map(
    extractOpenApiManifest(input.sourceName, input.openApiSpec),
    (manifest: OpenApiToolManifest) => ({
    manifest,
    tools: createOpenApiToolsFromManifest({
      manifest,
      baseUrl: input.baseUrl,
      namespace: input.namespace,
      sourceKey: input.sourceKey,
      defaultHeaders: input.defaultHeaders,
      credentialHeaders: input.credentialHeaders,
    }),
  }));

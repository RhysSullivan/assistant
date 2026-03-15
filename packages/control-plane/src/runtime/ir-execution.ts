import {
  applyCookiePlacementsToHeaders,
  applyHttpQueryPlacementsToUrl,
  applyJsonBodyPlacements,
} from "@executor/codemode-core";
import {
  createMcpToolsFromManifest,
  createSdkMcpConnector,
} from "@executor/codemode-mcp";
import type { AccountId, Source } from "#schema";
import * as Effect from "effect/Effect";

import type {
  OnElicitation,
  ToolExecutionContext,
  ToolInput,
  ToolPath,
} from "@executor/codemode-core";
import type { CatalogV1, Capability, Executable, GraphQLExecutable, HttpExecutable, McpExecutable, ParameterSymbol } from "../ir/model";
import type { LoadedSourceCatalogToolIndexEntry } from "./source-catalog-runtime";
import type { ResolvedSourceAuthMaterial } from "./source-auth-material";

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asStringRecord = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asObject(value)).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : []),
  );

const readSourceHeaders = (source: Source): Record<string, string> => {
  const binding = asObject(source.binding);
  const defaultHeaders = binding.defaultHeaders ?? binding.headers;
  return asStringRecord(defaultHeaders);
};

const readSourceQueryParams = (source: Source): Record<string, string> =>
  asStringRecord(asObject(source.binding).queryParams);

const readSourceTransport = (source: Source): "auto" | "streamable-http" | "sse" | undefined => {
  const transport = asString(asObject(source.binding).transport);
  if (transport === "streamable-http" || transport === "sse" || transport === "auto") {
    return transport;
  }
  return undefined;
};

const summarizeHttpBody = (body: unknown): string => {
  if (typeof body === "string") {
    return body.slice(0, 400);
  }
  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return String(body);
  }
};

const decodeFetchBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  if (response.status === 204) {
    return null;
  }
  return response.text();
};

const primitiveString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

const parameterById = (catalog: CatalogV1, parameterId: string): ParameterSymbol | undefined => {
  const symbol = catalog.symbols[parameterId];
  return symbol?.kind === "parameter" ? symbol : undefined;
};

const httpParameterLookupMode = (catalog: CatalogV1, executable: HttpExecutable): "flat" | "grouped" => {
  const reserved = new Set(["body", "args", "select", "path", "query", "headers", "cookies"]);
  const allParameters = [
    ...(executable.pathParameterIds ?? []),
    ...(executable.queryParameterIds ?? []),
    ...(executable.headerParameterIds ?? []),
    ...(executable.cookieParameterIds ?? []),
  ]
    .map((parameterId) => parameterById(catalog, parameterId))
    .filter((parameter): parameter is ParameterSymbol => parameter !== undefined);

  const names = allParameters.map((parameter) => parameter.name);
  const hasCollision = names.some((name, index) =>
    reserved.has(name) || names.findIndex((candidate) => candidate === name) !== index
  );

  return hasCollision ? "grouped" : "flat";
};

const readHttpParameterValue = (input: {
  catalog: CatalogV1;
  executable: HttpExecutable;
  parameter: ParameterSymbol;
  args: Record<string, unknown>;
}): unknown => {
  const mode = httpParameterLookupMode(input.catalog, input.executable);
  if (mode === "flat") {
    return input.args[input.parameter.name];
  }

  const groupKey =
    input.parameter.location === "header"
      ? "headers"
      : input.parameter.location === "cookie"
        ? "cookies"
        : input.parameter.location;
  return asObject(input.args[groupKey])[input.parameter.name];
};

const resolveHttpBaseUrl = (source: Source, executable: HttpExecutable): URL => {
  const googleBlob = executable.native?.find(
    (blob) => blob.kind === "google_discovery_provider_data",
  );
  if (googleBlob) {
    const providerData = googleBlob.value as {
      invocation?: { rootUrl?: string; servicePath?: string };
    } | null;
    const rootUrl = providerData?.invocation?.rootUrl;
    if (rootUrl) {
      const servicePath = providerData?.invocation?.servicePath ?? "";
      return new URL(servicePath || "", rootUrl);
    }
  }
  return new URL(source.endpoint);
};

const executeHttp = (input: {
  source: Source;
  catalog: CatalogV1;
  executable: HttpExecutable;
  auth: ResolvedSourceAuthMaterial;
  args: unknown;
}) =>
  Effect.tryPromise({
    try: async () => {
      const argsRecord = asObject(input.args);
      let resolvedPath = input.executable.pathTemplate;
      const url = applyHttpQueryPlacementsToUrl({
        url: resolveHttpBaseUrl(input.source, input.executable),
        queryParams: readSourceQueryParams(input.source),
      });
      const headers: Record<string, string> = {
        ...readSourceHeaders(input.source),
      };
      const cookies: Record<string, string> = {};

      const allParameterIds = [
        ...(input.executable.pathParameterIds ?? []),
        ...(input.executable.queryParameterIds ?? []),
        ...(input.executable.headerParameterIds ?? []),
        ...(input.executable.cookieParameterIds ?? []),
      ];

      for (const parameterId of allParameterIds) {
        const parameter = parameterById(input.catalog, parameterId);
        if (!parameter) {
          continue;
        }

        const value = readHttpParameterValue({
          catalog: input.catalog,
          executable: input.executable,
          parameter,
          args: argsRecord,
        });
        if (value === undefined || value === null) {
          if (parameter.required) {
            throw new Error(`Missing required ${parameter.location} parameter ${parameter.name}`);
          }
          continue;
        }

        if (parameter.location === "path") {
          resolvedPath = resolvedPath.replace(
            new RegExp(`{${parameter.name}}`, "g"),
            encodeURIComponent(primitiveString(value)),
          );
          continue;
        }

        if (parameter.location === "query") {
          if (Array.isArray(value)) {
            for (const entry of value) {
              url.searchParams.append(parameter.name, primitiveString(entry));
            }
          } else {
            url.searchParams.set(parameter.name, primitiveString(value));
          }
          continue;
        }

        if (parameter.location === "header") {
          headers[parameter.name] = primitiveString(value);
          continue;
        }

        if (parameter.location === "cookie") {
          cookies[parameter.name] = primitiveString(value);
        }
      }

      const bodySymbol = input.executable.requestBodyId
        ? input.catalog.symbols[input.executable.requestBodyId]
        : undefined;
      let body: string | undefined;
      if (bodySymbol?.kind === "requestBody") {
        const bodyValue = argsRecord.body ?? argsRecord.input;
        if (bodyValue !== undefined) {
          const contentType = bodySymbol.contents[0]?.mediaType ?? "application/json";
          headers["content-type"] = contentType;
          body = JSON.stringify(
            applyJsonBodyPlacements({
              body: bodyValue,
              bodyValues: input.auth.bodyValues,
              label: `${input.executable.method} ${input.executable.pathTemplate}`,
            }),
          );
        }
      }

      const requestUrl = new URL(resolvedPath, url);
      const urlWithAuth = applyHttpQueryPlacementsToUrl({
        url: requestUrl,
        queryParams: input.auth.queryParams,
      });
      const headersWithCookies = applyCookiePlacementsToHeaders({
        headers: {
          ...headers,
          ...input.auth.headers,
        },
        cookies: {
          ...cookies,
          ...input.auth.cookies,
        },
      });

      const response = await fetch(urlWithAuth, {
        method: input.executable.method,
        headers: headersWithCookies,
        ...(body !== undefined ? { body } : {}),
      });
      const responseBody = await decodeFetchBody(response);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${summarizeHttpBody(responseBody)}`);
      }

      return responseBody;
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

const graphqlSelectionFromArgs = (value: unknown): string => {
  const record = asObject(value);
  const fields = Object.entries(record).flatMap(([key, entry]) => {
    if (entry === true) {
      return [key];
    }
    if (entry && typeof entry === "object") {
      const child = graphqlSelectionFromArgs(entry);
      return child.length > 0 ? [`${key} { ${child} }`] : [];
    }
    return [];
  });
  return fields.join(" ");
};

const graphqlArgsPayload = (input: {
  catalog: CatalogV1;
  executable: GraphQLExecutable;
  args: Record<string, unknown>;
}): Record<string, unknown> => {
  const argumentShape = input.catalog.symbols[input.executable.argumentShapeId];
  const reserved = new Set(["body", "args", "select", "path", "query", "headers", "cookies"]);
  if (
    argumentShape?.kind === "shape"
    && argumentShape.node.type === "object"
    && Object.keys(argumentShape.node.fields).every((name) => !reserved.has(name))
  ) {
    return Object.fromEntries(
      Object.entries(input.args).filter(([key]) => key !== "select" && key !== "headers"),
    );
  }

  return asObject(input.args.args);
};

const executeGraphql = (input: {
  source: Source;
  catalog: CatalogV1;
  executable: GraphQLExecutable;
  auth: ResolvedSourceAuthMaterial;
  args: unknown;
}) =>
  Effect.tryPromise({
    try: async () => {
      const argsRecord = asObject(input.args);
      const native = input.executable.native?.[0]?.value as Record<string, unknown> | undefined;
      const requestHeaders = {
        ...readSourceHeaders(input.source),
        ...input.auth.headers,
        ...asStringRecord(argsRecord.headers),
        "content-type": "application/json",
      };
      const queryParams = {
        ...readSourceQueryParams(input.source),
        ...input.auth.queryParams,
      };
      const endpoint = applyHttpQueryPlacementsToUrl({
        url: input.source.endpoint,
        queryParams,
      }).toString();

      const toolKind = asString(native?.toolKind);
      if (toolKind === "request" || !native || !asString(native.operationDocument)) {
        const query = asString(argsRecord.query);
        if (query === null) {
          throw new Error(`GraphQL request tools require args.query`);
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: applyCookiePlacementsToHeaders({
            headers: requestHeaders,
            cookies: input.auth.cookies,
          }),
          body: JSON.stringify({
            query,
            ...(argsRecord.variables ? { variables: asObject(argsRecord.variables) } : {}),
            ...(asString(argsRecord.operationName) ? { operationName: asString(argsRecord.operationName)! } : {}),
          }),
        });
        const body = await decodeFetchBody(response);
        if (!response.ok) {
          throw new Error(`GraphQL HTTP ${response.status}: ${summarizeHttpBody(body)}`);
        }
        return body;
      }

      const operationDocument = asString(native.operationDocument)!;
      const operationName = asString(native.operationName) ?? undefined;
      const variables = graphqlArgsPayload({
        catalog: input.catalog,
        executable: input.executable,
        args: argsRecord,
      });

      const query =
        input.executable.selectionMode === "caller"
          ? (() => {
              const selection = graphqlSelectionFromArgs(argsRecord.select);
              if (selection.length === 0) {
                throw new Error(`GraphQL caller selection tools require args.select`);
              }
              return `${input.executable.operationType} ${input.executable.rootField} { ${input.executable.rootField} ${selection ? `{ ${selection} }` : ""} }`;
            })()
          : operationDocument;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: applyCookiePlacementsToHeaders({
          headers: requestHeaders,
          cookies: input.auth.cookies,
        }),
        body: JSON.stringify({
          query,
          variables,
          ...(operationName ? { operationName } : {}),
        }),
      });
      const body = asObject(await decodeFetchBody(response));
      if (!response.ok) {
        throw new Error(`GraphQL HTTP ${response.status}: ${summarizeHttpBody(body)}`);
      }

      const errors = Array.isArray(body.errors) ? body.errors : [];
      const data = asObject(body.data);
      const fieldName = asString(native.fieldName) ?? input.executable.rootField;
      return {
        data: data[fieldName] ?? null,
        errors,
        isError: errors.length > 0,
      };
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

const executeMcp = (input: {
  source: Source;
  catalog: CatalogV1;
  tool: LoadedSourceCatalogToolIndexEntry;
  executable: McpExecutable;
  auth: ResolvedSourceAuthMaterial;
  args: unknown;
  onElicitation?: OnElicitation;
  context?: Record<string, unknown>;
}) =>
  Effect.tryPromise({
    try: async () => {
      const inputShape = input.executable.inputShapeId
        ? input.catalog.symbols[input.executable.inputShapeId]
        : undefined;
      const payload =
        inputShape?.kind === "shape" && inputShape.node.type !== "object"
          ? asObject(input.args).input
          : input.args;
      const connector = createSdkMcpConnector({
        endpoint: input.source.endpoint,
        transport: readSourceTransport(input.source),
        queryParams: {
          ...readSourceQueryParams(input.source),
          ...input.auth.queryParams,
        },
        headers: applyCookiePlacementsToHeaders({
          headers: {
            ...readSourceHeaders(input.source),
            ...input.auth.headers,
          },
          cookies: input.auth.cookies,
        }),
      });
      const tools = createMcpToolsFromManifest({
        manifest: {
          version: 1,
          tools: [{
            toolId: input.executable.toolName,
            toolName: input.executable.toolName,
            description:
              input.tool.capability.surface.summary
              ?? input.tool.capability.surface.title
              ?? `MCP tool: ${input.executable.toolName}`,
            inputSchema: input.tool.descriptor.inputSchema,
            outputSchema: input.tool.descriptor.outputSchema,
          }],
        },
        connect: connector,
        sourceKey: input.source.id,
      });
      const entry = tools[input.executable.toolName] as ToolInput | undefined;
      const definition =
        entry && typeof entry === "object" && entry !== null && "tool" in entry
          ? entry.tool
          : entry;

      if (!definition) {
        throw new Error(`Missing MCP tool definition for ${input.executable.toolName}`);
      }

      const executionContext: ToolExecutionContext | undefined =
        input.onElicitation
          ? {
              path: input.tool.path as ToolPath,
              sourceKey: input.source.id,
              metadata: {
                sourceKey: input.source.id,
                interaction: input.tool.descriptor.interaction,
                inputSchema: input.tool.descriptor.inputSchema,
                outputSchema: input.tool.descriptor.outputSchema,
                providerKind: input.tool.descriptor.providerKind,
                providerData: input.tool.descriptor.providerData,
              },
              invocation: input.context,
              onElicitation: input.onElicitation,
            }
          : undefined;

      return await definition.execute(asObject(payload), executionContext);
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

export const invocationDescriptorFromTool = (input: {
  tool: LoadedSourceCatalogToolIndexEntry;
}): {
  toolPath: string;
  sourceId: Source["id"];
  sourceName: Source["name"];
  sourceKind: Source["kind"];
  sourceNamespace: string | null;
  operationKind: "read" | "write" | "delete" | "execute" | "unknown";
  interaction: "auto" | "required";
  approvalLabel: string | null;
} => ({
  toolPath: input.tool.path,
  sourceId: input.tool.source.id,
  sourceName: input.tool.source.name,
  sourceKind: input.tool.source.kind,
  sourceNamespace:
    input.tool.source.namespace ?? null,
  operationKind:
    input.tool.capability.semantics.effect === "read"
      ? "read"
      : input.tool.capability.semantics.effect === "write"
        ? "write"
        : input.tool.capability.semantics.effect === "delete"
          ? "delete"
          : input.tool.capability.semantics.effect === "action"
            ? "execute"
            : "unknown",
  interaction: input.tool.descriptor.interaction ?? "auto",
  approvalLabel: input.tool.capability.surface.title ?? null,
});

export const invokeIrTool = (input: {
  workspaceId: Source["workspaceId"];
  accountId: AccountId;
  tool: LoadedSourceCatalogToolIndexEntry;
  auth: ResolvedSourceAuthMaterial;
  args: unknown;
  onElicitation?: OnElicitation;
  context?: Record<string, unknown>;
}) => {
  switch (input.tool.executable.protocol) {
    case "http":
      return executeHttp({
        source: input.tool.source,
        catalog: input.tool.projectedCatalog,
        executable: input.tool.executable,
        auth: input.auth,
        args: input.args,
      });
    case "graphql":
      return executeGraphql({
        source: input.tool.source,
        catalog: input.tool.projectedCatalog,
        executable: input.tool.executable,
        auth: input.auth,
        args: input.args,
      });
    case "mcp":
      return executeMcp({
        source: input.tool.source,
        catalog: input.tool.projectedCatalog,
        tool: input.tool,
        executable: input.tool.executable,
        auth: input.auth,
        args: input.args,
        onElicitation: input.onElicitation,
        context: input.context,
      });
  }
};

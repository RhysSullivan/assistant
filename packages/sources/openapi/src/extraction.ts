import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

import { parseOpenApiDocument } from "./document";
import { extractOpenApiManifestJsonWithWasm } from "./extractor-wasm";
import {
  OpenApiToolManifestSchema,
  type OpenApiExtractedTool,
  type OpenApiHeader,
  type OpenApiSecurityRequirement,
  type OpenApiServer,
  type OpenApiJsonObject,
  type OpenApiSpecInput,
  type OpenApiToolManifest,
} from "./types";

type OpenApiExtractionStage = "validate" | "extract";

export class OpenApiExtractionError extends Data.TaggedError("OpenApiExtractionError")<{
  sourceName: string;
  stage: OpenApiExtractionStage;
  message: string;
  details: string | null;
}> {}

const manifestFromJsonSchema = Schema.parseJson(OpenApiToolManifestSchema);
const decodeManifestFromJson = Schema.decodeUnknown(manifestFromJsonSchema);

const toExtractionError = (
  sourceName: string,
  stage: OpenApiExtractionStage,
  cause: unknown,
): OpenApiExtractionError =>
  cause instanceof OpenApiExtractionError
    ? cause
    : new OpenApiExtractionError({
        sourceName,
        stage,
        message: "OpenAPI extraction failed",
        details: ParseResult.isParseError(cause)
          ? ParseResult.TreeFormatter.formatErrorSync(cause)
          : String(cause),
      });

const normalizeOpenApiDocumentText = (
  sourceName: string,
  openApiSpec: OpenApiSpecInput,
): Effect.Effect<string, OpenApiExtractionError> => {
  if (typeof openApiSpec === "string") {
    return Effect.succeed(openApiSpec);
  }

  return Effect.try({
    try: () => JSON.stringify(openApiSpec),
    catch: (cause) =>
      new OpenApiExtractionError({
        sourceName,
        stage: "validate",
        message: "Unable to serialize OpenAPI input",
        details: String(cause),
      }),
  });
};

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [];

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }

  return value;
};

const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(stableJsonValue(value));

const collectRefKeys = (
  value: unknown,
  refs: Set<string>,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefKeys(item, refs);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
    refs.add(record.$ref);
  }

  for (const nested of Object.values(record)) {
    collectRefKeys(nested, refs);
  }
};

const resolvePointerSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

const resolveLocalRef = (
  document: OpenApiJsonObject,
  value: unknown,
  activeRefs: ReadonlySet<string> = new Set<string>(),
): unknown => {
  const object = asObject(value);
  const ref = typeof object.$ref === "string" ? object.$ref : null;
  if (!ref || !ref.startsWith("#/") || activeRefs.has(ref)) {
    return value;
  }

  const resolved = ref
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) => {
      if (current === undefined || current === null) {
        return undefined;
      }

      return asObject(current)[resolvePointerSegment(segment)];
    }, document);

  if (resolved === undefined) {
    return value;
  }

  const nextActiveRefs = new Set(activeRefs);
  nextActiveRefs.add(ref);

  const resolvedObject = asObject(resolveLocalRef(document, resolved, nextActiveRefs));
  const { $ref: _ignoredRef, ...rest } = object;

  return Object.keys(rest).length > 0
    ? { ...resolvedObject, ...rest }
    : resolvedObject;
};

const responseStatusRank = (statusCode: string): number => {
  if (/^2\d\d$/.test(statusCode)) {
    return 0;
  }

  if (statusCode === "default") {
    return 1;
  }

  return 2;
};

const preferredContentEntry = (
  content: unknown,
): readonly [string, Record<string, unknown>] | undefined => {
  const entries = Object.entries(asObject(content))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mediaType, value]) => [mediaType, asObject(value)] as const);

  return entries.find(([mediaType]) => mediaType === "application/json")
    ?? entries.find(([mediaType]) => mediaType.toLowerCase().includes("+json"))
    ?? entries.find(([mediaType]) => mediaType.toLowerCase().includes("json"))
    ?? entries[0];
};

const contentSchemaFromOperationContent = (
  content: unknown,
): unknown | undefined => {
  return preferredContentEntry(content)?.[1].schema;
};

const contentEntriesFromContent = (
  document: OpenApiJsonObject,
  content: unknown,
): ReadonlyArray<{
  mediaType: string;
  schema?: unknown;
  examples?: Array<{
    valueJson: string;
    mediaType?: string;
    label?: string;
  }>;
}> => {
  const entries = Object.entries(asObject(content))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mediaType, mediaValue]) => {
      const mediaRecord = asObject(resolveLocalRef(document, mediaValue));
      const examples = examplesFromMediaType(mediaType, mediaRecord);

      return {
        mediaType,
        ...(mediaRecord.schema !== undefined ? { schema: mediaRecord.schema } : {}),
        ...(examples.length > 0 ? { examples } : {}),
      };
    });

  return entries;
};

const examplesFromValue = (
  value: unknown,
  input: {
    label?: string;
    mediaType?: string;
  } = {},
): Array<{
  valueJson: string;
  mediaType?: string;
  label?: string;
}> => {
  const record = asObject(value);
  const examples: Array<{
    valueJson: string;
    mediaType?: string;
    label?: string;
  }> = [];

  if (record.example !== undefined) {
    examples.push({
      valueJson: stableJsonStringify(record.example),
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(input.label ? { label: input.label } : {}),
    });
  }

  const exampleEntries = Object.entries(asObject(record.examples))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [key, exampleValue] of exampleEntries) {
    const exampleRecord = asObject(exampleValue);
    examples.push({
      valueJson: stableJsonStringify(
        exampleRecord.value !== undefined ? exampleRecord.value : exampleValue,
      ),
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      label: key,
    });
  }

  return examples;
};

const examplesFromSchema = (
  schema: unknown,
): Array<{
  valueJson: string;
  mediaType?: string;
  label?: string;
}> => examplesFromValue(schema);

const examplesFromMediaType = (
  mediaType: string,
  mediaTypeRecord: Record<string, unknown>,
): Array<{
  valueJson: string;
  mediaType?: string;
  label?: string;
}> => {
  const direct = examplesFromValue(mediaTypeRecord, { mediaType });
  if (direct.length > 0) {
    return direct;
  }

  return examplesFromSchema(mediaTypeRecord.schema).map((example) => ({
    ...example,
    mediaType,
  }));
};

const headerFromValue = (
  document: OpenApiJsonObject,
  name: string,
  value: unknown,
): OpenApiHeader | undefined => {
  const header = asObject(resolveLocalRef(document, value));
  if (Object.keys(header).length === 0) {
    return undefined;
  }

  const content = contentEntriesFromContent(document, header.content);
  const directExamples =
    content.length > 0
      ? []
      : examplesFromValue(header);

  return {
    name,
    ...(asTrimmedString(header.description)
      ? { description: asTrimmedString(header.description) }
      : {}),
    ...(typeof header.required === "boolean" ? { required: header.required } : {}),
    ...(typeof header.deprecated === "boolean" ? { deprecated: header.deprecated } : {}),
    ...(header.schema !== undefined ? { schema: header.schema } : {}),
    ...(content.length > 0 ? { content } : {}),
    ...(asTrimmedString(header.style)
      ? { style: asTrimmedString(header.style) }
      : {}),
    ...(typeof header.explode === "boolean" ? { explode: header.explode } : {}),
    ...(directExamples.length > 0 ? { examples: directExamples } : {}),
  };
};

const headersFromValue = (
  document: OpenApiJsonObject,
  value: unknown,
): ReadonlyArray<OpenApiHeader> => Object.entries(asObject(value))
  .sort(([left], [right]) => left.localeCompare(right))
  .flatMap(([name, headerValue]) => {
    const header = headerFromValue(document, name, headerValue);
    return header ? [header] : [];
  });

const serversFromValue = (
  value: unknown,
): ReadonlyArray<OpenApiServer> =>
  asArray(value)
    .map((entry) => asObject(entry))
    .flatMap((server) => {
      const url = asTrimmedString(server.url);
      if (!url) {
        return [];
      }

      const variables = Object.fromEntries(
        Object.entries(asObject(server.variables))
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([name, variableValue]) => {
            const variableRecord = asObject(variableValue);
            const defaultValue = asTrimmedString(variableRecord.default);
            return defaultValue ? [[name, defaultValue] as const] : [];
          }),
      );

      return [{
        url,
        ...(asTrimmedString(server.description)
          ? { description: asTrimmedString(server.description) }
          : {}),
        ...(Object.keys(variables).length > 0 ? { variables } : {}),
      }];
    });

const pathItemForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): Record<string, unknown> =>
  asObject(asObject(document.paths)[tool.path]);

const parameterKey = (input: {
  location: string;
  name: string;
}): string => `${input.location}:${input.name}`;

const parameterRecordMapForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): ReadonlyMap<string, Record<string, unknown>> => {
  const merged = new Map<string, Record<string, unknown>>();
  const pathItem = pathItemForTool(document, tool);
  const operation = operationForTool(document, tool);

  for (const parameterValue of asArray(pathItem.parameters)) {
    const parameter = asObject(resolveLocalRef(document, parameterValue));
    const name = asTrimmedString(parameter.name);
    const location = asTrimmedString(parameter.in);
    if (!name || !location) {
      continue;
    }

    merged.set(parameterKey({ location, name }), parameter);
  }

  for (const parameterValue of asArray(operation.parameters)) {
    const parameter = asObject(resolveLocalRef(document, parameterValue));
    const name = asTrimmedString(parameter.name);
    const location = asTrimmedString(parameter.in);
    if (!name || !location) {
      continue;
    }

    merged.set(parameterKey({ location, name }), parameter);
  }

  return merged;
};

const operationForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): Record<string, unknown> =>
  asObject(
    asObject(asObject(document.paths)[tool.path])[tool.method],
  );

const requestBodySchemaForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): unknown | undefined => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return undefined;
  }

  const requestBody = resolveLocalRef(document, operation.requestBody);
  return contentSchemaFromOperationContent(asObject(requestBody).content);
};

const requestBodyPayloadForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): OpenApiExtractedTool["invocation"]["requestBody"] => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return tool.invocation.requestBody;
  }

  const requestBody = asObject(resolveLocalRef(document, operation.requestBody));
  if (Object.keys(requestBody).length === 0) {
    return tool.invocation.requestBody;
  }

  const contents = contentEntriesFromContent(document, requestBody.content);
  const contentTypes = contents.map((content) => content.mediaType);

  return {
    required:
      typeof requestBody.required === "boolean"
        ? requestBody.required
        : (tool.invocation.requestBody?.required ?? false),
    contentTypes,
    ...(contents.length > 0 ? { contents } : {}),
  };
};

const responseSchemaForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): unknown | undefined => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return undefined;
  }

  const responseEntries = Object.entries(asObject(operation.responses));
  const preferredResponses = responseEntries
    .filter(([status]) => /^2\d\d$/.test(status))
    .sort(([left], [right]) => left.localeCompare(right));
  const fallbackResponses = responseEntries.filter(([status]) => status === "default");

  for (const [, responseValue] of [...preferredResponses, ...fallbackResponses]) {
    const response = resolveLocalRef(document, responseValue);
    const schema = contentSchemaFromOperationContent(asObject(response).content);
    if (schema !== undefined) {
      return schema;
    }
  }

  return undefined;
};

const responseVariantsForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): OpenApiExtractedTool["responses"] => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return undefined;
  }

  const responseEntries = Object.entries(asObject(operation.responses))
    .sort(([left], [right]) =>
      responseStatusRank(left) - responseStatusRank(right) || left.localeCompare(right),
    );

  const responses = responseEntries.map(([statusCode, responseValue]) => {
    const response = asObject(resolveLocalRef(document, responseValue));
    const contents = contentEntriesFromContent(document, response.content);
    const contentTypes = contents.map((content) => content.mediaType);
    const preferredContent = preferredContentEntry(response.content);
    const examples = preferredContent
      ? examplesFromMediaType(preferredContent[0], preferredContent[1])
      : [];
    const headers = headersFromValue(document, response.headers);

    return {
      statusCode,
      ...(asTrimmedString(response.description)
        ? { description: asTrimmedString(response.description) }
        : {}),
      contentTypes,
      ...(contentSchemaFromOperationContent(response.content) !== undefined
        ? { schema: contentSchemaFromOperationContent(response.content) }
        : {}),
      ...(examples.length > 0 ? { examples } : {}),
      ...(contents.length > 0 ? { contents } : {}),
      ...(headers.length > 0 ? { headers } : {}),
    };
  });

  return responses.length > 0 ? responses : undefined;
};

const documentServersFromDocument = (
  document: OpenApiJsonObject,
): OpenApiExtractedTool["documentServers"] => {
  const servers = serversFromValue(document.servers);
  return servers.length > 0 ? servers : undefined;
};

const operationServersForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): OpenApiExtractedTool["servers"] => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return undefined;
  }

  const operationServers = serversFromValue(operation.servers);
  if (operationServers.length > 0) {
    return operationServers;
  }

  const pathItemServers = serversFromValue(pathItemForTool(document, tool).servers);
  return pathItemServers.length > 0 ? pathItemServers : undefined;
};

const securityRequirementFromValue = (
  value: unknown,
): OpenApiSecurityRequirement | undefined => {
  const requirementEntries = asArray(value);
  if (requirementEntries.length === 0) {
    return {
      kind: "none",
    };
  }

  const anyOfItems = requirementEntries.flatMap((entry) => {
    const schemes = Object.entries(asObject(entry))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([schemeName, rawScopes]) => {
        const scopes = asArray(rawScopes)
          .flatMap((scope) =>
            typeof scope === "string" && scope.trim().length > 0
              ? [scope.trim()]
              : [],
          );

        return {
          kind: "scheme" as const,
          schemeName,
          ...(scopes.length > 0 ? { scopes } : {}),
        };
      });

    if (schemes.length === 0) {
      return [];
    }

    return [
      schemes.length === 1
        ? schemes[0]!
        : {
            kind: "allOf" as const,
            items: schemes,
          },
    ];
  });

  if (anyOfItems.length === 0) {
    return undefined;
  }

  return anyOfItems.length === 1
    ? anyOfItems[0]
    : {
        kind: "anyOf",
        items: anyOfItems,
      };
};

const authRequirementForTool = (
  document: OpenApiJsonObject,
  tool: OpenApiExtractedTool,
): OpenApiSecurityRequirement | undefined => {
  const operation = operationForTool(document, tool);
  if (Object.keys(operation).length === 0) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(operation, "security")) {
    return securityRequirementFromValue(operation.security);
  }

  return securityRequirementFromValue(document.security);
};

const collectReferencedSecuritySchemeNames = (
  authRequirement: OpenApiSecurityRequirement | undefined,
  names: Set<string>,
): void => {
  if (!authRequirement) {
    return;
  }

  switch (authRequirement.kind) {
    case "none":
      return;
    case "scheme":
      names.add(authRequirement.schemeName);
      return;
    case "allOf":
    case "anyOf":
      for (const item of authRequirement.items) {
        collectReferencedSecuritySchemeNames(item, names);
      }
  }
};

const oauthFlowRecord = (
  value: unknown,
): Record<string, {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes?: Record<string, string>;
}> | undefined => {
  const result = Object.fromEntries(
    Object.entries(asObject(value))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([flowName, flowValue]) => {
        const flowRecord = asObject(flowValue);
        const scopes = Object.fromEntries(
          Object.entries(asObject(flowRecord.scopes))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([scope, description]) => [scope, asTrimmedString(description) ?? ""]),
        );

        return [flowName, {
          ...(asTrimmedString(flowRecord.authorizationUrl)
            ? { authorizationUrl: asTrimmedString(flowRecord.authorizationUrl) }
            : {}),
          ...(asTrimmedString(flowRecord.tokenUrl)
            ? { tokenUrl: asTrimmedString(flowRecord.tokenUrl) }
            : {}),
          ...(asTrimmedString(flowRecord.refreshUrl)
            ? { refreshUrl: asTrimmedString(flowRecord.refreshUrl) }
            : {}),
          ...(Object.keys(scopes).length > 0 ? { scopes } : {}),
        }];
      }),
  );

  return Object.keys(result).length > 0 ? result : undefined;
};

const securitySchemesForTool = (
  document: OpenApiJsonObject,
  authRequirement: OpenApiSecurityRequirement | undefined,
): OpenApiExtractedTool["securitySchemes"] => {
  if (!authRequirement || authRequirement.kind === "none") {
    return undefined;
  }

  const schemeNames = new Set<string>();
  collectReferencedSecuritySchemeNames(authRequirement, schemeNames);

  const securitySchemes = asObject(asObject(document.components).securitySchemes);
  const resolved = [...schemeNames]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((schemeName) => {
      const rawScheme = securitySchemes[schemeName];
      if (rawScheme === undefined) {
        return [];
      }

      const scheme = asObject(resolveLocalRef(document, rawScheme));
      const schemeType = asTrimmedString(scheme.type);
      if (!schemeType) {
        return [];
      }
      const normalizedSchemeType: "apiKey" | "http" | "oauth2" | "openIdConnect" =
        schemeType === "apiKey"
        || schemeType === "http"
        || schemeType === "oauth2"
        || schemeType === "openIdConnect"
          ? schemeType
          : "http";

      const placementIn = asTrimmedString(scheme.in);
      const normalizedPlacementIn: "header" | "query" | "cookie" | undefined =
        placementIn === "header" || placementIn === "query" || placementIn === "cookie"
          ? placementIn
          : undefined;

      return [{
        schemeName,
        schemeType: normalizedSchemeType,
        ...(asTrimmedString(scheme.description)
          ? { description: asTrimmedString(scheme.description) }
          : {}),
        ...(normalizedPlacementIn
          ? { placementIn: normalizedPlacementIn }
          : {}),
        ...(asTrimmedString(scheme.name)
          ? { placementName: asTrimmedString(scheme.name) }
          : {}),
        ...(asTrimmedString(scheme.scheme)
          ? { scheme: asTrimmedString(scheme.scheme) }
          : {}),
        ...(asTrimmedString(scheme.bearerFormat)
          ? { bearerFormat: asTrimmedString(scheme.bearerFormat) }
          : {}),
        ...(asTrimmedString(scheme.openIdConnectUrl)
          ? { openIdConnectUrl: asTrimmedString(scheme.openIdConnectUrl) }
          : {}),
        ...(oauthFlowRecord(scheme.flows)
          ? { flows: oauthFlowRecord(scheme.flows) }
          : {}),
      }];
    });

  return resolved.length > 0 ? resolved : undefined;
};

const mergeRefHintTable = (
  document: OpenApiJsonObject,
  manifest: OpenApiToolManifest,
  extraRefKeys: ReadonlySet<string>,
): OpenApiToolManifest["refHintTable"] => {
  const merged: Record<string, string> = {
    ...(manifest.refHintTable ?? {}),
  };
  const queue = [...extraRefKeys].sort((left, right) => left.localeCompare(right));
  const seen = new Set<string>(Object.keys(merged));

  while (queue.length > 0) {
    const refKey = queue.shift()!;
    if (seen.has(refKey)) {
      continue;
    }
    seen.add(refKey);

    const resolved = resolveLocalRef(document, { $ref: refKey });
    merged[refKey] = stableJsonStringify(resolved);

    const nestedRefs = new Set<string>();
    collectRefKeys(resolved, nestedRefs);
    for (const nestedRef of [...nestedRefs].sort((left, right) => left.localeCompare(right))) {
      if (!seen.has(nestedRef)) {
        queue.push(nestedRef);
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
};

const enrichManifestFromDocument = (
  document: OpenApiJsonObject,
  manifest: OpenApiToolManifest,
): OpenApiToolManifest => {
  const extraRefKeys = new Set<string>();
  const documentServers = documentServersFromDocument(document);
  const tools = manifest.tools.map((tool) => {
    const parameterRecords = parameterRecordMapForTool(document, tool);
    const invocationParameters = tool.invocation.parameters.map((parameter) => {
      const record = parameterRecords.get(parameterKey({
        location: parameter.location,
        name: parameter.name,
      }));
      const content = contentEntriesFromContent(document, record?.content);

      return {
        ...parameter,
        ...(asTrimmedString(record?.style) ? { style: asTrimmedString(record?.style) } : {}),
        ...(typeof record?.explode === "boolean" ? { explode: record.explode } : {}),
        ...(typeof record?.allowReserved === "boolean" ? { allowReserved: record.allowReserved } : {}),
        ...(content.length > 0 ? { content } : {}),
      };
    });
    const requestBody = requestBodyPayloadForTool(document, tool);
    const inputSchema = tool.typing?.inputSchema ?? requestBodySchemaForTool(document, tool);
    const outputSchema = tool.typing?.outputSchema ?? responseSchemaForTool(document, tool);
    const responses = responseVariantsForTool(document, tool);
    const authRequirement = authRequirementForTool(document, tool);
    const securitySchemes = securitySchemesForTool(document, authRequirement);
    const operationServers = operationServersForTool(document, tool);

    for (const parameter of invocationParameters) {
      for (const content of parameter.content ?? []) {
        collectRefKeys(content.schema, extraRefKeys);
      }
    }

    for (const content of requestBody?.contents ?? []) {
      collectRefKeys(content.schema, extraRefKeys);
    }

    for (const response of responses ?? []) {
      collectRefKeys(response.schema, extraRefKeys);
      for (const content of response.contents ?? []) {
        collectRefKeys(content.schema, extraRefKeys);
      }
      for (const header of response.headers ?? []) {
        collectRefKeys(header.schema, extraRefKeys);
        for (const content of header.content ?? []) {
          collectRefKeys(content.schema, extraRefKeys);
        }
      }
    }

    return {
      ...tool,
      invocation: {
        ...tool.invocation,
        parameters: invocationParameters,
        requestBody,
      },
      ...((inputSchema !== undefined || outputSchema !== undefined)
        ? {
            typing: {
              ...(tool.typing ?? {}),
              ...(inputSchema !== undefined ? { inputSchema } : {}),
              ...(outputSchema !== undefined ? { outputSchema } : {}),
            },
          }
        : {}),
      ...(responses ? { responses } : {}),
      ...(authRequirement ? { authRequirement } : {}),
      ...(securitySchemes ? { securitySchemes } : {}),
      ...(documentServers ? { documentServers } : {}),
      ...(operationServers ? { servers: operationServers } : {}),
    };
  });

  return {
    ...manifest,
    tools,
    refHintTable: mergeRefHintTable(document, manifest, extraRefKeys),
  };
};

export const extractOpenApiManifest = (
  sourceName: string,
  openApiSpec: OpenApiSpecInput,
): Effect.Effect<OpenApiToolManifest, OpenApiExtractionError> =>
  Effect.gen(function* () {
    const openApiDocumentText = yield* normalizeOpenApiDocumentText(
      sourceName,
      openApiSpec,
    );

    const manifestJson = yield* Effect.tryPromise({
      try: () => extractOpenApiManifestJsonWithWasm(sourceName, openApiDocumentText),
      catch: (cause) => toExtractionError(sourceName, "extract", cause),
    });

    const manifest = yield* pipe(
      decodeManifestFromJson(manifestJson),
      Effect.mapError((cause) => toExtractionError(sourceName, "extract", cause)),
    );

    const parsedDocument = yield* Effect.try({
      try: () => parseOpenApiDocument(openApiDocumentText),
      catch: (cause) => toExtractionError(sourceName, "validate", cause),
    });

    return enrichManifestFromDocument(parsedDocument, manifest);
  });

import * as Effect from "effect/Effect";

import { contentHash, stableHash } from "@executor/source-core";

import { parseOpenApiDocument } from "./document";
import type {
  OpenApiExample,
  OpenApiExtractedTool,
  OpenApiHeader,
  OpenApiJsonObject,
  OpenApiMediaContent,
  OpenApiResponseVariant,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
  OpenApiServer,
  OpenApiToolDocumentation,
  OpenApiToolManifest,
  OpenApiToolParameter,
  OpenApiToolRequestBody,
} from "./types";
import { OPEN_API_HTTP_METHODS, type OpenApiHttpMethod } from "./types";

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [];

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

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

  const resolvedObject = asObject(
    resolveLocalRef(document, resolved, nextActiveRefs),
  );
  const { $ref: _ignoredRef, ...rest } = object;

  return Object.keys(rest).length > 0 ? { ...resolvedObject, ...rest } : resolvedObject;
};

const preferredContentEntry = (
  content: unknown,
): readonly [string, Record<string, unknown>] | undefined => {
  const entries = Object.entries(asObject(content))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mediaType, value]) => [mediaType, asObject(value)] as const);

  return (
    entries.find(([mediaType]) => mediaType === "application/json") ??
    entries.find(([mediaType]) => mediaType.toLowerCase().includes("+json")) ??
    entries.find(([mediaType]) => mediaType.toLowerCase().includes("json")) ??
    entries[0]
  );
};

const contentSchemaFromOperationContent = (
  document: OpenApiJsonObject,
  content: unknown,
): unknown | undefined => {
  const preferred = preferredContentEntry(content);
  return preferred?.[1].schema === undefined
    ? undefined
    : resolveLocalRef(document, preferred[1].schema);
};

const examplesFromValue = (
  value: unknown,
  input: {
    label?: string;
    mediaType?: string;
  } = {},
): Array<OpenApiExample> => {
  const record = asObject(value);
  const examples: Array<OpenApiExample> = [];

  if (record.example !== undefined) {
    examples.push({
      valueJson: stableJsonStringify(record.example),
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(input.label ? { label: input.label } : {}),
    });
  }

  const exampleEntries = Object.entries(asObject(record.examples)).sort(([left], [right]) =>
    left.localeCompare(right),
  );
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

const examplesFromSchema = (schema: unknown): Array<OpenApiExample> =>
  examplesFromValue(schema);

const examplesFromMediaType = (
  mediaType: string,
  mediaTypeRecord: Record<string, unknown>,
): Array<OpenApiExample> => {
  const direct = examplesFromValue(mediaTypeRecord, { mediaType });
  if (direct.length > 0) {
    return direct;
  }

  return examplesFromSchema(mediaTypeRecord.schema).map((example) => ({
    ...example,
    mediaType,
  }));
};

const contentEntriesFromContent = (
  document: OpenApiJsonObject,
  content: unknown,
): ReadonlyArray<OpenApiMediaContent> =>
  Object.entries(asObject(content))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mediaType, mediaValue]) => {
      const mediaRecord = asObject(resolveLocalRef(document, mediaValue));
      const examples = examplesFromMediaType(mediaType, mediaRecord);

      return {
        mediaType,
        ...(mediaRecord.schema !== undefined
          ? { schema: resolveLocalRef(document, mediaRecord.schema) }
          : {}),
        ...(examples.length > 0 ? { examples } : {}),
      };
    });

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
  const directExamples = content.length > 0 ? [] : examplesFromValue(header);

  return {
    name,
    ...(asTrimmedString(header.description)
      ? { description: asTrimmedString(header.description) }
      : {}),
    ...(typeof header.required === "boolean" ? { required: header.required } : {}),
    ...(typeof header.deprecated === "boolean"
      ? { deprecated: header.deprecated }
      : {}),
    ...(header.schema !== undefined
      ? { schema: resolveLocalRef(document, header.schema) }
      : {}),
    ...(content.length > 0 ? { content } : {}),
    ...(asTrimmedString(header.style) ? { style: asTrimmedString(header.style) } : {}),
    ...(typeof header.explode === "boolean" ? { explode: header.explode } : {}),
    ...(directExamples.length > 0 ? { examples: directExamples } : {}),
  };
};

const headersFromValue = (
  document: OpenApiJsonObject,
  value: unknown,
): ReadonlyArray<OpenApiHeader> =>
  Object.entries(asObject(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, headerValue]) => {
      const header = headerFromValue(document, name, headerValue);
      return header ? [header] : [];
    });

const serversFromValue = (value: unknown): ReadonlyArray<OpenApiServer> =>
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

      return [
        {
          url,
          ...(asTrimmedString(server.description)
            ? { description: asTrimmedString(server.description) }
            : {}),
          ...(Object.keys(variables).length > 0 ? { variables } : {}),
        },
      ];
    });

const responseStatusRank = (statusCode: string): number => {
  if (/^2\\d\\d$/.test(statusCode)) {
    return 0;
  }

  if (statusCode === "default") {
    return 1;
  }

  return 2;
};

const operationFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): Record<string, unknown> =>
  asObject(asObject(asObject(document.paths)[pathTemplate])[method]);

const pathItemFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
): Record<string, unknown> => asObject(asObject(document.paths)[pathTemplate]);

const parameterKey = (input: {
  location: string;
  name: string;
}): string => `${input.location}:${input.name}`;

const mergedParameterRecords = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): ReadonlyMap<string, Record<string, unknown>> => {
  const merged = new Map<string, Record<string, unknown>>();
  const pathItem = pathItemFor(document, pathTemplate);
  const operation = operationFor(document, pathTemplate, method);

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

const requestBodyPayloadFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): OpenApiToolRequestBody | null => {
  const operation = operationFor(document, pathTemplate, method);
  const requestBody = asObject(resolveLocalRef(document, operation.requestBody));
  if (Object.keys(requestBody).length === 0) {
    return null;
  }

  const contents = contentEntriesFromContent(document, requestBody.content);
  const contentTypes = contents.map((content) => content.mediaType);

  return {
    required:
      typeof requestBody.required === "boolean" ? requestBody.required : false,
    contentTypes,
    ...(contents.length > 0 ? { contents } : {}),
  };
};

const responseSchemaFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): unknown | undefined => {
  const operation = operationFor(document, pathTemplate, method);
  const responseEntries = Object.entries(asObject(operation.responses));
  const preferredResponses = responseEntries
    .filter(([status]) => /^2\\d\\d$/.test(status))
    .sort(([left], [right]) => left.localeCompare(right));
  const fallbackResponses = responseEntries.filter(([status]) => status === "default");

  for (const [, responseValue] of [...preferredResponses, ...fallbackResponses]) {
    const response = resolveLocalRef(document, responseValue);
    const schema = contentSchemaFromOperationContent(document, asObject(response).content);
    if (schema !== undefined) {
      return schema;
    }
  }

  return undefined;
};

const responseVariantsFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): OpenApiResponseVariant[] | undefined => {
  const operation = operationFor(document, pathTemplate, method);
  const responseEntries = Object.entries(asObject(operation.responses)).sort(
    ([left], [right]) =>
      responseStatusRank(left) - responseStatusRank(right) ||
      left.localeCompare(right),
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
      ...(contentSchemaFromOperationContent(document, response.content) !== undefined
        ? { schema: contentSchemaFromOperationContent(document, response.content) }
        : {}),
      ...(examples.length > 0 ? { examples } : {}),
      ...(contents.length > 0 ? { contents } : {}),
      ...(headers.length > 0 ? { headers } : {}),
    };
  });

  return responses.length > 0 ? responses : undefined;
};

const securityRequirementFromValue = (
  value: unknown,
): OpenApiSecurityRequirement | undefined => {
  const requirementEntries = asArray(value);
  if (requirementEntries.length === 0) {
    return { kind: "none" };
  }

  const anyOfItems = requirementEntries.flatMap((entry) => {
    const schemes = Object.entries(asObject(entry))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([schemeName, rawScopes]) => {
        const scopes = asArray(rawScopes).flatMap((scope) =>
          typeof scope === "string" && scope.trim().length > 0 ? [scope.trim()] : [],
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

const authRequirementFor = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): OpenApiSecurityRequirement | undefined => {
  const operation = operationFor(document, pathTemplate, method);
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
):
  | Record<
      string,
      {
        authorizationUrl?: string;
        tokenUrl?: string;
        refreshUrl?: string;
        scopes?: Record<string, string>;
      }
    >
  | undefined => {
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

        return [
          flowName,
          {
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
          },
        ];
      }),
  );

  return Object.keys(result).length > 0 ? result : undefined;
};

const securitySchemesFor = (
  document: OpenApiJsonObject,
  authRequirement: OpenApiSecurityRequirement | undefined,
): OpenApiSecurityScheme[] | undefined => {
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
        schemeType === "apiKey" ||
        schemeType === "http" ||
        schemeType === "oauth2" ||
        schemeType === "openIdConnect"
          ? schemeType
          : "http";

      const placementIn = asTrimmedString(scheme.in);
      const normalizedPlacementIn: "header" | "query" | "cookie" | undefined =
        placementIn === "header" || placementIn === "query" || placementIn === "cookie"
          ? placementIn
          : undefined;

      return [
        {
          schemeName,
          schemeType: normalizedSchemeType,
          ...(asTrimmedString(scheme.description)
            ? { description: asTrimmedString(scheme.description) }
            : {}),
          ...(normalizedPlacementIn ? { placementIn: normalizedPlacementIn } : {}),
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
          ...(oauthFlowRecord(scheme.flows) ? { flows: oauthFlowRecord(scheme.flows) } : {}),
        },
      ];
    });

  return resolved.length > 0 ? resolved : undefined;
};

const buildInputSchema = (input: {
  parameters: ReadonlyArray<OpenApiToolParameter>;
  requestBody: OpenApiToolRequestBody | null;
}): Record<string, unknown> | undefined => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of input.parameters) {
    const preferredContent = parameter.content?.[0]?.schema;
    properties[parameter.name] = preferredContent ?? { type: "string" };
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (input.requestBody) {
    properties.body =
      input.requestBody.contents?.[0]?.schema ?? {
        type: "object",
      };
    if (input.requestBody.required) {
      required.push("body");
    }
  }

  return Object.keys(properties).length > 0
    ? {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      }
    : undefined;
};

const buildDocumentation = (input: {
  operation: Record<string, unknown>;
  parameters: ReadonlyArray<OpenApiToolParameter>;
  requestBody: OpenApiToolRequestBody | null;
  responses: ReadonlyArray<OpenApiResponseVariant> | undefined;
}): OpenApiToolDocumentation => {
  const parameterDocs = input.parameters.map((parameter) => ({
    name: parameter.name,
    location: parameter.location,
    required: parameter.required,
    ...(asTrimmedString(
      (parameter as unknown as Record<string, unknown>).description,
    )
      ? {
          description: asTrimmedString(
            (parameter as unknown as Record<string, unknown>).description,
          ),
        }
      : {}),
    ...(parameter.content?.[0]?.examples && parameter.content[0].examples.length > 0
      ? { examples: parameter.content[0].examples }
      : {}),
  }));

  const preferredResponse =
    input.responses?.find((response) => /^2\\d\\d$/.test(response.statusCode)) ??
    input.responses?.find((response) => response.statusCode === "default") ??
    input.responses?.[0];

  return {
    ...(asTrimmedString(input.operation.summary)
      ? { summary: asTrimmedString(input.operation.summary) }
      : {}),
    ...(typeof input.operation.deprecated === "boolean"
      ? { deprecated: input.operation.deprecated }
      : {}),
    parameters: parameterDocs,
    ...(input.requestBody
      ? {
          requestBody: {
            ...(asTrimmedString(asObject(input.operation.requestBody).description)
              ? {
                  description: asTrimmedString(
                    asObject(input.operation.requestBody).description,
                  ),
                }
              : {}),
            ...(input.requestBody.contents?.[0]?.examples &&
            input.requestBody.contents[0].examples.length > 0
              ? { examples: input.requestBody.contents[0].examples }
              : {}),
          },
        }
      : {}),
    ...(preferredResponse
      ? {
          response: {
            statusCode: preferredResponse.statusCode,
            ...(preferredResponse.description
              ? { description: preferredResponse.description }
              : {}),
            contentTypes: preferredResponse.contentTypes,
            ...(preferredResponse.examples && preferredResponse.examples.length > 0
              ? { examples: preferredResponse.examples }
              : {}),
          },
        }
      : {}),
  };
};

const extractToolParameters = (
  document: OpenApiJsonObject,
  pathTemplate: string,
  method: OpenApiHttpMethod,
): OpenApiToolParameter[] =>
  [...mergedParameterRecords(document, pathTemplate, method).values()].map(
    (parameter) => {
      const location = asTrimmedString(parameter.in);
      const name = asTrimmedString(parameter.name);
      if (!location || !name) {
        throw new Error(`Invalid OpenAPI parameter on ${method.toUpperCase()} ${pathTemplate}`);
      }

      const content = contentEntriesFromContent(document, parameter.content);

      return {
        name,
        location: location as OpenApiToolParameter["location"],
        required:
          location === "path"
            ? true
            : typeof parameter.required === "boolean"
              ? parameter.required
              : false,
        ...(asTrimmedString(parameter.style)
          ? { style: asTrimmedString(parameter.style) }
          : {}),
        ...(typeof parameter.explode === "boolean"
          ? { explode: parameter.explode }
          : {}),
        ...(typeof parameter.allowReserved === "boolean"
          ? { allowReserved: parameter.allowReserved }
          : {}),
        ...(parameter.schema !== undefined && content.length === 0
          ? {
              content: [
                {
                  mediaType: "application/json",
                  schema: resolveLocalRef(document, parameter.schema),
                  ...(examplesFromValue(parameter).length > 0
                    ? { examples: examplesFromValue(parameter) }
                    : {}),
                },
              ],
            }
          : {}),
        ...(content.length > 0 ? { content } : {}),
        ...(asTrimmedString(parameter.description)
          ? {
              description: asTrimmedString(parameter.description),
            }
          : {}),
      } as OpenApiToolParameter;
    },
  );

const rawToolIdForOperation = (input: {
  method: OpenApiHttpMethod;
  pathTemplate: string;
  operation: Record<string, unknown>;
}): string =>
  asTrimmedString(input.operation.operationId) ??
  (`${input.method}_${input.pathTemplate.replace(/[^a-zA-Z0-9]+/g, "_")}`.replace(
    /^_+|_+$/g,
    "",
  ) || `${input.method}_operation`);

export const extractOpenApiManifest = (
  sourceName: string,
  openApiDocumentText: string,
): Effect.Effect<OpenApiToolManifest, Error, never> =>
  Effect.try({
    try: () => {
      const document = parseOpenApiDocument(openApiDocumentText);
      const tools: OpenApiExtractedTool[] = [];
      const paths = asObject(document.paths);
      const documentServers = serversFromValue(document.servers);

      for (const [pathTemplate, pathItemValue] of Object.entries(paths).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const pathItem = asObject(pathItemValue);
        for (const method of OPEN_API_HTTP_METHODS) {
          const operation = asObject(pathItem[method]);
          if (Object.keys(operation).length === 0) {
            continue;
          }

          const parameters = extractToolParameters(document, pathTemplate, method);
          const requestBody = requestBodyPayloadFor(document, pathTemplate, method);
          const responses = responseVariantsFor(document, pathTemplate, method);
          const authRequirement = authRequirementFor(document, pathTemplate, method);
          const servers = (() => {
            const operationServers = serversFromValue(operation.servers);
            if (operationServers.length > 0) {
              return operationServers;
            }

            const pathServers = serversFromValue(pathItem.servers);
            return pathServers.length > 0 ? pathServers : undefined;
          })();
          const inputSchema = buildInputSchema({
            parameters,
            requestBody,
          });
          const outputSchema = responseSchemaFor(document, pathTemplate, method);
          const documentation = buildDocumentation({
            operation,
            parameters,
            requestBody,
            responses,
          });

          tools.push({
            toolId: rawToolIdForOperation({
              method,
              pathTemplate,
              operation,
            }),
            ...(asTrimmedString(operation.operationId)
              ? { operationId: asTrimmedString(operation.operationId) }
              : {}),
            tags: asArray(operation.tags).flatMap((tag) =>
              typeof tag === "string" && tag.trim().length > 0 ? [tag.trim()] : [],
            ),
            name:
              asTrimmedString(operation.summary) ??
              asTrimmedString(operation.operationId) ??
              `${method.toUpperCase()} ${pathTemplate}`,
            description:
              asTrimmedString(operation.description) ??
              asTrimmedString(operation.summary) ??
              null,
            method,
            path: pathTemplate,
            invocation: {
              method,
              pathTemplate,
              parameters,
              requestBody,
            },
            operationHash: stableHash({
              method,
              path: pathTemplate,
              operation: stableJsonValue(operation),
            }),
            ...(inputSchema ? { inputSchema } : {}),
            ...(outputSchema !== undefined ? { outputSchema } : {}),
            documentation,
            ...(responses ? { responses } : {}),
            ...(authRequirement ? { authRequirement } : {}),
            ...(authRequirement
              ? {
                  securitySchemes: securitySchemesFor(document, authRequirement),
                }
              : {}),
            ...(documentServers.length > 0 ? { documentServers } : {}),
            ...(servers ? { servers } : {}),
          });
        }
      }

      return {
        version: 1,
        sourceHash: contentHash(openApiDocumentText),
        tools,
      };
    },
    catch: (cause) =>
      cause instanceof Error
        ? new Error(`Failed extracting OpenAPI manifest for ${sourceName}: ${cause.message}`)
        : new Error(String(cause)),
  });

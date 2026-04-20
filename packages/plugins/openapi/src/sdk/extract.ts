import { Effect, Option } from "effect";

import { OpenApiExtractionError } from "./errors";
import type { ParsedDocument } from "./parse";
import {
  DocResolver,
  preferredContent,
  type OperationObject,
  type ParameterObject,
  type PathItemObject,
  type RequestBodyObject,
  type ResponseObject,
} from "./openapi-utils";
import {
  ExtractedOperation,
  ExtractionResult,
  type HttpMethod,
  OperationId,
  OperationParameter,
  OperationRequestBody,
  OperationResponse,
  OperationResponseHeader,
  type ParameterLocation,
  ServerInfo,
  ServerVariable,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
];

const VALID_PARAM_LOCATIONS = new Set<string>(["path", "query", "header", "cookie"]);

// ---------------------------------------------------------------------------
// readOnly / writeOnly schema filtering
//
// OpenAPI declares field direction via `readOnly`/`writeOnly` on individual
// properties. A `readOnly` field (e.g. server-generated `id`, `created_at`)
// must NOT appear in request bodies — the server ignores it at best and
// 400s at worst. A `writeOnly` field (e.g. `password`) must NOT appear in
// responses — it's for input only and never returned. Stripping these
// before the schema reaches the LLM prevents the tool from being told
// about fields it can't legally touch in that direction.
//
// The walker preserves structure (allOf/oneOf/anyOf, nested properties,
// items, additionalProperties) but scrubs offending leaf properties from
// `properties` maps and from `required` lists, and avoids following
// `$ref`s (refs are normalized elsewhere; the same schema can be used in
// both directions so rewriting the shared definition would cross-
// contaminate). This means ref-only schemas are passed through unchanged.
// ---------------------------------------------------------------------------

type Direction = "input" | "output";

const shouldStripProperty = (propSchema: unknown, direction: Direction): boolean => {
  if (propSchema == null || typeof propSchema !== "object" || Array.isArray(propSchema)) {
    return false;
  }
  const obj = propSchema as Record<string, unknown>;
  if (direction === "input" && obj.readOnly === true) return true;
  if (direction === "output" && obj.writeOnly === true) return true;
  return false;
};

// swagger-parser preserves circular $refs as object-identity cycles
// (same reference on both ends), so the walker needs a visited map to
// terminate. We seed the cache with the partial result before recursing
// so that cycle closures in the output mirror cycle closures in the
// input (A.items → A becomes A'.items → A').
const filterSchemaForDirection = (node: unknown, direction: Direction): unknown => {
  const visited = new WeakMap<object, unknown>();

  const walk = (n: unknown): unknown => {
    if (n == null || typeof n !== "object") return n;
    const cached = visited.get(n as object);
    if (cached !== undefined) return cached;

    if (Array.isArray(n)) {
      const arr: unknown[] = [];
      visited.set(n as object, arr);
      for (const item of n) arr.push(walk(item));
      return arr;
    }

    const obj = n as Record<string, unknown>;

    if (typeof obj.$ref === "string") {
      visited.set(n as object, obj);
      return obj;
    }

    const result: Record<string, unknown> = {};
    visited.set(n as object, result);
    const droppedKeys = new Set<string>();

    for (const [key, value] of Object.entries(obj)) {
      if (key === "properties" && value != null && typeof value === "object") {
        const props = value as Record<string, unknown>;
        const nextProps: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(props)) {
          if (shouldStripProperty(propSchema, direction)) {
            droppedKeys.add(propName);
            continue;
          }
          nextProps[propName] = walk(propSchema);
        }
        result[key] = nextProps;
      } else if (
        key === "allOf" ||
        key === "oneOf" ||
        key === "anyOf" ||
        key === "prefixItems"
      ) {
        result[key] = Array.isArray(value) ? value.map((item) => walk(item)) : value;
      } else if (
        key === "items" ||
        key === "additionalProperties" ||
        key === "not" ||
        key === "if" ||
        key === "then" ||
        key === "else"
      ) {
        result[key] = walk(value);
      } else {
        result[key] = value;
      }
    }

    if (droppedKeys.size > 0 && Array.isArray(result.required)) {
      const next = (result.required as unknown[]).filter(
        (r) => !(typeof r === "string" && droppedKeys.has(r)),
      );
      if (next.length === 0) delete result.required;
      else result.required = next;
    }

    return result;
  };

  return walk(node);
};

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

const extractParameters = (
  pathItem: PathItemObject,
  operation: OperationObject,
  r: DocResolver,
): OperationParameter[] => {
  const merged = new Map<string, ParameterObject>();

  for (const raw of pathItem.parameters ?? []) {
    const p = r.resolve<ParameterObject>(raw);
    if (!p) continue;
    merged.set(`${p.in}:${p.name}`, p);
  }
  for (const raw of operation.parameters ?? []) {
    const p = r.resolve<ParameterObject>(raw);
    if (!p) continue;
    merged.set(`${p.in}:${p.name}`, p);
  }

  return [...merged.values()]
    .filter((p) => VALID_PARAM_LOCATIONS.has(p.in))
    .map(
      (p) =>
        new OperationParameter({
          name: p.name,
          location: p.in as ParameterLocation,
          required: p.in === "path" ? true : p.required === true,
          schema: Option.fromNullable(p.schema),
          style: Option.fromNullable(p.style),
          explode: Option.fromNullable(p.explode),
          allowReserved: Option.fromNullable("allowReserved" in p ? p.allowReserved : undefined),
          description: Option.fromNullable(p.description),
        }),
    );
};

// ---------------------------------------------------------------------------
// Request body extraction
// ---------------------------------------------------------------------------

const extractRequestBody = (
  operation: OperationObject,
  r: DocResolver,
): OperationRequestBody | undefined => {
  if (!operation.requestBody) return undefined;

  const body = r.resolve<RequestBodyObject>(operation.requestBody);
  if (!body) return undefined;

  const content = preferredContent(body.content);
  if (!content) return undefined;

  // Strip `readOnly: true` before the schema reaches the LLM's input
  // surface — the server won't accept those fields on writes.
  const filteredSchema = content.media.schema
    ? filterSchemaForDirection(content.media.schema, "input")
    : undefined;

  return new OperationRequestBody({
    required: body.required === true,
    contentType: content.mediaType,
    schema: Option.fromNullable(filteredSchema),
  });
};

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

const extractResponseHeaders = (
  resp: ResponseObject,
  r: DocResolver,
): OperationResponseHeader[] => {
  if (!resp.headers) return [];
  const out: OperationResponseHeader[] = [];
  for (const [name, raw] of Object.entries(resp.headers)) {
    // Header objects can be $ref'd (to components.headers) or inline,
    // and the referenced shape extends ParameterBaseObject so we can
    // pull `schema` / `description` off in both cases.
    const header = r.resolve<{ description?: string; schema?: unknown }>(raw);
    if (!header) continue;
    const schema = header.schema
      ? filterSchemaForDirection(header.schema, "output")
      : undefined;
    out.push(
      new OperationResponseHeader({
        name,
        description: Option.fromNullable(header.description),
        schema: Option.fromNullable(schema),
      }),
    );
  }
  return out;
};

const extractResponses = (
  operation: OperationObject,
  r: DocResolver,
): Record<string, OperationResponse> => {
  if (!operation.responses) return {};

  const out: Record<string, OperationResponse> = {};

  for (const [statusCode, ref] of Object.entries(operation.responses)) {
    const resp = r.resolve<ResponseObject>(ref);
    if (!resp) continue;

    const content = preferredContent(resp.content);
    const rawSchema = content?.media.schema;
    const filteredSchema = rawSchema
      ? filterSchemaForDirection(rawSchema, "output")
      : undefined;

    out[statusCode] = new OperationResponse({
      statusCode,
      description: Option.fromNullable(resp.description),
      contentType: Option.fromNullable(content?.mediaType),
      schema: Option.fromNullable(filteredSchema),
      headers: extractResponseHeaders(resp, r),
    });
  }

  return out;
};

/**
 * Pick the "preferred" response's body schema for callers that can only
 * carry one schema per operation (legacy `outputSchema` surface, LLM tool
 * definitions that shape a single output). Preference order: the lowest
 * 2xx status that actually has a body schema, then `default`. Non-2xx
 * error responses never win here — they're still available on `responses`.
 */
const pickPreferredOutputSchema = (
  responses: Record<string, OperationResponse>,
): unknown | undefined => {
  const entries = Object.entries(responses);
  const ordered = [
    ...entries.filter(([s]) => /^2\d\d$/.test(s)).sort(([a], [b]) => a.localeCompare(b)),
    ...entries.filter(([s]) => s === "default"),
  ];
  for (const [, resp] of ordered) {
    if (Option.isSome(resp.schema)) return Option.getOrUndefined(resp.schema);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Input schema builder
// ---------------------------------------------------------------------------

const buildInputSchema = (
  parameters: readonly OperationParameter[],
  requestBody: OperationRequestBody | undefined,
): Record<string, unknown> | undefined => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of parameters) {
    properties[param.name] = Option.getOrElse(param.schema, () => ({ type: "string" }));
    if (param.required) required.push(param.name);
  }

  if (requestBody) {
    properties.body = Option.getOrElse(requestBody.schema, () => ({ type: "object" }));
    if (requestBody.required) required.push("body");
  }

  if (Object.keys(properties).length === 0) return undefined;

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
};

// ---------------------------------------------------------------------------
// Operation ID derivation
// ---------------------------------------------------------------------------

const deriveOperationId = (
  method: HttpMethod,
  pathTemplate: string,
  operation: OperationObject,
): string =>
  operation.operationId ??
  (`${method}_${pathTemplate.replace(/[^a-zA-Z0-9]+/g, "_")}`.replace(/^_+|_+$/g, "") ||
    `${method}_operation`);

// ---------------------------------------------------------------------------
// Server extraction
// ---------------------------------------------------------------------------

const extractServers = (doc: ParsedDocument): ServerInfo[] =>
  (doc.servers ?? []).flatMap((server) => {
    if (!server.url) return [];
    const vars = server.variables
      ? Object.fromEntries(
          Object.entries(server.variables).flatMap(([name, v]) => {
            if (v.default === undefined || v.default === null) return [];
            const enumValues = Array.isArray(v.enum)
              ? v.enum.filter((x): x is string => typeof x === "string")
              : undefined;
            return [
              [
                name,
                new ServerVariable({
                  default: String(v.default),
                  enum:
                    enumValues && enumValues.length > 0
                      ? Option.some(enumValues)
                      : Option.none(),
                  description: Option.fromNullable(v.description),
                }),
              ],
            ];
          }),
        )
      : undefined;
    return [
      new ServerInfo({
        url: server.url,
        description: Option.fromNullable(server.description),
        variables: vars && Object.keys(vars).length > 0 ? Option.some(vars) : Option.none(),
      }),
    ];
  });

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/** Extract all operations from a bundled OpenAPI 3.x document */
export const extract = Effect.fn("OpenApi.extract")(function* (doc: ParsedDocument) {
  const paths = doc.paths;
  if (!paths) {
    return yield* new OpenApiExtractionError({
      message: "OpenAPI document has no paths defined",
    });
  }

  const r = new DocResolver(doc);
  const operations: ExtractedOperation[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(paths).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parameters = extractParameters(pathItem, operation, r);
      const requestBody = extractRequestBody(operation, r);
      const inputSchema = buildInputSchema(parameters, requestBody);
      const responses = extractResponses(operation, r);
      const outputSchema = pickPreferredOutputSchema(responses);
      const tags = (operation.tags ?? []).filter((t) => t.trim().length > 0);

      operations.push(
        new ExtractedOperation({
          operationId: OperationId.make(deriveOperationId(method, pathTemplate, operation)),
          method,
          pathTemplate,
          summary: Option.fromNullable(operation.summary),
          description: Option.fromNullable(operation.description),
          tags,
          parameters,
          requestBody: Option.fromNullable(requestBody),
          inputSchema: Option.fromNullable(inputSchema),
          outputSchema: Option.fromNullable(outputSchema),
          responses,
          deprecated: operation.deprecated === true,
        }),
      );
    }
  }

  return new ExtractionResult({
    title: Option.fromNullable(doc.info?.title),
    version: Option.fromNullable(doc.info?.version),
    servers: extractServers(doc),
    operations,
  });
});

import { asRecord } from "./utils";

type JsonSchema = Record<string, unknown>;
const COMPONENT_REF_INLINE_DEPTH = 2;

export type OpenApiParameterHint = {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
};

export function extractOperationIdsFromDts(dts: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /^\s{2,4}(?:"([^"]+)"|([A-Za-z_]\w*))\s*:\s*\{/gm;
  const opsStart = dts.indexOf("export interface operations {");
  if (opsStart === -1) return ids;
  const opsSection = dts.slice(opsStart, opsStart + dts.length);
  for (const match of opsSection.matchAll(pattern)) {
    const id = match[1] ?? match[2];
    if (id) ids.add(id);
  }
  return ids;
}

export function getPreferredContentSchema(content: Record<string, unknown>): Record<string, unknown> {
  const preferredKeys = ["application/json", "*/*"];

  for (const key of preferredKeys) {
    const schema = asRecord(asRecord(content[key]).schema);
    if (Object.keys(schema).length > 0) return schema;
  }

  for (const [key, value] of Object.entries(content)) {
    if (!key.includes("json")) continue;
    const schema = asRecord(asRecord(value).schema);
    if (Object.keys(schema).length > 0) return schema;
  }

  for (const value of Object.values(content)) {
    const schema = asRecord(asRecord(value).schema);
    if (Object.keys(schema).length > 0) return schema;
  }

  return {};
}

export function getPreferredResponseSchema(responseValue: Record<string, unknown>): Record<string, unknown> {
  const contentSchema = getPreferredContentSchema(asRecord(responseValue.content));
  if (Object.keys(contentSchema).length > 0) {
    return contentSchema;
  }

  const schema = asRecord(responseValue.schema);
  if (Object.keys(schema).length > 0) {
    return schema;
  }

  return {};
}

export function resolveSchemaRef(
  schema: Record<string, unknown>,
  componentSchemas: Record<string, unknown>,
): Record<string, unknown> {
  const ref = typeof schema.$ref === "string" ? schema.$ref : "";
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) {
    return schema;
  }

  const key = ref.slice(prefix.length);
  const resolved = asRecord(componentSchemas[key]);
  if (Object.keys(resolved).length === 0) {
    return schema;
  }
  return resolved;
}

export function resolveRequestBodyRef(
  requestBody: Record<string, unknown>,
  componentRequestBodies: Record<string, unknown>,
): Record<string, unknown> {
  const ref = typeof requestBody.$ref === "string" ? requestBody.$ref : "";
  const prefix = "#/components/requestBodies/";
  if (!ref.startsWith(prefix)) {
    return requestBody;
  }

  const key = ref.slice(prefix.length);
  const resolved = asRecord(componentRequestBodies[key]);
  if (Object.keys(resolved).length === 0) {
    return requestBody;
  }
  return resolved;
}

export function resolveResponseRef(
  response: Record<string, unknown>,
  componentResponses: Record<string, unknown>,
): Record<string, unknown> {
  const ref = typeof response.$ref === "string" ? response.$ref : "";
  const prefix = "#/components/responses/";
  if (!ref.startsWith(prefix)) {
    return response;
  }

  const key = ref.slice(prefix.length);
  const resolved = asRecord(componentResponses[key]);
  if (Object.keys(resolved).length === 0) {
    return response;
  }
  return resolved;
}

export function parameterSchemaFromEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const schema = asRecord(entry.schema);
  if (Object.keys(schema).length > 0) {
    return schema;
  }

  const type = typeof entry.type === "string" ? entry.type : "";
  if (!type) {
    return {};
  }

  const fallback: Record<string, unknown> = { type };
  if (Array.isArray(entry.enum) && entry.enum.length > 0) {
    fallback.enum = entry.enum;
  }
  const items = asRecord(entry.items);
  if (Object.keys(items).length > 0) {
    fallback.items = items;
  }

  return fallback;
}

export function responseTypeHintFromSchema(
  responseSchema: Record<string, unknown>,
  responseStatus: string,
  componentSchemas?: Record<string, unknown>,
): string {
  if (Object.keys(responseSchema).length > 0) {
    return jsonSchemaTypeHintFallback(responseSchema, 0, componentSchemas);
  }

  if (responseStatus === "204" || responseStatus === "205") {
    return "void";
  }

  return "unknown";
}

function formatTsPropertyKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function formatComponentSchemaRefType(key: string): string {
  return `components["schemas"][${JSON.stringify(key)}]`;
}

function splitTopLevelBy(value: string, separator: string): string[] {
  const parts: string[] = [];
  let segment = "";
  let depthCurly = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let depthAngle = 0;

  for (const char of value) {
    if (char === "{") depthCurly += 1;
    else if (char === "}") depthCurly = Math.max(0, depthCurly - 1);
    else if (char === "[") depthSquare += 1;
    else if (char === "]") depthSquare = Math.max(0, depthSquare - 1);
    else if (char === "(") depthParen += 1;
    else if (char === ")") depthParen = Math.max(0, depthParen - 1);
    else if (char === "<") depthAngle += 1;
    else if (char === ">") depthAngle = Math.max(0, depthAngle - 1);

    if (
      char === separator
      && depthCurly === 0
      && depthSquare === 0
      && depthParen === 0
      && depthAngle === 0
    ) {
      const trimmed = segment.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      segment = "";
      continue;
    }

    segment += char;
  }

  const trimmed = segment.trim();
  if (trimmed.length > 0) parts.push(trimmed);
  return parts;
}

function dedupeTypeParts(parts: string[]): string[] {
  const unique: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (!value || value === "never") continue;
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}

function joinUnion(parts: string[]): string {
  const expanded = parts.flatMap((part) => splitTopLevelBy(part, "|"));
  const unique = dedupeTypeParts(expanded);
  if (unique.length === 0) return "unknown";
  const withoutUnknown = unique.filter((part) => part !== "unknown");
  const effective = withoutUnknown.length > 0 ? withoutUnknown : unique;
  if (effective.length === 1) return effective[0]!;

  return effective
    .map((part) => (part.includes(" & ") ? `(${part})` : part))
    .join(" | ");
}

function joinIntersection(parts: string[]): string {
  const expanded = parts.flatMap((part) => splitTopLevelBy(part, "&"));
  const unique = dedupeTypeParts(expanded).filter((part) => part !== "unknown");
  if (unique.length === 0) return "unknown";
  return unique.length === 1 ? unique[0]! : unique.join(" & ");
}

function maybeParenthesizeArrayElement(typeHint: string): string {
  return typeHint.includes(" | ") || typeHint.includes(" & ")
    ? `(${typeHint})`
    : typeHint;
}

export function jsonSchemaTypeHintFallback(
  schema: unknown,
  depth = 0,
  componentSchemas?: Record<string, unknown>,
  seenRefs: Set<string> = new Set(),
): string {
  if (!schema || typeof schema !== "object") return "unknown";
  if (depth > 12) return "unknown";

  const shape = schema as JsonSchema;
  if (typeof shape.$ref === "string") {
    const ref = shape.$ref;
    const prefix = "#/components/schemas/";
    if (ref.startsWith(prefix)) {
      const key = ref.slice(prefix.length);
      if (depth >= COMPONENT_REF_INLINE_DEPTH) {
        return formatComponentSchemaRefType(key);
      }
      if (seenRefs.has(ref)) {
        return "unknown";
      }
      const resolved = componentSchemas ? asRecord(componentSchemas[key]) : {};
      if (Object.keys(resolved).length > 0) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(ref);
        return jsonSchemaTypeHintFallback(resolved, depth + 1, componentSchemas, nextSeen);
      }

      return formatComponentSchemaRefType(key);
    }
  }

  const enumValues = Array.isArray(shape.enum) ? shape.enum : undefined;
  if (enumValues && enumValues.length > 0) {
    return enumValues.map((value) => JSON.stringify(value)).join(" | ");
  }

  const oneOf = Array.isArray(shape.oneOf) ? shape.oneOf : undefined;
  if (oneOf && oneOf.length > 0) {
    return joinUnion(oneOf.map((entry) => jsonSchemaTypeHintFallback(entry, depth + 1, componentSchemas, seenRefs)));
  }

  const anyOf = Array.isArray(shape.anyOf) ? shape.anyOf : undefined;
  if (anyOf && anyOf.length > 0) {
    return joinUnion(anyOf.map((entry) => jsonSchemaTypeHintFallback(entry, depth + 1, componentSchemas, seenRefs)));
  }

  const allOf = Array.isArray(shape.allOf) ? shape.allOf : undefined;
  if (allOf && allOf.length > 0) {
    const parts = allOf.map((entry) => jsonSchemaTypeHintFallback(entry, depth + 1, componentSchemas, seenRefs));
    return joinIntersection(parts);
  }

  const type = typeof shape.type === "string" ? shape.type : undefined;
  const tupleItems = Array.isArray(shape.items) ? shape.items : undefined;
  if (!type && tupleItems && tupleItems.length > 0) {
    return joinUnion(tupleItems.map((entry) => jsonSchemaTypeHintFallback(entry, depth + 1, componentSchemas, seenRefs)));
  }
  if (type === "integer") return "number";
  if (type === "string" || type === "number" || type === "boolean" || type === "null") {
    return type;
  }

  if (type === "array") {
    const itemType = jsonSchemaTypeHintFallback(shape.items, depth + 1, componentSchemas, seenRefs);
    return `${maybeParenthesizeArrayElement(itemType)}[]`;
  }

  const props = asRecord(shape.properties);
  const additionalProperties = shape.additionalProperties;
  const requiredRaw = Array.isArray(shape.required) ? shape.required : [];
  const required = new Set(requiredRaw.filter((item): item is string => typeof item === "string"));
  const propEntries = Object.entries(props);
  if (type === "object" || propEntries.length > 0) {
    if (propEntries.length === 0) {
      if (additionalProperties && typeof additionalProperties === "object") {
        return `Record<string, ${jsonSchemaTypeHintFallback(additionalProperties, depth + 1, componentSchemas, seenRefs)}>`;
      }
      return "Record<string, unknown>";
    }
    const maxInlineProps = 12;
    const isTruncated = propEntries.length > maxInlineProps;
    const inner = propEntries
      .slice(0, maxInlineProps)
      .map(([key, value]) => `${formatTsPropertyKey(key)}${required.has(key) ? "" : "?"}: ${jsonSchemaTypeHintFallback(value, depth + 1, componentSchemas, seenRefs)}`)
      .join("; ");
    const indexSignature = isTruncated ? `${inner ? "; " : ""}[key: string]: any` : "";
    return `{ ${inner}${indexSignature} }`;
  }

  return "unknown";
}

function pushUnique(values: string[], seen: Set<string>, raw: string): void {
  const value = raw.trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  values.push(value);
}

function collectTopLevelSchemaKeys(
  schema: unknown,
  componentSchemas?: Record<string, unknown>,
  seenRefs: Set<string> = new Set(),
): string[] {
  if (!schema || typeof schema !== "object") return [];

  const record = schema as Record<string, unknown>;
  const ref = typeof record.$ref === "string" ? record.$ref : "";
  if (ref.startsWith("#/components/schemas/")) {
    if (seenRefs.has(ref)) return [];
    const key = ref.slice("#/components/schemas/".length);
    const resolved = componentSchemas ? asRecord(componentSchemas[key]) : {};
    if (Object.keys(resolved).length === 0) return [];
    const nextSeen = new Set(seenRefs);
    nextSeen.add(ref);
    return collectTopLevelSchemaKeys(resolved, componentSchemas, nextSeen);
  }

  const keys: string[] = [];
  const seen = new Set<string>();

  for (const key of Object.keys(asRecord(record.properties))) {
    pushUnique(keys, seen, key);
  }

  const combinators: unknown[] = [
    ...(Array.isArray(record.allOf) ? record.allOf : []),
    ...(Array.isArray(record.oneOf) ? record.oneOf : []),
    ...(Array.isArray(record.anyOf) ? record.anyOf : []),
  ];

  for (const entry of combinators) {
    for (const key of collectTopLevelSchemaKeys(entry, componentSchemas, seenRefs)) {
      pushUnique(keys, seen, key);
    }
  }

  return keys;
}

export function buildOpenApiInputSchema(
  parameters: OpenApiParameterHint[],
  requestBodySchema: Record<string, unknown>,
): JsonSchema {
  const hasBodySchema = Object.keys(requestBodySchema).length > 0;
  const hasParams = parameters.length > 0;

  if (!hasBodySchema && !hasParams) {
    return {};
  }

  const parameterSchema: JsonSchema = {
    type: "object",
    properties: Object.fromEntries(parameters.map((param) => [param.name, param.schema])),
    required: parameters.filter((param) => param.required).map((param) => param.name),
  };

  if (!hasBodySchema) {
    return parameterSchema;
  }

  if (!hasParams) {
    return requestBodySchema;
  }

  return {
    allOf: [parameterSchema, requestBodySchema],
  };
}

export function buildOpenApiArgPreviewKeys(
  parameters: OpenApiParameterHint[],
  requestBodySchema: Record<string, unknown>,
  componentSchemas?: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const parameter of parameters) {
    if (!parameter.required) continue;
    pushUnique(keys, seen, parameter.name);
  }

  for (const key of collectTopLevelSchemaKeys(requestBodySchema, componentSchemas)) {
    pushUnique(keys, seen, key);
  }

  for (const parameter of parameters) {
    if (parameter.required) continue;
    pushUnique(keys, seen, parameter.name);
  }

  return keys;
}

/**
 * Convert JSON Schema to TypeScript type strings.
 *
 * Both MCP tools and OpenAPI specs use JSON Schema for their type definitions.
 * This module converts them to TypeScript type strings for the typechecker,
 * and also creates Zod schemas for runtime validation.
 *
 * Type string generation uses openapi-typescript's `transformSchemaObject` for
 * high-fidelity conversion (handles allOf, oneOf, enums, nullable, etc.).
 * Falls back to our simpler hand-rolled converter for edge cases.
 */

import { astToString, transformSchemaObject } from "openapi-typescript";
import { z } from "zod";

// ---------------------------------------------------------------------------
// openapi-typescript context (for individual schema conversion)
// ---------------------------------------------------------------------------

function makeTransformCtx() {
  return {
    additionalProperties: false,
    alphabetize: false,
    arrayLength: false,
    defaultNonNullable: true,
    discriminators: { refsHandled: [] as string[], objects: {} as Record<string, unknown> },
    emptyObjectsUnknown: false,
    enum: false,
    enumValues: false,
    excludeDeprecated: false,
    exportType: false,
    immutable: false,
    indentLv: 0,
    pathParamsAsTypes: false,
    postTransform: undefined,
    propertiesRequiredByDefault: false,
    redoc: undefined,
    silent: true,
    resolve(_ref: string) { return undefined as unknown; },
  };
}

// ---------------------------------------------------------------------------
// JSON Schema types (minimal subset we need)
// ---------------------------------------------------------------------------

export interface JsonSchema {
  type?: string | string[] | undefined;
  properties?: Record<string, JsonSchema> | undefined;
  required?: string[] | undefined;
  items?: JsonSchema | undefined;
  enum?: unknown[] | undefined;
  const?: unknown;
  oneOf?: JsonSchema[] | undefined;
  anyOf?: JsonSchema[] | undefined;
  allOf?: JsonSchema[] | undefined;
  $ref?: string | undefined;
  description?: string | undefined;
  format?: string | undefined;
  additionalProperties?: boolean | JsonSchema | undefined;
}

// ---------------------------------------------------------------------------
// JSON Schema → TypeScript string (via openapi-typescript)
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema to a TypeScript type string.
 *
 * Uses openapi-typescript's `transformSchemaObject` for high-fidelity conversion
 * that handles allOf, oneOf, enums, nullable, additionalProperties, etc.
 * Falls back to "any" for schemas that can't be converted (e.g. circular refs).
 */
export function jsonSchemaToTypeString(schema: JsonSchema): string {
  if (!schema) return "any";
  try {
    const node = transformSchemaObject(schema as never, {
      path: "#",
      ctx: makeTransformCtx() as never,
    });
    return astToString(node).trim();
  } catch {
    return "any";
  }
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod schema
// ---------------------------------------------------------------------------

export function jsonSchemaToZod(schema: JsonSchema): z.ZodType {
  if (!schema.type && schema.properties) {
    return objectToZod(schema);
  }

  if (schema.enum) {
    if (
      schema.enum.length > 0 &&
      schema.enum.every((v): v is string => typeof v === "string")
    ) {
      return z.enum(schema.enum as [string, ...string[]]);
    }
    return z.any();
  }

  if (schema.const !== undefined) {
    return z.literal(schema.const as string | number | boolean);
  }

  if (schema.oneOf) {
    const schemas = schema.oneOf.map(jsonSchemaToZod);
    if (schemas.length === 0) return z.any();
    if (schemas.length === 1) return schemas[0]!;
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)]);
  }

  if (schema.anyOf) {
    const schemas = schema.anyOf.map(jsonSchemaToZod);
    if (schemas.length === 0) return z.any();
    if (schemas.length === 1) return schemas[0]!;
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)]);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array": {
      if (schema.items) {
        return z.array(jsonSchemaToZod(schema.items));
      }
      return z.array(z.unknown());
    }
    case "object":
      return objectToZod(schema);
    default:
      return z.any();
  }
}

function objectToZod(schema: JsonSchema): z.ZodType {
  const props = schema.properties;
  if (!props || Object.keys(props).length === 0) {
    return z.record(z.string(), z.unknown());
  }

  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const zodType = jsonSchemaToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }

  return z.object(shape);
}

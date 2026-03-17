import {
  DiagnosticIdSchema,
  DocumentIdSchema,
  ResourceIdSchema,
  ShapeSymbolIdSchema,
} from "@executor/ir/ids";
import type {
  ImportDiagnostic,
  NativeBlob,
  ShapeNode,
  ShapeSymbol,
} from "@executor/ir/model";

import type { Source } from "./source-models";
import type {
  CatalogFragmentBuilder,
  JsonSchemaImporter,
} from "./catalog-types";
import {
  asJsonRecord,
  docsFrom,
  mutableRecord,
  provenanceFor,
  sourceKindFromSource,
  stableHash,
  stableStringify,
} from "./catalog-shared";

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asStringArray = (value: unknown): string[] =>
  asArray(value).flatMap((entry) => {
    const stringValue = asString(entry);
    return stringValue === null ? [] : [stringValue];
  });

const addDiagnostic = (
  catalog: CatalogFragmentBuilder,
  input: Omit<ImportDiagnostic, "id">,
) => {
  const id = DiagnosticIdSchema.make(`diag_${stableHash(input)}`);
  mutableRecord(catalog.diagnostics)[id] = {
    id,
    ...input,
  };
  return id;
};

const nativeBlob = (input: {
  source: Pick<Source, "kind">;
  kind: string;
  pointer: string;
  value: unknown;
  summary?: string;
}): NativeBlob => ({
  sourceKind: sourceKindFromSource(input.source),
  kind: input.kind,
  pointer: input.pointer,
  encoding: "json",
  ...(input.summary ? { summary: input.summary } : {}),
  value: input.value,
});

export const createJsonSchemaImporter = (input: {
  catalog: CatalogFragmentBuilder;
  source: Pick<Source, "kind">;
  resourceId: ReturnType<typeof ResourceIdSchema.make>;
  documentId: ReturnType<typeof DocumentIdSchema.make>;
}): JsonSchemaImporter => {
  const cache = new Map<string, ReturnType<typeof ShapeSymbolIdSchema.make>>();
  const structuralCache = new Map<
    string,
    ReturnType<typeof ShapeSymbolIdSchema.make>
  >();
  const dedupedShapeIds = new Map<
    ReturnType<typeof ShapeSymbolIdSchema.make>,
    ReturnType<typeof ShapeSymbolIdSchema.make>
  >();
  const activeShapeIds: ReturnType<typeof ShapeSymbolIdSchema.make>[] = [];
  const recursiveShapeIds = new Set<
    ReturnType<typeof ShapeSymbolIdSchema.make>
  >();

  const resolvePointer = (root: unknown, pointer: string): unknown => {
    if (pointer === "#" || pointer.length === 0) {
      return root;
    }

    const segments = pointer
      .replace(/^#\//, "")
      .split("/")
      .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
    let current: unknown = root;
    for (const segment of segments) {
      if (Array.isArray(current)) {
        const index = Number(segment);
        current = Number.isInteger(index) ? current[index] : undefined;
        continue;
      }

      current = asObject(current)[segment];
    }

    return current;
  };

  const importSchema = (
    schema: unknown,
    key: string,
    rootSchema?: unknown,
  ): ReturnType<typeof ShapeSymbolIdSchema.make> => {
    const stableKey = `${input.resourceId}:${key}`;
    const cached = cache.get(stableKey);
    if (cached) {
      const cycleIndex = activeShapeIds.indexOf(cached);
      if (cycleIndex !== -1) {
        for (const activeShapeId of activeShapeIds.slice(cycleIndex)) {
          recursiveShapeIds.add(activeShapeId);
        }
      }
      return cached;
    }

    const shapeId = ShapeSymbolIdSchema.make(
      `shape_${stableHash({ resourceId: input.resourceId, key })}`,
    );
    cache.set(stableKey, shapeId);
    activeShapeIds.push(shapeId);

    try {
      const objectSchema = asObject(schema);
      const title = asString(objectSchema.title) ?? undefined;
      const docs = docsFrom({
        description: asString(objectSchema.description),
      });
      const deprecated = asBoolean(objectSchema.deprecated) ?? undefined;

      const register = (
        node: ShapeNode,
        extras: {
          native?: NativeBlob[];
          diagnosticIds?: ReturnType<typeof DiagnosticIdSchema.make>[];
        } = {},
      ): ReturnType<typeof ShapeSymbolIdSchema.make> => {
        const signature = stableStringify(node);
        const recursive = recursiveShapeIds.has(shapeId);
        const existingShapeId = recursive
          ? undefined
          : structuralCache.get(signature);

        if (existingShapeId) {
          const existingShape = input.catalog.symbols[existingShapeId];
          if (existingShape?.kind === "shape") {
            if (existingShape.title === undefined && title) {
              mutableRecord(input.catalog.symbols)[existingShapeId] = {
                ...existingShape,
                title,
              } satisfies ShapeSymbol;
            }
            if (existingShape.docs === undefined && docs) {
              mutableRecord(input.catalog.symbols)[existingShapeId] = {
                ...(mutableRecord(input.catalog.symbols)[
                  existingShapeId
                ] as ShapeSymbol),
                docs,
              } satisfies ShapeSymbol;
            }
            if (
              existingShape.deprecated === undefined &&
              deprecated !== undefined
            ) {
              mutableRecord(input.catalog.symbols)[existingShapeId] = {
                ...(mutableRecord(input.catalog.symbols)[
                  existingShapeId
                ] as ShapeSymbol),
                deprecated,
              } satisfies ShapeSymbol;
            }
          }
          dedupedShapeIds.set(shapeId, existingShapeId);
          cache.set(stableKey, existingShapeId);
          return existingShapeId;
        }

        mutableRecord(input.catalog.symbols)[shapeId] = {
          id: shapeId,
          kind: "shape",
          resourceId: input.resourceId,
          ...(title ? { title } : {}),
          ...(docs ? { docs } : {}),
          ...(deprecated !== undefined ? { deprecated } : {}),
          node,
          synthetic: false,
          provenance: provenanceFor(input.documentId, key),
          ...(extras.diagnosticIds && extras.diagnosticIds.length > 0
            ? { diagnosticIds: extras.diagnosticIds }
            : {}),
          ...(extras.native && extras.native.length > 0
            ? { native: extras.native }
            : {}),
        } satisfies ShapeSymbol;

        if (!recursive) {
          structuralCache.set(signature, shapeId);
        }

        return shapeId;
      };

      if (typeof schema === "boolean") {
        return register({
          type: "unknown",
          reason: schema ? "schema_true" : "schema_false",
        });
      }

      const ref = asString(objectSchema.$ref);
      if (ref !== null) {
        const resolved = ref.startsWith("#")
          ? resolvePointer(rootSchema ?? schema, ref)
          : undefined;

        if (resolved === undefined) {
          const diagnosticId = addDiagnostic(input.catalog, {
            level: "warning",
            code: "unresolved_ref",
            message: `Unresolved JSON schema ref ${ref}`,
            provenance: provenanceFor(input.documentId, key),
            relatedSymbolIds: [shapeId],
          });
          register(
            {
              type: "unknown",
              reason: `unresolved_ref:${ref}`,
            },
            {
              diagnosticIds: [diagnosticId],
            },
          );
          return cache.get(stableKey)!;
        }

        const target = importSchema(resolved, ref, rootSchema ?? schema);
        return register({
          type: "ref",
          target,
        });
      }

      const enumValues = asArray(objectSchema.enum);
      if (enumValues.length === 1) {
        return register({
          type: "const",
          value: enumValues[0],
        });
      }

      if (enumValues.length > 1) {
        return register({
          type: "enum",
          values: enumValues,
        });
      }

      if ("const" in objectSchema) {
        return register({
          type: "const",
          value: objectSchema.const,
        });
      }

      const anyOf = asArray(objectSchema.anyOf);
      if (anyOf.length > 0) {
        return register({
          type: "anyOf",
          items: anyOf.map((entry, index) =>
            importSchema(entry, `${key}/anyOf/${index}`, rootSchema ?? schema),
          ),
        });
      }

      const allOf = asArray(objectSchema.allOf);
      if (allOf.length > 0) {
        return register({
          type: "allOf",
          items: allOf.map((entry, index) =>
            importSchema(entry, `${key}/allOf/${index}`, rootSchema ?? schema),
          ),
        });
      }

      const oneOf = asArray(objectSchema.oneOf);
      if (oneOf.length > 0) {
        return register({
          type: "oneOf",
          items: oneOf.map((entry, index) =>
            importSchema(entry, `${key}/oneOf/${index}`, rootSchema ?? schema),
          ),
        });
      }

      if (
        "if" in objectSchema ||
        "then" in objectSchema ||
        "else" in objectSchema
      ) {
        return register({
          type: "conditional",
          ifShapeId: importSchema(
            objectSchema.if ?? {},
            `${key}/if`,
            rootSchema ?? schema,
          ),
          thenShapeId: importSchema(
            objectSchema.then ?? {},
            `${key}/then`,
            rootSchema ?? schema,
          ),
          ...(objectSchema.else !== undefined
            ? {
                elseShapeId: importSchema(
                  objectSchema.else,
                  `${key}/else`,
                  rootSchema ?? schema,
                ),
              }
            : {}),
        });
      }

      if ("not" in objectSchema) {
        return register({
          type: "not",
          itemShapeId: importSchema(
            objectSchema.not,
            `${key}/not`,
            rootSchema ?? schema,
          ),
        });
      }

      const declaredType = objectSchema.type;
      const typeArray = Array.isArray(declaredType)
        ? declaredType.flatMap((entry) => {
            const value = asString(entry);
            return value === null ? [] : [value];
          })
        : [];
      const nullable =
        asBoolean(objectSchema.nullable) === true || typeArray.includes("null");
      const effectiveType = Array.isArray(declaredType)
        ? (typeArray.find((entry) => entry !== "null") ?? null)
        : asString(declaredType);

      const registerNullable = (
        itemShapeId: ReturnType<typeof ShapeSymbolIdSchema.make>,
      ) => {
        register({
          type: "nullable",
          itemShapeId,
        });
        return shapeId;
      };

      const constraints: Record<string, unknown> = {};
      for (const constraintKey of [
        "format",
        "minLength",
        "maxLength",
        "pattern",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "default",
        "examples",
      ]) {
        if (objectSchema[constraintKey] !== undefined) {
          constraints[constraintKey] = objectSchema[constraintKey];
        }
      }

      if (
        effectiveType === "object" ||
        "properties" in objectSchema ||
        "additionalProperties" in objectSchema ||
        "patternProperties" in objectSchema
      ) {
        const fields = Object.fromEntries(
          Object.entries(asObject(objectSchema.properties)).map(
            ([fieldName, fieldSchema]) => [
              fieldName,
              {
                shapeId: importSchema(
                  fieldSchema,
                  `${key}/properties/${fieldName}`,
                  rootSchema ?? schema,
                ),
                ...(docsFrom({
                  description: asString(asObject(fieldSchema).description),
                })
                  ? {
                      docs: docsFrom({
                        description: asString(
                          asObject(fieldSchema).description,
                        ),
                      })!,
                    }
                  : {}),
              },
            ],
          ),
        );

        const patternProperties = Object.fromEntries(
          Object.entries(asObject(objectSchema.patternProperties)).map(
            ([pattern, value]) => [
              pattern,
              importSchema(
                value,
                `${key}/patternProperties/${pattern}`,
                rootSchema ?? schema,
              ),
            ],
          ),
        );

        const additionalPropertiesValue = objectSchema.additionalProperties;
        const additionalProperties =
          typeof additionalPropertiesValue === "boolean"
            ? additionalPropertiesValue
            : additionalPropertiesValue !== undefined
              ? importSchema(
                  additionalPropertiesValue,
                  `${key}/additionalProperties`,
                  rootSchema ?? schema,
                )
              : undefined;

        const objectNode: ShapeNode = {
          type: "object",
          fields,
          ...(asStringArray(objectSchema.required).length > 0
            ? { required: asStringArray(objectSchema.required) }
            : {}),
          ...(additionalProperties !== undefined
            ? { additionalProperties }
            : {}),
          ...(Object.keys(patternProperties).length > 0
            ? { patternProperties }
            : {}),
        };

        if (nullable) {
          const innerId = importSchema(
            {
              ...objectSchema,
              nullable: false,
              type: "object",
            },
            `${key}:nonnull`,
            rootSchema ?? schema,
          );
          return registerNullable(innerId);
        }

        return register(objectNode);
      }

      if (
        effectiveType === "array" ||
        "items" in objectSchema ||
        "prefixItems" in objectSchema
      ) {
        if (
          Array.isArray(objectSchema.prefixItems) &&
          objectSchema.prefixItems.length > 0
        ) {
          const tupleNode: ShapeNode = {
            type: "tuple",
            itemShapeIds: objectSchema.prefixItems.map((entry, index) =>
              importSchema(
                entry,
                `${key}/prefixItems/${index}`,
                rootSchema ?? schema,
              ),
            ),
            ...(objectSchema.items !== undefined
              ? {
                  additionalItems:
                    typeof objectSchema.items === "boolean"
                      ? objectSchema.items
                      : importSchema(
                          objectSchema.items,
                          `${key}/items`,
                          rootSchema ?? schema,
                        ),
                }
              : {}),
          };

          if (nullable) {
            const innerId = importSchema(
              {
                ...objectSchema,
                nullable: false,
                type: "array",
              },
              `${key}:nonnull`,
              rootSchema ?? schema,
            );
            return registerNullable(innerId);
          }

          return register(tupleNode);
        }

        const items = objectSchema.items ?? {};
        const arrayNode: ShapeNode = {
          type: "array",
          itemShapeId: importSchema(
            items,
            `${key}/items`,
            rootSchema ?? schema,
          ),
          ...(asNumber(objectSchema.minItems) !== null
            ? { minItems: asNumber(objectSchema.minItems)! }
            : {}),
          ...(asNumber(objectSchema.maxItems) !== null
            ? { maxItems: asNumber(objectSchema.maxItems)! }
            : {}),
        };

        if (nullable) {
          const innerId = importSchema(
            {
              ...objectSchema,
              nullable: false,
              type: "array",
            },
            `${key}:nonnull`,
            rootSchema ?? schema,
          );
          return registerNullable(innerId);
        }

        return register(arrayNode);
      }

      if (
        effectiveType === "string" ||
        effectiveType === "number" ||
        effectiveType === "integer" ||
        effectiveType === "boolean" ||
        effectiveType === "null"
      ) {
        const scalar =
          effectiveType === "null"
            ? "null"
            : effectiveType === "integer"
              ? "integer"
              : effectiveType === "number"
                ? "number"
                : effectiveType === "boolean"
                  ? "boolean"
                  : asString(objectSchema.format) === "binary"
                    ? "bytes"
                    : "string";

        const scalarNode: ShapeNode = {
          type: "scalar",
          scalar,
          ...(asString(objectSchema.format)
            ? { format: asString(objectSchema.format)! }
            : {}),
          ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
        };

        if (nullable && scalar !== "null") {
          const innerId = importSchema(
            {
              ...objectSchema,
              nullable: false,
              type: effectiveType,
            },
            `${key}:nonnull`,
            rootSchema ?? schema,
          );
          return registerNullable(innerId);
        }

        return register(scalarNode);
      }

      return register(
        {
          type: "unknown",
          reason: `unsupported_schema:${key}`,
        },
        {
          native: [
            nativeBlob({
              source: input.source,
              kind: "json_schema",
              pointer: key,
              value: schema,
              summary: "Unsupported JSON schema preserved natively",
            }),
          ],
        },
      );
    } finally {
      const poppedShapeId = activeShapeIds.pop();
      if (poppedShapeId !== shapeId) {
        throw new Error(`JSON schema importer stack mismatch for ${shapeId}`);
      }
    }
  };

  return {
    importSchema: (schema, key, rootSchema) =>
      importSchema(schema, key, rootSchema ?? schema),
    finalize: () => {
      const rewriteDedupedShapeIds = (value: unknown): void => {
        if (typeof value === "string") {
          return;
        }
        if (!value || typeof value !== "object") {
          return;
        }
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) {
            const entry = value[index];
            if (
              typeof entry === "string" &&
              dedupedShapeIds.has(
                entry as ReturnType<typeof ShapeSymbolIdSchema.make>,
              )
            ) {
              value[index] = dedupedShapeIds.get(
                entry as ReturnType<typeof ShapeSymbolIdSchema.make>,
              )!;
            } else {
              rewriteDedupedShapeIds(entry);
            }
          }
          return;
        }

        for (const [entryKey, entryValue] of Object.entries(value)) {
          if (
            typeof entryValue === "string" &&
            dedupedShapeIds.has(
              entryValue as ReturnType<typeof ShapeSymbolIdSchema.make>,
            )
          ) {
            (value as Record<string, unknown>)[entryKey] = dedupedShapeIds.get(
              entryValue as ReturnType<typeof ShapeSymbolIdSchema.make>,
            )!;
          } else {
            rewriteDedupedShapeIds(entryValue);
          }
        }
      };

      rewriteDedupedShapeIds(input.catalog);
    },
  };
};

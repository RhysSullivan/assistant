type JsonObject = Record<string, unknown>;
type RefHintValue = string | JsonObject;

type DiscoveryTypingLike = {
  inputSchema?: unknown;
  outputSchema?: unknown;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const resolveSchemaNode = (
  value: unknown,
  refHintTable: Readonly<Record<string, RefHintValue>>,
  parsedHintCache: Map<string, unknown>,
  activeRefs: ReadonlySet<string>,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveSchemaNode(item, refHintTable, parsedHintCache, activeRefs)
    );
  }

  if (!isJsonObject(value)) {
    return value;
  }

  const ref = typeof value.$ref === "string" ? value.$ref : null;
  if (ref && ref.startsWith("#/") && !activeRefs.has(ref)) {
    let resolvedRefValue = parsedHintCache.get(ref);

    if (resolvedRefValue === undefined) {
      const rawHint = refHintTable[ref];
      resolvedRefValue =
        typeof rawHint === "string"
          ? parseJson(rawHint)
          : isJsonObject(rawHint)
            ? rawHint
            : null;
      parsedHintCache.set(ref, resolvedRefValue);
    }

    if (resolvedRefValue !== null && resolvedRefValue !== undefined) {
      const nextActiveRefs = new Set(activeRefs);
      nextActiveRefs.add(ref);

      const { $ref: _ignoredRef, ...rest } = value;
      const resolvedTarget = resolveSchemaNode(
        resolvedRefValue,
        refHintTable,
        parsedHintCache,
        nextActiveRefs,
      );

      if (Object.keys(rest).length === 0) {
        return resolvedTarget;
      }

      const resolvedRest = resolveSchemaNode(
        rest,
        refHintTable,
        parsedHintCache,
        activeRefs,
      );

      if (isJsonObject(resolvedTarget) && isJsonObject(resolvedRest)) {
        return { ...resolvedTarget, ...resolvedRest };
      }

      return resolvedTarget;
    }
  }

  const next: JsonObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    next[key] = resolveSchemaNode(
      nestedValue,
      refHintTable,
      parsedHintCache,
      activeRefs,
    );
  }

  return next;
};

export const resolveSchemaWithRefHints = (
  schema: unknown,
  refHintTable: Readonly<Record<string, RefHintValue>> | undefined,
): unknown | null => {
  if (schema === undefined || schema === null) {
    return null;
  }

  if (!refHintTable || Object.keys(refHintTable).length === 0) {
    return schema;
  }

  const resolved = resolveSchemaNode(
    schema,
    refHintTable,
    new Map<string, unknown>(),
    new Set<string>(),
  );
  return resolved;
};

export const resolveTypingSchemasWithRefHints = (
  typing: DiscoveryTypingLike | undefined,
  refHintTable: Readonly<Record<string, RefHintValue>> | undefined,
): {
  inputSchema: unknown | null;
  outputSchema: unknown | null;
} => ({
  inputSchema: resolveSchemaWithRefHints(
    typing?.inputSchema,
    refHintTable,
  ),
  outputSchema: resolveSchemaWithRefHints(
    typing?.outputSchema,
    refHintTable,
  ),
});

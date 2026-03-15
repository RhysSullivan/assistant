import { createHash } from "node:crypto";

import type { ProjectedCatalog } from "../ir/catalog";
import type { ShapeSymbolId } from "../ir/ids";
import type { CatalogV1, ShapeNode, ShapeSymbol } from "../ir/model";

export type CatalogTypeRoot = {
  readonly shapeId: ShapeSymbolId;
  readonly aliasHint: string;
};

type TypeRenderOptions = {
  readonly stack?: readonly ShapeSymbolId[];
  readonly aliasHint?: string;
};

type RenderShape = (shapeId: ShapeSymbolId, options?: TypeRenderOptions) => string;

type SignatureInfo = {
  readonly key: string;
  readonly recursive: boolean;
};

type ObjectLikeNode = Extract<ShapeNode, { type: "object" }> | Extract<ShapeNode, { type: "graphqlInterface" }>;

type RenderableObjectNode = {
  readonly fields: ObjectLikeNode["fields"];
  readonly required: readonly string[];
  readonly additionalProperties: Extract<ShapeNode, { type: "object" }>["additionalProperties"];
  readonly patternProperties: Readonly<Record<string, ShapeSymbolId>>;
};

type UnionVariantObject = {
  readonly shapeId: ShapeSymbolId;
  readonly node: Extract<ShapeNode, { type: "object" }>;
};

type DiscriminatorCandidate = {
  readonly key: string;
  readonly serializedValuesByVariant: readonly (readonly string[])[];
};

export type CatalogTypeProjector = {
  readonly renderSelfContainedShape: RenderShape;
  readonly renderDeclarationShape: RenderShape;
  readonly supportingDeclarations: () => readonly string[];
};

const VALID_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TYPE_ALIAS_REFERENCE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const hashSignature = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

export const formatPropertyKey = (value: string): string =>
  VALID_IDENTIFIER_PATTERN.test(value) ? value : JSON.stringify(value);

const typeNameWords = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0);

const pascalCaseWord = (value: string): string =>
  /^\d+$/.test(value)
    ? value
    : `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;

export const formatTypeNameSegment = (value: string): string => {
  const formatted = typeNameWords(value)
    .map((segment) => pascalCaseWord(segment))
    .join("");
  if (formatted.length === 0) {
    return "Type";
  }

  return /^[A-Za-z_$]/.test(formatted) ? formatted : `T${formatted}`;
};

export const joinTypeNameSegments = (...segments: ReadonlyArray<string>): string =>
  segments
    .map((segment) => formatTypeNameSegment(segment))
    .filter((segment) => segment.length > 0)
    .join("");

const primitiveTypeName = (value: string): string => {
  switch (value) {
    case "string":
    case "boolean":
      return value;
    case "bytes":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "null":
      return "null";
    case "object":
      return "Record<string, unknown>";
    case "array":
      return "Array<unknown>";
    default:
      throw new Error(`Unsupported JSON Schema primitive type: ${value}`);
  }
};

const jsonLiteral = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(`Unsupported literal value in declaration schema: ${String(value)}`);
  }
  return serialized;
};

const wrapCompositeType = (value: string): string =>
  value.includes(" | ") || value.includes(" & ")
    ? `(${value})`
    : value;

const objectTypeLiteral = (
  lines: readonly string[],
  indent: string,
): string => {
  if (lines.length === 0) {
    return "{}";
  }

  return [
    "{",
    ...lines.map((line) => `${indent}${line}`),
    `${indent.slice(0, -2)}}`,
  ].join("\n");
};

const getShapeSymbol = (catalog: CatalogV1, shapeId: ShapeSymbolId): ShapeSymbol => {
  const symbol = catalog.symbols[shapeId];
  if (!symbol || symbol.kind !== "shape") {
    throw new Error(`Missing shape symbol for ${shapeId}`);
  }

  return symbol;
};

const isInlineShapeNode = (node: ShapeNode): boolean =>
  node.type === "unknown"
  || node.type === "scalar"
  || node.type === "const"
  || node.type === "enum";

const isSyntheticShapeLabel = (value: string): boolean =>
  /^shape_[a-f0-9_]+$/i.test(value);

const looksLikeHumanPhrase = (value: string): boolean => /\s/.test(value.trim());

const compactAliasHint = (value: string): string => {
  const segments = typeNameWords(value);
  if (segments.length <= 5) {
    return joinTypeNameSegments(...segments);
  }

  const meaningful = segments.filter((segment, index) =>
    index >= segments.length - 2
    || !["item", "member", "value"].includes(segment.toLowerCase())
  );

  return joinTypeNameSegments(...meaningful.slice(-5));
};

const childShapeIds = (node: ShapeNode): ShapeSymbolId[] => {
  switch (node.type) {
    case "unknown":
    case "scalar":
    case "const":
    case "enum":
      return [];
    case "object":
      return [
        ...Object.values(node.fields).map((field) => field.shapeId),
        ...(typeof node.additionalProperties === "string" ? [node.additionalProperties] : []),
        ...Object.values(node.patternProperties ?? {}),
      ];
    case "array":
      return [node.itemShapeId];
    case "tuple":
      return [
        ...node.itemShapeIds,
        ...(typeof node.additionalItems === "string" ? [node.additionalItems] : []),
      ];
    case "map":
      return [node.valueShapeId];
    case "allOf":
    case "anyOf":
    case "oneOf":
      return [...node.items];
    case "nullable":
      return [node.itemShapeId];
    case "ref":
      return [node.target];
    case "not":
      return [node.itemShapeId];
    case "conditional":
      return [
        node.ifShapeId,
        ...(node.thenShapeId ? [node.thenShapeId] : []),
        ...(node.elseShapeId ? [node.elseShapeId] : []),
      ];
    case "graphqlInterface":
      return [
        ...Object.values(node.fields).map((field) => field.shapeId),
        ...node.possibleTypeIds,
      ];
    case "graphqlUnion":
      return [...node.memberTypeIds];
  }
};

const renderInlineShapeNode = (node: ShapeNode): string => {
  switch (node.type) {
    case "unknown":
      return "unknown";
    case "scalar":
      return primitiveTypeName(node.scalar);
    case "const":
      return jsonLiteral(node.value);
    case "enum":
      return node.values.map((value) => jsonLiteral(value)).join(" | ");
    default:
      throw new Error(`Cannot inline non-primitive shape node: ${node.type}`);
  }
};

const renderIndexValueType = (
  shapeIds: readonly ShapeSymbolId[],
  allowUnknown: boolean,
  aliasHint: string | undefined,
  stack: readonly ShapeSymbolId[],
  renderShape: RenderShape,
): string => {
  const members = new Set<string>();
  if (allowUnknown) {
    members.add("unknown");
  }

  for (const shapeId of shapeIds) {
    members.add(renderShape(shapeId, { stack, aliasHint }));
  }

  return [...members].sort((left, right) => left.localeCompare(right)).join(" | ");
};

const renderObjectNode = (
  node: RenderableObjectNode,
  stack: readonly ShapeSymbolId[],
  aliasHint: string | undefined,
  renderShape: RenderShape,
): string => {
  const required = new Set(node.required);
  const lines = Object.keys(node.fields)
    .sort((left, right) => left.localeCompare(right))
    .map((key) =>
      `${formatPropertyKey(key)}${required.has(key) ? "" : "?"}: ${renderShape(node.fields[key]!.shapeId, {
        stack,
        aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, key) : key,
      })};`
    );

  const patternShapeIds = Object.values(node.patternProperties ?? {});
  const hasUnknownIndex = node.additionalProperties === true;
  const additionalShapeIds = typeof node.additionalProperties === "string"
    ? [node.additionalProperties]
    : [];
  if (hasUnknownIndex || patternShapeIds.length > 0 || additionalShapeIds.length > 0) {
    lines.push(
      `[key: string]: ${renderIndexValueType(
        [...patternShapeIds, ...additionalShapeIds],
        hasUnknownIndex,
        aliasHint ? joinTypeNameSegments(aliasHint, "value") : "value",
        stack,
        renderShape,
      )};`,
    );
  }

  return objectTypeLiteral(lines, "  ");
};

const renderObjectFields = (
  node: ObjectLikeNode,
  stack: readonly ShapeSymbolId[],
  aliasHint: string | undefined,
  renderShape: RenderShape,
): string =>
  renderObjectNode(
    {
      fields: node.fields,
      required: node.type === "object" ? (node.required ?? []) : [],
      additionalProperties: node.type === "object" ? node.additionalProperties : false,
      patternProperties: node.type === "object" ? node.patternProperties ?? {} : {},
    },
    stack,
    aliasHint,
    renderShape,
  );

const renderShapeBody = (
  catalog: CatalogV1,
  shapeId: ShapeSymbolId,
  stack: readonly ShapeSymbolId[],
  aliasHint: string | undefined,
  renderShape: RenderShape,
): string => {
  const shape = getShapeSymbol(catalog, shapeId);
  const node = shape.node;

  switch (node.type) {
    case "unknown":
    case "scalar":
    case "const":
    case "enum":
      return renderInlineShapeNode(node);
    case "object":
    case "graphqlInterface":
      return renderObjectFields(node, stack, aliasHint, renderShape);
    case "array":
      return `Array<${wrapCompositeType(renderShape(node.itemShapeId, {
        stack,
        aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, "item") : "item",
      }))}>`;
    case "tuple": {
      const items = node.itemShapeIds.map((itemShapeId, index) =>
        renderShape(itemShapeId, {
          stack,
          aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, `item_${String(index + 1)}`) : `item_${String(index + 1)}`,
        })
      );
      const suffix = node.additionalItems === true
        ? ", ...unknown[]"
        : typeof node.additionalItems === "string"
          ? `, ...Array<${wrapCompositeType(renderShape(node.additionalItems, {
              stack,
              aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, "rest") : "rest",
            }))}>`
          : "";
      return `[${items.join(", ")}${suffix}]`;
    }
    case "map":
      return `Record<string, ${renderShape(node.valueShapeId, {
        stack,
        aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, "value") : "value",
      })}>`;
    case "allOf":
      return node.items.map((itemShapeId, index) =>
        wrapCompositeType(renderShape(itemShapeId, {
          stack,
          aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, `member_${String(index + 1)}`) : `member_${String(index + 1)}`,
        }))
      ).join(" & ");
    case "anyOf":
    case "oneOf":
      return node.items.map((itemShapeId, index) =>
        wrapCompositeType(renderShape(itemShapeId, {
          stack,
          aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, `member_${String(index + 1)}`) : `member_${String(index + 1)}`,
        }))
      ).join(" | ");
    case "nullable":
      return `${wrapCompositeType(renderShape(node.itemShapeId, { stack, aliasHint }))} | null`;
    case "ref":
      return renderShape(node.target, { stack, aliasHint });
    case "not":
    case "conditional":
      return "unknown";
    case "graphqlUnion":
      return node.memberTypeIds.map((memberTypeId, index) =>
        wrapCompositeType(renderShape(memberTypeId, {
          stack,
          aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, `member_${String(index + 1)}`) : `member_${String(index + 1)}`,
        }))
      ).join(" | ");
  }
};

export const createCatalogTypeProjector = (input: {
  catalog: CatalogV1;
  roots: readonly CatalogTypeRoot[];
}): CatalogTypeProjector => {
  const { catalog, roots } = input;
  const signatureCache = new Map<ShapeSymbolId, SignatureInfo>();
  const recursiveSignatures = new Set<string>();
  const shapeIdsBySignature = new Map<string, ShapeSymbolId[]>();
  const usageCountBySignature = new Map<string, number>();
  const aliasNameBySignature = new Map<string, string>();
  const canonicalTypeBySignature = new Map<string, string>();
  const rootAliasHintBySignature = new Map<string, string>();
  const usedAliasNames = new Set<string>();
  const usedAliasSignatures = new Set<string>();

  const shapeSignatureInfo = (shapeId: ShapeSymbolId, stack: readonly ShapeSymbolId[] = []): SignatureInfo => {
    const cached = signatureCache.get(shapeId);
    if (cached) {
      return cached;
    }

    if (stack.includes(shapeId)) {
      return {
        key: `cycle:${shapeId}`,
        recursive: true,
      };
    }

    const shape = getShapeSymbol(catalog, shapeId);
    const nextStack = [...stack, shapeId];
    const childSignatures = (shapeIds: readonly ShapeSymbolId[], sort: boolean): SignatureInfo[] => {
      const values = shapeIds.map((childShapeId) => shapeSignatureInfo(childShapeId, nextStack));
      return sort ? values.sort((left, right) => left.key.localeCompare(right.key)) : values;
    };
    let recursive = false;
    const childSignatureKey = (childShapeId: ShapeSymbolId): string => {
      const info = shapeSignatureInfo(childShapeId, nextStack);
      recursive = recursive || info.recursive;
      return info.key;
    };
    const childSignatureKeys = (shapeIds: readonly ShapeSymbolId[], sort: boolean): string[] => {
      const values = childSignatures(shapeIds, sort);
      recursive = recursive || values.some((value) => value.recursive);
      return values.map((value) => value.key);
    };

    const signatureBody = (() => {
      switch (shape.node.type) {
        case "unknown":
          return "unknown";
        case "scalar":
          return `scalar:${primitiveTypeName(shape.node.scalar)}`;
        case "const":
          return `const:${jsonLiteral(shape.node.value)}`;
        case "enum":
          return `enum:${shape.node.values.map((value) => jsonLiteral(value)).sort().join("|")}`;
        case "object": {
          const required = shape.node.required ?? [];
          const fields = Object.entries(shape.node.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, field]) => `${key}${required.includes(key) ? "!" : "?"}:${childSignatureKey(field.shapeId)}`)
            .join(",");
          const additionalProperties =
            shape.node.additionalProperties === true
              ? "unknown"
              : typeof shape.node.additionalProperties === "string"
                ? childSignatureKey(shape.node.additionalProperties)
                : "none";
          const patternProperties = Object.entries(shape.node.patternProperties ?? {})
            .map(([, valueShapeId]) => shapeSignatureInfo(valueShapeId, nextStack))
            .sort((left, right) => left.key.localeCompare(right.key))
            .map((value) => {
              recursive = recursive || value.recursive;
              return value.key;
            })
            .join("|");
          return `object:${fields}:index=${additionalProperties}:patterns=${patternProperties}`;
        }
        case "array":
          return `array:${childSignatureKey(shape.node.itemShapeId)}`;
        case "tuple":
          return `tuple:${childSignatureKeys(shape.node.itemShapeIds, false).join(",")}:rest=${
            shape.node.additionalItems === true
              ? "unknown"
              : typeof shape.node.additionalItems === "string"
                ? childSignatureKey(shape.node.additionalItems)
                : "none"
          }`;
        case "map":
          return `map:${childSignatureKey(shape.node.valueShapeId)}`;
        case "allOf":
          return `allOf:${childSignatureKeys(shape.node.items, true).join("&")}`;
        case "anyOf":
          return `anyOf:${childSignatureKeys(shape.node.items, true).join("|")}`;
        case "oneOf":
          return `oneOf:${childSignatureKeys(shape.node.items, true).join("|")}`;
        case "nullable":
          return `nullable:${childSignatureKey(shape.node.itemShapeId)}`;
        case "ref":
          return childSignatureKey(shape.node.target);
        case "not":
        case "conditional":
          return "unknown";
        case "graphqlInterface": {
          const fields = Object.entries(shape.node.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, field]) => `${key}:${childSignatureKey(field.shapeId)}`)
            .join(",");
          const possibleTypes = childSignatureKeys(shape.node.possibleTypeIds, true).join("|");
          return `graphqlInterface:${fields}:possible=${possibleTypes}`;
        }
        case "graphqlUnion":
          return `graphqlUnion:${childSignatureKeys(shape.node.memberTypeIds, true).join("|")}`;
      }
    })();

    const signature: SignatureInfo = {
      key: `sig:${hashSignature(signatureBody)}`,
      recursive,
    };

    if (signature.recursive) {
      recursiveSignatures.add(signature.key);
    }

    signatureCache.set(shapeId, signature);
    const group = shapeIdsBySignature.get(signature.key);
    if (group) {
      group.push(shapeId);
    } else {
      shapeIdsBySignature.set(signature.key, [shapeId]);
    }
    return signature;
  };

  const shapeSignature = (shapeId: ShapeSymbolId, stack: readonly ShapeSymbolId[] = []): string =>
    shapeSignatureInfo(shapeId, stack).key;

  const reachableShapeIds = new Set<ShapeSymbolId>();

  const collectReachableShapes = (shapeId: ShapeSymbolId): void => {
    if (reachableShapeIds.has(shapeId)) {
      return;
    }

    reachableShapeIds.add(shapeId);
    for (const childShapeId of childShapeIds(getShapeSymbol(catalog, shapeId).node)) {
      collectReachableShapes(childShapeId);
    }
  };

  for (const root of roots) {
    collectReachableShapes(root.shapeId);
  }

  for (const rootShapeId of roots.map((root) => root.shapeId)) {
    const rootShape = getShapeSymbol(catalog, rootShapeId);
    if (isInlineShapeNode(rootShape.node)) {
      continue;
    }

    const signature = shapeSignature(rootShapeId);
    usageCountBySignature.set(signature, (usageCountBySignature.get(signature) ?? 0) + 1);
  }

  for (const shapeId of reachableShapeIds) {
    for (const childShapeId of childShapeIds(getShapeSymbol(catalog, shapeId).node)) {
      const childShape = getShapeSymbol(catalog, childShapeId);
      if (isInlineShapeNode(childShape.node)) {
        continue;
      }

      const signature = shapeSignature(childShapeId);
      usageCountBySignature.set(signature, (usageCountBySignature.get(signature) ?? 0) + 1);
    }
  }

  for (const root of roots) {
    const signature = shapeSignature(root.shapeId);
    const existing = rootAliasHintBySignature.get(signature);
    if (!existing || root.aliasHint.length < existing.length) {
      rootAliasHintBySignature.set(signature, root.aliasHint);
    }
  }

  const resolveUnionVariantObject = (
    shapeId: ShapeSymbolId,
    seen: readonly ShapeSymbolId[] = [],
  ): UnionVariantObject | null => {
    if (seen.includes(shapeId)) {
      return null;
    }

    const shape = getShapeSymbol(catalog, shapeId);
    switch (shape.node.type) {
      case "ref":
        return resolveUnionVariantObject(shape.node.target, [...seen, shapeId]);
      case "object":
        return {
          shapeId,
          node: shape.node,
        };
      default:
        return null;
    }
  };

  const literalValuesForDiscriminator = (
    shapeId: ShapeSymbolId,
    seen: readonly ShapeSymbolId[] = [],
  ): readonly string[] | null => {
    if (seen.includes(shapeId)) {
      return null;
    }

    const shape = getShapeSymbol(catalog, shapeId);
    switch (shape.node.type) {
      case "ref":
        return literalValuesForDiscriminator(shape.node.target, [...seen, shapeId]);
      case "const":
        return [jsonLiteral(shape.node.value)];
      case "enum":
        return shape.node.values.map((value) => jsonLiteral(value));
      default:
        return null;
    }
  };

  const sameAdditionalProperties = (variants: readonly UnionVariantObject[]): boolean => {
    const [first, ...rest] = variants;
    if (!first) {
      return false;
    }

    return rest.every((variant) => {
      const left = first.node.additionalProperties;
      const right = variant.node.additionalProperties;
      if (left === right) {
        return true;
      }
      return typeof left === "string"
        && typeof right === "string"
        && shapeSignature(left) === shapeSignature(right);
    });
  };

  const samePatternProperties = (variants: readonly UnionVariantObject[]): boolean => {
    const [first, ...rest] = variants;
    if (!first) {
      return false;
    }

    const firstKeys = Object.keys(first.node.patternProperties ?? {}).sort();
    return rest.every((variant) => {
      const keys = Object.keys(variant.node.patternProperties ?? {}).sort();
      if (keys.length !== firstKeys.length || keys.some((key, index) => key !== firstKeys[index])) {
        return false;
      }

      return keys.every((key) =>
        shapeSignature(first.node.patternProperties?.[key]!) === shapeSignature(variant.node.patternProperties?.[key]!)
      );
    });
  };

  const sharedDiscriminatorCandidate = (
    variants: readonly UnionVariantObject[],
  ): DiscriminatorCandidate | null => {
    const [first] = variants;
    if (!first) {
      return null;
    }

    const preferredKeys = ["type", "kind", "action", "status", "event"];
    const requiredInAll = Object.keys(first.node.fields).filter((key) =>
      variants.every((variant) => (variant.node.required ?? []).includes(key))
    );
    const candidates = requiredInAll.flatMap((key) => {
      const serializedValuesByVariant = variants.map((variant) => {
        const field = variant.node.fields[key];
        return field ? literalValuesForDiscriminator(field.shapeId) : null;
      });
      if (serializedValuesByVariant.some((value) => value === null || value.length === 0)) {
        return [];
      }

      const seen = new Set<string>();
      for (const values of serializedValuesByVariant as readonly (readonly string[])[]) {
        for (const value of values) {
          if (seen.has(value)) {
            return [];
          }
          seen.add(value);
        }
      }

      return [{
        key,
        serializedValuesByVariant: serializedValuesByVariant as readonly (readonly string[])[],
      } satisfies DiscriminatorCandidate];
    });

    const sorted = candidates.sort((left, right) => {
      const leftPreferred = preferredKeys.indexOf(left.key);
      const rightPreferred = preferredKeys.indexOf(right.key);
      const leftRank = leftPreferred === -1 ? Number.MAX_SAFE_INTEGER : leftPreferred;
      const rightRank = rightPreferred === -1 ? Number.MAX_SAFE_INTEGER : rightPreferred;
      return leftRank - rightRank || left.key.localeCompare(right.key);
    });

    return sorted[0] ?? null;
  };

  const variantAliasLabel = (candidate: DiscriminatorCandidate | null, index: number): string => {
    const serializedValue = candidate?.serializedValuesByVariant[index]?.[0];
    if (!serializedValue) {
      return `Variant${String(index + 1)}`;
    }

    if (serializedValue.startsWith("\"") && serializedValue.endsWith("\"")) {
      return formatTypeNameSegment(serializedValue.slice(1, -1));
    }

    return formatTypeNameSegment(serializedValue);
  };

  const normalizedUnionRender = (
    shapeIds: readonly ShapeSymbolId[],
    stack: readonly ShapeSymbolId[],
    aliasHint: string | undefined,
    renderShape: RenderShape,
  ): string | null => {
    const variants = shapeIds.map((shapeId) => resolveUnionVariantObject(shapeId));
    if (variants.some((variant) => variant === null)) {
      return null;
    }

    const objectVariants = variants as readonly UnionVariantObject[];
    if (objectVariants.length === 0 || !sameAdditionalProperties(objectVariants) || !samePatternProperties(objectVariants)) {
      return null;
    }

    const discriminator = sharedDiscriminatorCandidate(objectVariants);
    const [firstVariant] = objectVariants;
    if (!firstVariant) {
      return null;
    }

    const sharedFieldKeys = Object.keys(firstVariant.node.fields)
      .filter((key) => key !== discriminator?.key)
      .filter((key) => {
        const firstField = firstVariant.node.fields[key];
        if (!firstField) {
          return false;
        }

        const firstRequired = (firstVariant.node.required ?? []).includes(key);
        return objectVariants.every((variant) => {
          const field = variant.node.fields[key];
          if (!field) {
            return false;
          }

          const required = (variant.node.required ?? []).includes(key);
          return required === firstRequired
            && shapeSignature(field.shapeId) === shapeSignature(firstField.shapeId);
        });
      });

    const sharedNode: RenderableObjectNode = {
      fields: Object.fromEntries(sharedFieldKeys.map((key) => [key, firstVariant.node.fields[key]!])),
      required: sharedFieldKeys.filter((key) => (firstVariant.node.required ?? []).includes(key)),
      additionalProperties: firstVariant.node.additionalProperties,
      patternProperties: firstVariant.node.patternProperties ?? {},
    };

    const baseHasSharedStructure = sharedFieldKeys.length > 0
      || sharedNode.additionalProperties === true
      || typeof sharedNode.additionalProperties === "string"
      || Object.keys(sharedNode.patternProperties).length > 0;

    if (!baseHasSharedStructure && discriminator === null) {
      return null;
    }

    const baseText = baseHasSharedStructure
      ? renderObjectNode(sharedNode, stack, aliasHint, renderShape)
      : null;

    const variantTexts = objectVariants.map((variant, index) => {
      const variantFieldKeys = Object.keys(variant.node.fields)
        .filter((key) => !sharedFieldKeys.includes(key));
      const variantNode: RenderableObjectNode = {
        fields: Object.fromEntries(variantFieldKeys.map((key) => [key, variant.node.fields[key]!])),
        required: variantFieldKeys.filter((key) => (variant.node.required ?? []).includes(key)),
        additionalProperties: false,
        patternProperties: {},
      };
      return renderObjectNode(
        variantNode,
        stack,
        aliasHint ? joinTypeNameSegments(aliasHint, variantAliasLabel(discriminator, index)) : variantAliasLabel(discriminator, index),
        renderShape,
      );
    });
    const unionText = variantTexts.map((variantText) => wrapCompositeType(variantText)).join(" | ");

    return baseText ? `${wrapCompositeType(baseText)} & (${unionText})` : unionText;
  };

  const representativeShapeIdForSignature = (signature: string): ShapeSymbolId => {
    const group = shapeIdsBySignature.get(signature);
    if (!group || group.length === 0) {
      throw new Error(`Missing representative shape for signature ${signature}`);
    }

    const sorted = [...group].sort((left, right) => {
      const leftShape = getShapeSymbol(catalog, left);
      const rightShape = getShapeSymbol(catalog, right);
      const leftTitle = leftShape.title ?? leftShape.id;
      const rightTitle = rightShape.title ?? rightShape.id;
      const leftRefPenalty = leftShape.node.type === "ref" ? 1 : 0;
      const rightRefPenalty = rightShape.node.type === "ref" ? 1 : 0;
      const leftSynthetic = isSyntheticShapeLabel(leftTitle) ? 1 : 0;
      const rightSynthetic = isSyntheticShapeLabel(rightTitle) ? 1 : 0;
      return leftRefPenalty - rightRefPenalty
        || leftSynthetic - rightSynthetic
        || leftTitle.localeCompare(rightTitle);
    });

    return sorted[0]!;
  };

  const aliasNameForSignature = (signature: string, hint?: string): string => {
    const existing = aliasNameBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const representative = getShapeSymbol(catalog, representativeShapeIdForSignature(signature));
    const representativeName = representative.title ?? representative.id;
    const rootHint = rootAliasHintBySignature.get(signature);
    const contextualHint = hint ? compactAliasHint(joinTypeNameSegments(hint)) : undefined;
    const representativeTypeName = !isSyntheticShapeLabel(representativeName) && !looksLikeHumanPhrase(representativeName)
      ? formatTypeNameSegment(representativeName)
      : undefined;
    const baseName = rootHint
      ?? representativeTypeName
      ?? contextualHint
      ?? formatTypeNameSegment(representative.id);
    let candidate = baseName;
    let suffix = 2;
    while (usedAliasNames.has(candidate)) {
      candidate = `${baseName}_${String(suffix)}`;
      suffix += 1;
    }

    aliasNameBySignature.set(signature, candidate);
    usedAliasNames.add(candidate);
    return candidate;
  };

  const shouldAliasSignature = (signature: string): boolean =>
    recursiveSignatures.has(signature) || (usageCountBySignature.get(signature) ?? 0) > 1;

  const renderDeclarationShapeBody = (
    shapeId: ShapeSymbolId,
    stack: readonly ShapeSymbolId[],
    aliasHint?: string,
  ): string => {
    const shape = getShapeSymbol(catalog, shapeId);
    switch (shape.node.type) {
      case "anyOf":
      case "oneOf": {
        const normalized = normalizedUnionRender(shape.node.items, stack, aliasHint, renderDeclarationShape);
        return normalized ?? renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape);
      }
      case "graphqlUnion": {
        const normalized = normalizedUnionRender(shape.node.memberTypeIds, stack, aliasHint, renderDeclarationShape);
        return normalized ?? renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape);
      }
      default:
        return renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape);
    }
  };

  const canonicalTypeForSignature = (signature: string, hint?: string): string => {
    const existing = canonicalTypeBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const aliasName = aliasNameForSignature(signature, hint);
    canonicalTypeBySignature.set(signature, aliasName);
    const representativeShapeId = representativeShapeIdForSignature(signature);
    const body = renderDeclarationShapeBody(representativeShapeId, [representativeShapeId], aliasName);
    const canonical = TYPE_ALIAS_REFERENCE_PATTERN.test(body) && body !== aliasName
      ? body
      : aliasName;
    canonicalTypeBySignature.set(signature, canonical);
    return canonical;
  };

  const renderDeclarationShape: RenderShape = (shapeId, options = {}) => {
    const shape = getShapeSymbol(catalog, shapeId);
    if (isInlineShapeNode(shape.node)) {
      return renderInlineShapeNode(shape.node);
    }

    const signature = shapeSignature(shapeId);
    if (shouldAliasSignature(signature)) {
      usedAliasSignatures.add(signature);
      return canonicalTypeForSignature(signature, options.aliasHint);
    }

    const stack = options.stack ?? [];
    if (stack.includes(shapeId)) {
      usedAliasSignatures.add(signature);
      return canonicalTypeForSignature(signature, options.aliasHint);
    }

    return renderDeclarationShapeBody(shapeId, [...stack, shapeId], options.aliasHint);
  };

  const renderSelfContainedShape: RenderShape = (shapeId, options = {}) => {
    const shape = getShapeSymbol(catalog, shapeId);
    if (isInlineShapeNode(shape.node)) {
      return renderInlineShapeNode(shape.node);
    }

    const stack = options.stack ?? [];
    if (stack.includes(shapeId)) {
      return "unknown";
    }

    switch (shape.node.type) {
      case "anyOf":
      case "oneOf": {
        const normalized = normalizedUnionRender(shape.node.items, [...stack, shapeId], options.aliasHint, renderSelfContainedShape);
        return normalized ?? renderShapeBody(catalog, shapeId, [...stack, shapeId], options.aliasHint, renderSelfContainedShape);
      }
      case "graphqlUnion": {
        const normalized = normalizedUnionRender(shape.node.memberTypeIds, [...stack, shapeId], options.aliasHint, renderSelfContainedShape);
        return normalized ?? renderShapeBody(catalog, shapeId, [...stack, shapeId], options.aliasHint, renderSelfContainedShape);
      }
    }

    return renderShapeBody(catalog, shapeId, [...stack, shapeId], options.aliasHint, renderSelfContainedShape);
  };

  const supportingDeclarations = (): readonly string[] => {
    const pending = [...usedAliasSignatures];
    const emitted = new Set<string>();

    while (pending.length > 0) {
      const signature = pending.pop()!;
      if (emitted.has(signature)) {
        continue;
      }

      emitted.add(signature);
      const representativeShapeId = representativeShapeIdForSignature(signature);
      renderDeclarationShapeBody(representativeShapeId, [representativeShapeId], aliasNameForSignature(signature));

      for (const discoveredSignature of usedAliasSignatures) {
        if (!emitted.has(discoveredSignature)) {
          pending.push(discoveredSignature);
        }
      }
    }

    return [...emitted]
      .sort((left, right) => aliasNameForSignature(left).localeCompare(aliasNameForSignature(right)))
      .map((signature) => {
        const canonicalType = canonicalTypeForSignature(signature);
        const representativeShapeId = representativeShapeIdForSignature(signature);
        const aliasName = aliasNameForSignature(signature);
        if (canonicalType !== aliasName) {
          return `type ${aliasName} = ${canonicalType};`;
        }
        const body = renderDeclarationShapeBody(representativeShapeId, [representativeShapeId], aliasName);
        return body === aliasName ? "" : `type ${aliasName} = ${body};`;
      })
      .filter((declaration) => declaration.length > 0);
  };

  return {
    renderSelfContainedShape,
    renderDeclarationShape,
    supportingDeclarations,
  };
};

export const projectedCatalogTypeRoots = (
  projected: Pick<ProjectedCatalog, "toolDescriptors">,
): readonly CatalogTypeRoot[] =>
  Object.values(projected.toolDescriptors)
    .sort((left, right) => left.toolPath.join(".").localeCompare(right.toolPath.join(".")))
    .flatMap((descriptor) => [
      {
        shapeId: descriptor.callShapeId,
        aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
      },
      ...(descriptor.resultShapeId
        ? [{
            shapeId: descriptor.resultShapeId,
            aliasHint: joinTypeNameSegments(...descriptor.toolPath, "result"),
          }]
        : []),
    ]);

export const shapeAllowsOmittedArgs = (catalog: CatalogV1, shapeId: ShapeSymbolId): boolean => {
  const shape = getShapeSymbol(catalog, shapeId);

  switch (shape.node.type) {
    case "ref":
      return shapeAllowsOmittedArgs(catalog, shape.node.target);
    case "object":
      return (shape.node.required ?? []).length === 0;
    default:
      return false;
  }
};

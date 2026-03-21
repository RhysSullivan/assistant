import { createHash } from "node:crypto";

import type { ProjectedCatalog } from "@executor/ir/catalog";
import type { ShapeSymbolId } from "@executor/ir/ids";
import type {
  CatalogV1,
  DocumentationBlock,
  ProvenanceRef,
  ShapeNode,
  ShapeSymbol,
} from "@executor/ir/model";

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
    ...lines.flatMap((line) =>
      line.split("\n").map((segment) => `${indent}${segment}`)
    ),
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

const nominalTypeName = (shape: ShapeSymbol): string | undefined => {
  const title = shape.title?.trim();
  return title && !isSyntheticShapeLabel(title)
    ? formatTypeNameSegment(title)
    : undefined;
};

const decodePointerSegment = (value: string): string =>
  value.replace(/~1/g, "/").replace(/~0/g, "~");

const meaningfulProvenanceName = (value: string): string | undefined => {
  const stripped = value.trim();
  if (
    stripped.length === 0
    || /^\d+$/.test(stripped)
    || [
      "$defs",
      "definitions",
      "components",
      "schemas",
      "schema",
      "properties",
      "items",
      "additionalProperties",
      "patternProperties",
      "allOf",
      "anyOf",
      "oneOf",
      "not",
      "if",
      "then",
      "else",
      "input",
      "output",
      "graphql",
      "scalars",
      "responses",
      "headers",
      "parameters",
      "requestBody",
    ].includes(stripped)
  ) {
    return undefined;
  }

  return formatTypeNameSegment(stripped);
};

const typeNameFromProvenance = (provenance: readonly ProvenanceRef[]): string | undefined => {
  for (const entry of provenance) {
    const pointer = entry.pointer;
    if (!pointer?.startsWith("#/")) {
      continue;
    }

    const segments = pointer
      .slice(2)
      .split("/")
      .map(decodePointerSegment);
    const markerIndexes = segments.flatMap((segment, index) =>
      ["$defs", "definitions", "schemas", "input", "output"].includes(segment)
        ? [index]
        : []
    );

    for (const markerIndex of markerIndexes) {
      const candidate = meaningfulProvenanceName(segments[markerIndex + 1] ?? "");
      if (candidate) {
        return candidate;
      }
    }

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const candidate = meaningfulProvenanceName(segments[index] ?? "");
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
};

const cleanDocText = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const escapeJsDocText = (value: string): string => value.replace(/\*\//g, "*\\/");

const pushParagraphLines = (
  lines: Array<string>,
  value: string | null,
): void => {
  if (!value) {
    return;
  }

  if (lines.length > 0) {
    lines.push("");
  }

  for (const line of value.split(/\r?\n/)) {
    lines.push(escapeJsDocText(line.trimEnd()));
  }
};

export const documentationComment = (input: {
  title?: string;
  docs?: DocumentationBlock;
  deprecated?: boolean;
  includeTitle?: boolean;
}): string | null => {
  const lines: Array<string> = [];
  const title = input.includeTitle && input.title && looksLikeHumanPhrase(input.title)
    ? cleanDocText(input.title)
    : null;
  const summary = cleanDocText(input.docs?.summary);
  const description = cleanDocText(input.docs?.description);
  const externalDocsUrl = cleanDocText(input.docs?.externalDocsUrl);

  pushParagraphLines(lines, title && title !== summary ? title : null);
  pushParagraphLines(lines, summary);
  pushParagraphLines(lines, description && description !== summary ? description : null);

  if (externalDocsUrl) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`@see ${escapeJsDocText(externalDocsUrl)}`);
  }

  if (input.deprecated) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("@deprecated");
  }

  if (lines.length === 0) {
    return null;
  }

  return [
    "/**",
    ...lines.map((line) => line.length > 0 ? ` * ${line}` : " *"),
    " */",
  ].join("\n");
};

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
  includeDocs: boolean,
): string => {
  const required = new Set(node.required);
  const lines = Object.keys(node.fields)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const field = node.fields[key]!;
      const propertyLine =
        `${formatPropertyKey(key)}${required.has(key) ? "" : "?"}: ${renderShape(field.shapeId, {
          stack,
          aliasHint: aliasHint ? joinTypeNameSegments(aliasHint, key) : key,
        })};`;
      const comment = includeDocs
        ? documentationComment({
            docs: field.docs,
            deprecated: field.deprecated,
          })
        : null;

      return comment ? `${comment}\n${propertyLine}` : propertyLine;
    });

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
  includeDocs: boolean,
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
    includeDocs,
  );

const renderShapeBody = (
  catalog: CatalogV1,
  shapeId: ShapeSymbolId,
  stack: readonly ShapeSymbolId[],
  aliasHint: string | undefined,
  renderShape: RenderShape,
  includeDocs: boolean,
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
      return renderObjectFields(node, stack, aliasHint, renderShape, includeDocs);
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
  const rootShapeIds = new Set(roots.map((root) => root.shapeId));
  const reachableShapeIds = new Set<ShapeSymbolId>();
  const recursiveShapeIds = new Set<ShapeSymbolId>();
  const explicitRefTargetShapeIds = new Set<ShapeSymbolId>();
  const aliasNameByShapeId = new Map<ShapeSymbolId, string>();
  const rootAliasHintByShapeId = new Map<ShapeSymbolId, string>();
  const declarationBodyByShapeId = new Map<ShapeSymbolId, string>();
  const nominalTypeNameByShapeId = new Map<ShapeSymbolId, string>();
  const nominalTypeNameCounts = new Map<string, number>();
  const usedAliasNames = new Set<string>();
  const usedAliasShapeIds = new Set<ShapeSymbolId>();

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

    signatureCache.set(shapeId, signature);
    return signature;
  };

  const shapeSignature = (shapeId: ShapeSymbolId, stack: readonly ShapeSymbolId[] = []): string =>
    shapeSignatureInfo(shapeId, stack).key;

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

  for (const shapeId of reachableShapeIds) {
    const shape = getShapeSymbol(catalog, shapeId);
    if (shape.synthetic) {
      continue;
    }

    const name = nominalTypeName(shape);
    if (!name) {
      continue;
    }

    nominalTypeNameByShapeId.set(shapeId, name);
    nominalTypeNameCounts.set(name, (nominalTypeNameCounts.get(name) ?? 0) + 1);
  }

  const uniqueNominalTypeNameForShapeId = (
    shapeId: ShapeSymbolId,
  ): string | undefined => {
    const name = nominalTypeNameByShapeId.get(shapeId);
    return name && nominalTypeNameCounts.get(name) === 1
      ? name
      : undefined;
  };

  const visitingShapeIds: Array<ShapeSymbolId> = [];
  const processedShapeIds = new Set<ShapeSymbolId>();

  const markRecursiveShapes = (cycleStartShapeId: ShapeSymbolId): void => {
    const cycleStartIndex = visitingShapeIds.indexOf(cycleStartShapeId);
    if (cycleStartIndex === -1) {
      recursiveShapeIds.add(cycleStartShapeId);
      return;
    }

    for (const recursiveShapeId of visitingShapeIds.slice(cycleStartIndex)) {
      recursiveShapeIds.add(recursiveShapeId);
    }
    recursiveShapeIds.add(cycleStartShapeId);
  };

  const detectRecursiveShapes = (shapeId: ShapeSymbolId): void => {
    if (processedShapeIds.has(shapeId)) {
      return;
    }

    if (visitingShapeIds.includes(shapeId)) {
      markRecursiveShapes(shapeId);
      return;
    }

    visitingShapeIds.push(shapeId);
    for (const childShapeId of childShapeIds(getShapeSymbol(catalog, shapeId).node)) {
      if (visitingShapeIds.includes(childShapeId)) {
        markRecursiveShapes(childShapeId);
        continue;
      }

      detectRecursiveShapes(childShapeId);
    }
    visitingShapeIds.pop();
    processedShapeIds.add(shapeId);
  };

  for (const root of roots) {
    detectRecursiveShapes(root.shapeId);
    const existing = rootAliasHintByShapeId.get(root.shapeId);
    if (!existing || root.aliasHint.length < existing.length) {
      rootAliasHintByShapeId.set(root.shapeId, root.aliasHint);
    }
  }

  for (const shapeId of reachableShapeIds) {
    const shape = getShapeSymbol(catalog, shapeId);
    if (shape.node.type === "ref") {
      explicitRefTargetShapeIds.add(shape.node.target);
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

    const firstPatternProperties = first.node.patternProperties ?? {};
    const firstKeys = Object.keys(firstPatternProperties).sort();
    return rest.every((variant) => {
      const variantPatternProperties = variant.node.patternProperties ?? {};
      const keys = Object.keys(variantPatternProperties).sort();
      if (keys.length !== firstKeys.length || keys.some((key, index) => key !== firstKeys[index])) {
        return false;
      }

      return keys.every((key) =>
        shapeSignature(firstPatternProperties[key]) === shapeSignature(variantPatternProperties[key])
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
    includeDocs: boolean,
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
      ? renderObjectNode(sharedNode, stack, aliasHint, renderShape, includeDocs)
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
        includeDocs,
      );
    });
    const unionText = variantTexts.map((variantText) => wrapCompositeType(variantText)).join(" | ");

    return baseText ? `${wrapCompositeType(baseText)} & (${unionText})` : unionText;
  };

  const aliasNameForShapeId = (shapeId: ShapeSymbolId, hint?: string): string => {
    const existing = aliasNameByShapeId.get(shapeId);
    if (existing) {
      return existing;
    }

    const shape = getShapeSymbol(catalog, shapeId);
    const rootHint = rootAliasHintByShapeId.get(shapeId);
    const contextualHint = hint ? compactAliasHint(hint) : undefined;
    const uniqueNominalName = uniqueNominalTypeNameForShapeId(shapeId);
    const nameCandidates = [
      rootHint,
      uniqueNominalName,
      typeNameFromProvenance(shape.provenance),
      nominalTypeNameByShapeId.get(shapeId),
      contextualHint,
      formatTypeNameSegment(shape.id),
    ].filter((candidate): candidate is string => candidate !== undefined);
    const [baseName = formatTypeNameSegment(shape.id)] = nameCandidates;
    let candidate =
      nameCandidates.find((name) => !usedAliasNames.has(name))
      ?? baseName;
    let suffix = 2;
    while (usedAliasNames.has(candidate)) {
      candidate = `${baseName}_${String(suffix)}`;
      suffix += 1;
    }

    aliasNameByShapeId.set(shapeId, candidate);
    usedAliasNames.add(candidate);
    return candidate;
  };

  const shouldEmitDeclarationShape = (shapeId: ShapeSymbolId): boolean => {
    const shape = getShapeSymbol(catalog, shapeId);
    if (isInlineShapeNode(shape.node)) {
      return false;
    }

    if (rootShapeIds.has(shapeId)) {
      return true;
    }

    if (shape.node.type === "ref") {
      return false;
    }

    return uniqueNominalTypeNameForShapeId(shapeId) !== undefined
      || explicitRefTargetShapeIds.has(shapeId);
  };

  const renderDeclarationShapeBody = (
    shapeId: ShapeSymbolId,
    stack: readonly ShapeSymbolId[],
    aliasHint?: string,
  ): string => {
    const shape = getShapeSymbol(catalog, shapeId);
    switch (shape.node.type) {
      case "anyOf":
      case "oneOf": {
        const normalized = normalizedUnionRender(
          shape.node.items,
          stack,
          aliasHint,
          renderDeclarationShape,
          true,
        );
        return normalized ?? renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape, true);
      }
      case "graphqlUnion": {
        const normalized = normalizedUnionRender(shape.node.memberTypeIds, stack, aliasHint, renderDeclarationShape, true);
        return normalized ?? renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape, true);
      }
      default:
        return renderShapeBody(catalog, shapeId, stack, aliasHint, renderDeclarationShape, true);
    }
  };

  const renderDeclarationBodyForShapeId = (shapeId: ShapeSymbolId): string => {
    const existing = declarationBodyByShapeId.get(shapeId);
    if (existing) {
      return existing;
    }

    const body = renderDeclarationShapeBody(shapeId, [shapeId], aliasNameForShapeId(shapeId));
    declarationBodyByShapeId.set(shapeId, body);
    return body;
  };

  const renderDeclarationShape: RenderShape = (shapeId, options = {}) => {
    const shape = getShapeSymbol(catalog, shapeId);
    if (isInlineShapeNode(shape.node)) {
      return renderInlineShapeNode(shape.node);
    }

    const stack = options.stack ?? [];
    if (shape.node.type === "ref" && !rootShapeIds.has(shapeId)) {
      if (stack.includes(shapeId)) {
        return renderDeclarationShape(shape.node.target, {
          stack,
          aliasHint: options.aliasHint,
        });
      }

      return renderDeclarationShapeBody(shapeId, [...stack, shapeId], options.aliasHint);
    }

    if (stack.includes(shapeId) || shouldEmitDeclarationShape(shapeId)) {
      usedAliasShapeIds.add(shapeId);
      return aliasNameForShapeId(shapeId, options.aliasHint);
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
        const normalized = normalizedUnionRender(
          shape.node.items,
          [...stack, shapeId],
          options.aliasHint,
          renderSelfContainedShape,
          false,
        );
        return normalized ?? renderShapeBody(
          catalog,
          shapeId,
          [...stack, shapeId],
          options.aliasHint,
          renderSelfContainedShape,
          false,
        );
      }
      case "graphqlUnion": {
        const normalized = normalizedUnionRender(
          shape.node.memberTypeIds,
          [...stack, shapeId],
          options.aliasHint,
          renderSelfContainedShape,
          false,
        );
        return normalized ?? renderShapeBody(
          catalog,
          shapeId,
          [...stack, shapeId],
          options.aliasHint,
          renderSelfContainedShape,
          false,
        );
      }
    }

    return renderShapeBody(
      catalog,
      shapeId,
      [...stack, shapeId],
      options.aliasHint,
      renderSelfContainedShape,
      false,
    );
  };

  const supportingDeclarations = (): readonly string[] => {
    const pending = [...usedAliasShapeIds];
    const emitted = new Set<ShapeSymbolId>();
    let pendingIndex = 0;

    while (pendingIndex < pending.length) {
      const shapeId = pending[pendingIndex++]!;
      if (emitted.has(shapeId)) {
        continue;
      }

      emitted.add(shapeId);
      renderDeclarationBodyForShapeId(shapeId);

      for (const discoveredShapeId of usedAliasShapeIds) {
        if (!emitted.has(discoveredShapeId)) {
          pending.push(discoveredShapeId);
        }
      }
    }

    const declarations = [...emitted]
      .sort((left, right) => aliasNameForShapeId(left).localeCompare(aliasNameForShapeId(right)))
      .map((shapeId) => {
        const aliasName = aliasNameForShapeId(shapeId);
        const shape = getShapeSymbol(catalog, shapeId);
        const comment = documentationComment({
          title: shape.title,
          docs: shape.docs,
          deprecated: shape.deprecated,
          includeTitle: true,
        });
        const body = renderDeclarationBodyForShapeId(shapeId);
        const declaration = `type ${aliasName} = ${body};`;
        return comment ? `${comment}\n${declaration}` : declaration;
      });

    return declarations;
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

import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import type { Source } from "#schema";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { projectCatalogForAgentSdk } from "../ir/catalog";
import type { ShapeSymbolId } from "../ir/ids";
import type { CatalogSnapshotV1, CatalogV1, ShapeNode, ShapeSymbol } from "../ir/model";
import type { ResolvedLocalWorkspaceContext } from "./local-config";
import {
  LocalFileSystemError,
  unknownLocalErrorDetails,
} from "./local-errors";

type SourceDeclarationEntry = {
  source: Source;
  snapshot: CatalogSnapshotV1;
};

type ToolMethodNode = {
  readonly segments: readonly string[];
  readonly inputType: string;
  readonly outputType: string;
  readonly argsOptional: boolean;
};

type SourceDeclarationModel = {
  readonly methods: readonly ToolMethodNode[];
  readonly supportingTypes: readonly string[];
};

type ToolTreeNode = {
  method: ToolMethodNode | null;
  children: Map<string, ToolTreeNode>;
};

type SourceDeclarationStub = {
  sourceId: string;
};

const GENERATED_TYPES_DIRECTORY = "types";
const GENERATED_SOURCE_TYPES_DIRECTORY = "sources";
const VALID_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const mapFileSystemError = (path: string, action: string) => (cause: unknown) =>
  new LocalFileSystemError({
    message: `Failed to ${action} ${path}: ${unknownLocalErrorDetails(cause)}`,
    action,
    path,
    details: unknownLocalErrorDetails(cause),
  });

const declarationDirectory = (context: ResolvedLocalWorkspaceContext): string =>
  join(context.configDirectory, GENERATED_TYPES_DIRECTORY);

const sourceDeclarationDirectory = (context: ResolvedLocalWorkspaceContext): string =>
  join(declarationDirectory(context), GENERATED_SOURCE_TYPES_DIRECTORY);

const sourceDeclarationFileName = (sourceId: string): string => `${sourceId}.d.ts`;

const sourceDeclarationPath = (context: ResolvedLocalWorkspaceContext, sourceId: string): string =>
  join(sourceDeclarationDirectory(context), sourceDeclarationFileName(sourceId));

const aggregateDeclarationPath = (context: ResolvedLocalWorkspaceContext): string =>
  join(declarationDirectory(context), "index.d.ts");

const formatPropertyKey = (value: string): string =>
  VALID_IDENTIFIER_PATTERN.test(value) ? value : JSON.stringify(value);

const formatTypeNameSegment = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (sanitized.length === 0) {
    return "Type";
  }

  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `T_${sanitized}`;
};

const sourceTypeInterfaceName = (sourceId: string): string =>
  `SourceTools_${sourceId.replace(/[^A-Za-z0-9_$]+/g, "_")}`;

const methodSignature = (method: ToolMethodNode): string =>
  `(${method.argsOptional ? "args?:" : "args:"} ${method.inputType}) => Promise<${method.outputType}>`;

const createToolTreeNode = (): ToolTreeNode => ({
  method: null,
  children: new Map(),
});

const primitiveTypeName = (value: string): string => {
  switch (value) {
    case "string":
    case "boolean":
      return value;
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

const renderToolTreeType = (node: ToolTreeNode, indentLevel: number): string => {
  const indent = "  ".repeat(indentLevel + 1);
  const childLines = [...node.children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([segment, child]) =>
      `${formatPropertyKey(segment)}: ${renderToolTreeType(child, indentLevel + 1)};`
    );

  const objectType = objectTypeLiteral(childLines, indent);
  if (node.method === null) {
    return objectType;
  }

  const callable = methodSignature(node.method);
  return node.children.size === 0
    ? callable
    : `(${callable}) & ${objectType}`;
};

const buildToolTree = (methods: readonly ToolMethodNode[]): ToolTreeNode => {
  const root = createToolTreeNode();

  for (const method of methods) {
    let current = root;
    for (const segment of method.segments) {
      const existing = current.children.get(segment);
      if (existing) {
        current = existing;
        continue;
      }

      const next = createToolTreeNode();
      current.children.set(segment, next);
      current = next;
    }

    current.method = method;
  }

  return root;
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

const createCatalogTypeRenderer = (input: {
  catalog: CatalogV1;
  rootShapeIds: readonly ShapeSymbolId[];
}) => {
  const { catalog, rootShapeIds } = input;
  const signatureCache = new Map<ShapeSymbolId, string>();
  const recursiveSignatures = new Set<string>();
  const shapeIdsBySignature = new Map<string, ShapeSymbolId[]>();
  const usageCountBySignature = new Map<string, number>();
  const aliasNameBySignature = new Map<string, string>();
  const usedAliasNames = new Set<string>();
  const usedAliasSignatures = new Set<string>();

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

  const shapeSignature = (shapeId: ShapeSymbolId, stack: readonly ShapeSymbolId[] = []): string => {
    const cached = signatureCache.get(shapeId);
    if (cached) {
      return cached;
    }

    if (stack.includes(shapeId)) {
      return `cycle:${shapeId}`;
    }

    const shape = getShapeSymbol(catalog, shapeId);
    const nextStack = [...stack, shapeId];
    const childSignatures = (shapeIds: readonly ShapeSymbolId[], sort: boolean): string[] => {
      const values = shapeIds.map((childShapeId) => shapeSignature(childShapeId, nextStack));
      return sort ? values.sort((left, right) => left.localeCompare(right)) : values;
    };

    const signature = (() => {
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
            .map(([key, field]) => `${key}${required.includes(key) ? "!" : "?"}:${shapeSignature(field.shapeId, nextStack)}`)
            .join(",");
          const additionalProperties =
            shape.node.additionalProperties === true
              ? "unknown"
              : typeof shape.node.additionalProperties === "string"
                ? shapeSignature(shape.node.additionalProperties, nextStack)
                : "none";
          const patternProperties = Object.entries(shape.node.patternProperties ?? {})
            .map(([, valueShapeId]) => shapeSignature(valueShapeId, nextStack))
            .sort((left, right) => left.localeCompare(right))
            .join("|");
          return `object:${fields}:index=${additionalProperties}:patterns=${patternProperties}`;
        }
        case "array":
          return `array:${shapeSignature(shape.node.itemShapeId, nextStack)}`;
        case "tuple":
          return `tuple:${childSignatures(shape.node.itemShapeIds, false).join(",")}:rest=${
            shape.node.additionalItems === true
              ? "unknown"
              : typeof shape.node.additionalItems === "string"
                ? shapeSignature(shape.node.additionalItems, nextStack)
                : "none"
          }`;
        case "map":
          return `map:${shapeSignature(shape.node.valueShapeId, nextStack)}`;
        case "allOf":
          return `allOf:${childSignatures(shape.node.items, true).join("&")}`;
        case "anyOf":
          return `anyOf:${childSignatures(shape.node.items, true).join("|")}`;
        case "oneOf":
          return `oneOf:${childSignatures(shape.node.items, true).join("|")}`;
        case "nullable":
          return `nullable:${shapeSignature(shape.node.itemShapeId, nextStack)}`;
        case "ref":
          return `ref:${shapeSignature(shape.node.target, nextStack)}`;
        case "not":
          return `not:${shapeSignature(shape.node.itemShapeId, nextStack)}`;
        case "conditional":
          return `conditional:${shapeSignature(shape.node.ifShapeId, nextStack)}:${
            shape.node.thenShapeId ? shapeSignature(shape.node.thenShapeId, nextStack) : "none"
          }:${shape.node.elseShapeId ? shapeSignature(shape.node.elseShapeId, nextStack) : "none"}`;
        case "graphqlInterface": {
          const fields = Object.entries(shape.node.fields)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, field]) => `${key}:${shapeSignature(field.shapeId, nextStack)}`)
            .join(",");
          const possibleTypes = childSignatures(shape.node.possibleTypeIds, true).join("|");
          return `graphqlInterface:${fields}:possible=${possibleTypes}`;
        }
        case "graphqlUnion":
          return `graphqlUnion:${childSignatures(shape.node.memberTypeIds, true).join("|")}`;
      }
    })();

    if (signature.includes("cycle:")) {
      recursiveSignatures.add(signature);
    }

    signatureCache.set(shapeId, signature);
    const group = shapeIdsBySignature.get(signature);
    if (group) {
      group.push(shapeId);
    } else {
      shapeIdsBySignature.set(signature, [shapeId]);
    }
    return signature;
  };

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

  for (const rootShapeId of rootShapeIds) {
    collectReachableShapes(rootShapeId);
  }

  for (const rootShapeId of rootShapeIds) {
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
      const leftSynthetic = isSyntheticShapeLabel(leftTitle) ? 1 : 0;
      const rightSynthetic = isSyntheticShapeLabel(rightTitle) ? 1 : 0;
      return leftSynthetic - rightSynthetic || leftTitle.localeCompare(rightTitle);
    });

    return sorted[0]!;
  };

  const aliasNameForSignature = (signature: string): string => {
    const existing = aliasNameBySignature.get(signature);
    if (existing) {
      return existing;
    }

    const representative = getShapeSymbol(catalog, representativeShapeIdForSignature(signature));
    const baseName = formatTypeNameSegment(representative.title ?? representative.id);
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

  const renderShape = (shapeId: ShapeSymbolId, options: {
    position: "root" | "nested";
    stack?: readonly ShapeSymbolId[];
  }): string => {
    const shape = getShapeSymbol(catalog, shapeId);
    if (isInlineShapeNode(shape.node)) {
      return renderInlineShapeNode(shape.node);
    }

    const signature = shapeSignature(shapeId);
    if (shouldAliasSignature(signature)) {
      usedAliasSignatures.add(signature);
      return aliasNameForSignature(signature);
    }

    const stack = options.stack ?? [];
    if (stack.includes(shapeId)) {
      usedAliasSignatures.add(signature);
      return aliasNameForSignature(signature);
    }

    return renderShapeBody(shapeId, [...stack, shapeId]);
  };

  const renderIndexValueType = (shapeIds: readonly ShapeSymbolId[], allowUnknown: boolean): string => {
    const members = new Set<string>();
    if (allowUnknown) {
      members.add("unknown");
    }

    for (const shapeId of shapeIds) {
      members.add(renderShape(shapeId, { position: "nested" }));
    }

    return [...members].sort((left, right) => left.localeCompare(right)).join(" | ");
  };

  const renderObjectFields = (
    node: Extract<ShapeNode, { type: "object" }> | Extract<ShapeNode, { type: "graphqlInterface" }>,
    stack: readonly ShapeSymbolId[],
  ): string => {
    const required = new Set(node.type === "object" ? (node.required ?? []) : []);
    const lines = Object.keys(node.fields)
      .sort((left, right) => left.localeCompare(right))
      .map((key) =>
        `${formatPropertyKey(key)}${required.has(key) ? "" : "?"}: ${renderShape(node.fields[key]!.shapeId, { position: "nested", stack })};`
      );

    if (node.type === "object") {
      const patternShapeIds = Object.values(node.patternProperties ?? {});
      const hasUnknownIndex = node.additionalProperties === true;
      const additionalShapeIds = typeof node.additionalProperties === "string"
        ? [node.additionalProperties]
        : [];
      if (hasUnknownIndex || patternShapeIds.length > 0 || additionalShapeIds.length > 0) {
        lines.push(
          `[key: string]: ${renderIndexValueType([...patternShapeIds, ...additionalShapeIds], hasUnknownIndex)};`,
        );
      }
    }

    return objectTypeLiteral(lines, "  ");
  };

  const renderShapeBody = (shapeId: ShapeSymbolId, stack: readonly ShapeSymbolId[]): string => {
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
        return renderObjectFields(node, stack);
      case "array":
        return `Array<${wrapCompositeType(renderShape(node.itemShapeId, { position: "nested", stack }))}>`;
      case "tuple": {
        const items = node.itemShapeIds.map((itemShapeId) => renderShape(itemShapeId, { position: "nested", stack }));
        const suffix = node.additionalItems === true
          ? ", ...unknown[]"
          : typeof node.additionalItems === "string"
            ? `, ...Array<${wrapCompositeType(renderShape(node.additionalItems, { position: "nested", stack }))}>`
            : "";
        return `[${items.join(", ")}${suffix}]`;
      }
      case "map":
        return `Record<string, ${renderShape(node.valueShapeId, { position: "nested", stack })}>`;
      case "allOf":
        return node.items.map((itemShapeId) => wrapCompositeType(renderShape(itemShapeId, { position: "nested", stack }))).join(" & ");
      case "anyOf":
      case "oneOf":
        return node.items.map((itemShapeId) => wrapCompositeType(renderShape(itemShapeId, { position: "nested", stack }))).join(" | ");
      case "nullable":
        return `${wrapCompositeType(renderShape(node.itemShapeId, { position: "nested", stack }))} | null`;
      case "ref":
        return renderShape(node.target, { position: "nested", stack });
      case "not":
        throw new Error(`Unsupported declaration shape node: ${node.type}`);
      case "conditional":
        throw new Error(`Unsupported declaration shape node: ${node.type}`);
      case "graphqlUnion":
        return node.memberTypeIds
          .map((memberTypeId) => wrapCompositeType(renderShape(memberTypeId, { position: "nested", stack })))
          .join(" | ");
    }
  };

  const supportingTypes = (): string[] => {
    const pending = [...usedAliasSignatures];
    const emitted = new Set<string>();

    while (pending.length > 0) {
      const signature = pending.pop()!;
      if (emitted.has(signature)) {
        continue;
      }

      emitted.add(signature);
      const representativeShapeId = representativeShapeIdForSignature(signature);
      renderShapeBody(representativeShapeId, [representativeShapeId]);

      for (const discoveredSignature of usedAliasSignatures) {
        if (!emitted.has(discoveredSignature)) {
          pending.push(discoveredSignature);
        }
      }
    }

    const declarations = [...emitted]
      .sort((left, right) => aliasNameForSignature(left).localeCompare(aliasNameForSignature(right)))
      .map((signature) => {
        const representativeShapeId = representativeShapeIdForSignature(signature);
        return `type ${aliasNameForSignature(signature)} = ${renderShapeBody(representativeShapeId, [representativeShapeId])};`;
      });

    return declarations;
  };

  return {
    renderShape,
    supportingTypes,
  };
};

const shapeAllowsOmittedArgs = (catalog: CatalogV1, shapeId: ShapeSymbolId): boolean => {
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

const buildSourceDeclarationModel = (snapshot: CatalogSnapshotV1): SourceDeclarationModel => {
  const projected = projectCatalogForAgentSdk({
    catalog: snapshot.catalog,
  });
  const toolDescriptors = Object.values(projected.toolDescriptors)
    .sort((left, right) => left.toolPath.join(".").localeCompare(right.toolPath.join(".")));
  const renderer = createCatalogTypeRenderer({
    catalog: projected.catalog,
    rootShapeIds: toolDescriptors.flatMap((descriptor) => [
      descriptor.callShapeId,
      ...(descriptor.resultShapeId ? [descriptor.resultShapeId] : []),
    ]),
  });

  const methods = toolDescriptors
    .map((descriptor) => ({
      segments: descriptor.toolPath,
      inputType: renderer.renderShape(descriptor.callShapeId, { position: "root" }),
      outputType: descriptor.resultShapeId
        ? renderer.renderShape(descriptor.resultShapeId, { position: "root" })
        : "unknown",
      argsOptional: shapeAllowsOmittedArgs(projected.catalog, descriptor.callShapeId),
    }) satisfies ToolMethodNode);

  return {
    methods,
    supportingTypes: renderer.supportingTypes(),
  };
};

const sourceDeclarationText = (entry: SourceDeclarationEntry): string => {
  const interfaceName = sourceTypeInterfaceName(entry.source.id);
  const declarationModel = buildSourceDeclarationModel(entry.snapshot);
  const tree = buildToolTree(declarationModel.methods);
  const body = renderToolTreeType(tree, 0);

  return [
    "// Generated by executor. Do not edit by hand.",
    `// Source: ${entry.source.name} (${entry.source.id})`,
    "",
    ...declarationModel.supportingTypes,
    ...(declarationModel.supportingTypes.length > 0 ? [""] : []),
    `export interface ${interfaceName} ${body}`,
    "",
    `export declare const tools: ${interfaceName};`,
    `export type ${interfaceName}Tools = ${interfaceName};`,
    "export default tools;",
    "",
  ].join("\n");
};

const aggregateDeclarationText = (entries: readonly SourceDeclarationEntry[]): string => {
  return aggregateDeclarationTextFromSourceIds(
    entries.map((entry) => ({ sourceId: entry.source.id })),
  );
};

const aggregateDeclarationTextFromSourceIds = (entries: readonly SourceDeclarationStub[]): string => {
  const sorted = [...entries].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const imports = sorted.map((entry) =>
    `import type { ${sourceTypeInterfaceName(entry.sourceId)} } from "./sources/${entry.sourceId}";`
  );
  const intersections = sorted.map((entry) => sourceTypeInterfaceName(entry.sourceId));
  const executorToolsType = intersections.length > 0
    ? intersections.join(" & ")
    : "{}";

  return [
    "// Generated by executor. Do not edit by hand.",
    ...imports,
    ...(imports.length > 0 ? [""] : []),
    `export type ExecutorSourceTools = ${executorToolsType};`,
    "",
    "declare global {",
    "  const tools: ExecutorSourceTools;",
    "}",
    "",
    "export declare const tools: ExecutorSourceTools;",
    "export default tools;",
    "",
  ].join("\n");
};

export const syncWorkspaceSourceTypeDeclarations = (input: {
  context: ResolvedLocalWorkspaceContext;
  entries: readonly SourceDeclarationEntry[];
}): Effect.Effect<void, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const declarationsDir = declarationDirectory(input.context);
    const perSourceDir = sourceDeclarationDirectory(input.context);
    const activeEntries = input.entries
      .filter((entry) => entry.source.enabled && entry.source.status === "connected")
      .sort((left, right) => left.source.id.localeCompare(right.source.id));

    yield* fs.makeDirectory(declarationsDir, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(declarationsDir, "create declaration directory")),
    );
    yield* fs.makeDirectory(perSourceDir, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(perSourceDir, "create source declaration directory")),
    );

    const expectedFiles = new Set(
      activeEntries.map((entry) => sourceDeclarationFileName(entry.source.id)),
    );
    const existingFiles = yield* fs.readDirectory(perSourceDir).pipe(
      Effect.mapError(mapFileSystemError(perSourceDir, "read source declaration directory")),
    );

    for (const existingFile of existingFiles) {
      if (expectedFiles.has(existingFile)) {
        continue;
      }

      const stalePath = join(perSourceDir, existingFile);
      yield* fs.remove(stalePath).pipe(
        Effect.mapError(mapFileSystemError(stalePath, "remove stale source declaration")),
      );
    }

    for (const entry of activeEntries) {
      const filePath = sourceDeclarationPath(input.context, entry.source.id);
      yield* fs.writeFileString(filePath, sourceDeclarationText(entry)).pipe(
      Effect.mapError(mapFileSystemError(filePath, "write source declaration")),
      );
    }

    const aggregatePath = aggregateDeclarationPath(input.context);
    yield* fs.writeFileString(
      aggregatePath,
      aggregateDeclarationText(activeEntries),
    ).pipe(
      Effect.mapError(mapFileSystemError(aggregatePath, "write aggregate declaration")),
    );
  });

export const syncSourceTypeDeclaration = (input: {
  context: ResolvedLocalWorkspaceContext;
  source: Source;
  snapshot: CatalogSnapshotV1 | null;
}): Effect.Effect<void, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const declarationsDir = declarationDirectory(input.context);
    const perSourceDir = sourceDeclarationDirectory(input.context);

    yield* fs.makeDirectory(declarationsDir, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(declarationsDir, "create declaration directory")),
    );
    yield* fs.makeDirectory(perSourceDir, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(perSourceDir, "create source declaration directory")),
    );

    const filePath = sourceDeclarationPath(input.context, input.source.id);
    const shouldWrite = input.source.enabled
      && input.source.status === "connected"
      && input.snapshot !== null;

    if (shouldWrite) {
      const snapshot = input.snapshot;
      if (snapshot === null) {
        return;
      }
      yield* fs.writeFileString(
        filePath,
        sourceDeclarationText({
          source: input.source,
          snapshot,
        }),
      ).pipe(
        Effect.mapError(mapFileSystemError(filePath, "write source declaration")),
      );
    } else {
      const exists = yield* fs.exists(filePath).pipe(
        Effect.mapError(mapFileSystemError(filePath, "check source declaration path")),
      );
      if (exists) {
        yield* fs.remove(filePath).pipe(
          Effect.mapError(mapFileSystemError(filePath, "remove source declaration")),
        );
      }
    }

    const sourceIds = (yield* fs.readDirectory(perSourceDir).pipe(
      Effect.mapError(mapFileSystemError(perSourceDir, "read source declaration directory")),
    ))
      .filter((fileName) => fileName.endsWith(".d.ts"))
      .map((fileName) => ({ sourceId: fileName.slice(0, -".d.ts".length) }));

    const aggregatePath = aggregateDeclarationPath(input.context);
    yield* fs.writeFileString(
      aggregatePath,
      aggregateDeclarationTextFromSourceIds(sourceIds),
    ).pipe(
      Effect.mapError(mapFileSystemError(aggregatePath, "write aggregate declaration")),
    );
  });

export const syncWorkspaceSourceTypeDeclarationsNode = (input: {
  context: ResolvedLocalWorkspaceContext;
  entries: readonly SourceDeclarationEntry[];
}): Effect.Effect<void, LocalFileSystemError, never> =>
  syncWorkspaceSourceTypeDeclarations(input).pipe(Effect.provide(NodeFileSystem.layer));

export const syncSourceTypeDeclarationNode = (input: {
  context: ResolvedLocalWorkspaceContext;
  source: Source;
  snapshot: CatalogSnapshotV1 | null;
}): Effect.Effect<void, LocalFileSystemError, never> =>
  syncSourceTypeDeclaration(input).pipe(Effect.provide(NodeFileSystem.layer));

const logBackgroundDeclarationError = (label: string, cause: unknown): void => {
  const message = Cause.isCause(cause)
    ? Cause.pretty(cause)
    : cause instanceof Error
      ? cause.message
      : String(cause);
  console.warn(`[source-types] ${label} failed: ${message}`);
};

const BACKGROUND_DECLARATION_REFRESH_DELAY = "1500 millis";
const workspaceRefreshFibers = new Map<string, Fiber.RuntimeFiber<void, never>>();
const sourceRefreshFibers = new Map<string, Fiber.RuntimeFiber<void, never>>();

export const refreshWorkspaceSourceTypeDeclarationsInBackground = (input: {
  context: ResolvedLocalWorkspaceContext;
  entries: readonly SourceDeclarationEntry[];
}): void => {
  const key = input.context.configDirectory;
  const existingFiber = workspaceRefreshFibers.get(key);
  if (existingFiber) {
    Effect.runFork(Fiber.interruptFork(existingFiber));
  }

  const fiber = Effect.runFork(
    Effect.sleep(BACKGROUND_DECLARATION_REFRESH_DELAY).pipe(
      Effect.zipRight(
        syncWorkspaceSourceTypeDeclarationsNode(input).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              logBackgroundDeclarationError("workspace declaration refresh", cause);
            })
          ),
        ),
      ),
    ),
  );

  workspaceRefreshFibers.set(key, fiber);
  fiber.addObserver(() => {
    workspaceRefreshFibers.delete(key);
  });
};

export const refreshSourceTypeDeclarationInBackground = (input: {
  context: ResolvedLocalWorkspaceContext;
  source: Source;
  snapshot: CatalogSnapshotV1 | null;
}): void => {
  const key = `${input.context.configDirectory}:${input.source.id}`;
  const existingFiber = sourceRefreshFibers.get(key);
  if (existingFiber) {
    Effect.runFork(Fiber.interruptFork(existingFiber));
  }

  const fiber = Effect.runFork(
    Effect.sleep(BACKGROUND_DECLARATION_REFRESH_DELAY).pipe(
      Effect.zipRight(
        syncSourceTypeDeclarationNode(input).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              logBackgroundDeclarationError(`source ${input.source.id} declaration refresh`, cause);
            })
          ),
        ),
      ),
    ),
  );

  sourceRefreshFibers.set(key, fiber);
  fiber.addObserver(() => {
    sourceRefreshFibers.delete(key);
  });
};

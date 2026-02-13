import type { ToolDescriptor } from "./types";
import {
  getSourceFileParseDiagnostics,
  getTypeScriptModule,
  indentBlock,
  propertyNameText,
} from "./typechecker-ts-utils";
import { OPENAPI_HELPER_TYPES } from "./openapi-helper-types";

function isValidTypeExpression(typeExpression: string): boolean {
  const ts = getTypeScriptModule();
  if (!ts) {
    return !/[\r\n`]/.test(typeExpression);
  }

  return (() => {
    try {
      const sourceFile = ts.createSourceFile(
        "_type_expr_check.ts",
        `type __T = ${typeExpression};`,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TS,
      );
      return getSourceFileParseDiagnostics(sourceFile).length === 0;
    } catch {
      return false;
    }
  })();
}

function safeTypeExpression(raw: string | undefined, fallback: string): string {
  const typeExpression = raw?.trim();
  if (!typeExpression) return fallback;
  return isValidTypeExpression(typeExpression) ? typeExpression : fallback;
}

/**
 * Build a minimal OpenAPI .d.ts containing only selected `operations` members.
 * Returns null when slicing is not possible and callers should use full .d.ts.
 */
export function sliceOpenApiOperationsDts(
  dts: string,
  operationIds: Iterable<string>,
): string | null {
  const ts = getTypeScriptModule();
  if (!ts) return null;

  const wanted = new Set([...operationIds].filter((value) => value.trim().length > 0));
  if (wanted.size === 0) return null;

  const sourceFile = ts.createSourceFile(
    "openapi-source.d.ts",
    dts,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const operationsInterface = sourceFile.statements.find((statement) =>
    ts.isInterfaceDeclaration(statement)
    && statement.name.text === "operations",
  );

  if (!operationsInterface || !ts.isInterfaceDeclaration(operationsInterface)) {
    return null;
  }

  const selectedMembers: string[] = [];
  for (const member of operationsInterface.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const key = propertyNameText(member.name, ts);
    if (!key || !wanted.has(key)) continue;

    const raw = dts.slice(member.getFullStart(), member.end).trim();
    if (raw.length > 0) {
      selectedMembers.push(raw);
    }
  }

  if (selectedMembers.length === 0) return null;

  const body = selectedMembers.map((member) => indentBlock(member)).join("\n");
  return `export interface operations {\n${body}\n}`;
}

function stripExportKeywordsForTypechecker(dts: string): string {
  return dts.replace(/\bexport\s+/g, "").trim();
}

export interface GenerateToolDeclarationOptions {
  sourceDtsBySource?: Record<string, string>;
}

interface ToolTreeNode {
  children: Map<string, ToolTreeNode>;
  tool?: ToolDescriptor;
}

function createToolTree(tools: ToolDescriptor[]): ToolTreeNode {
  const root: ToolTreeNode = { children: new Map() };

  for (const tool of tools) {
    const segments = tool.path.split(".");
    let node = root;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map() });
      }
      node = node.children.get(segment)!;
      if (i === segments.length - 1) {
        node.tool = tool;
      }
    }
  }

  return root;
}

function renderToolCallSignature(
  key: string,
  tool: ToolDescriptor,
  dtsSources: Set<string>,
  pad: string,
): string {
  if (tool.operationId && tool.source && dtsSources.has(tool.source)) {
    const opKey = JSON.stringify(tool.operationId);
    const openApiInputType = `ToolInput<operations[${opKey}]>`;
    const openApiOutputType = `ToolOutput<operations[${opKey}]>`;
    return `${pad}${key}(input: ${openApiInputType}): Promise<${openApiOutputType}>;`;
  }

  const strictArgsType = tool.strictArgsType?.trim();
  const strictReturnsType = tool.strictReturnsType?.trim();
  const effectiveArgs = strictArgsType || tool.argsType;
  const effectiveReturns = strictReturnsType || tool.returnsType;
  const hasArgsType = Boolean(effectiveArgs?.trim());
  const args = safeTypeExpression(effectiveArgs, "Record<string, unknown>");
  const returns = safeTypeExpression(effectiveReturns, "unknown");
  const inputParam = !hasArgsType || args === "{}"
    ? `input?: ${args}`
    : `input: ${args}`;

  return `${pad}${key}(${inputParam}): Promise<${returns}>;`;
}

function renderToolTree(
  node: ToolTreeNode,
  indent: number,
  dtsSources: Set<string>,
): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, child] of node.children) {
    if (child.tool) {
      lines.push(renderToolCallSignature(key, child.tool, dtsSources, pad));
      continue;
    }

    lines.push(`${pad}${key}: {`);
    lines.push(renderToolTree(child, indent + 1, dtsSources));
    lines.push(`${pad}};`);
  }

  return lines.join("\n");
}

/**
 * Build a `declare const tools: { ... }` block from flat tool descriptors.
 */
export function generateToolDeclarations(
  tools: ToolDescriptor[],
  options?: GenerateToolDeclarationOptions,
): string {
  const sourceDtsBySource = options?.sourceDtsBySource ?? {};
  const dtsSources = new Set(Object.keys(sourceDtsBySource));
  const root = createToolTree(tools);

  const parts: string[] = [];

  const dtsEntries = Object.entries(sourceDtsBySource)
    .filter(([, dts]) => typeof dts === "string" && dts.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (dtsEntries.length > 0) {
    parts.push(OPENAPI_HELPER_TYPES);
    for (const [sourceKey, dts] of dtsEntries) {
      parts.push(`// OpenAPI types from ${sourceKey}\n${stripExportKeywordsForTypechecker(dts)}`);
    }
  }

  parts.push(`declare const tools: {\n${renderToolTree(root, 1, dtsSources)}\n};`);
  return parts.join("\n");
}

/**
 * Generate the tool inventory text for the MCP run_code description.
 * Includes full type signatures so the LLM can write correct code.
 */
export function generateToolInventory(tools: ToolDescriptor[]): string {
  if (!tools || tools.length === 0) return "";

  const namespaceCounts = new Map<string, number>();
  for (const tool of tools) {
    const topLevel = tool.path.split(".")[0] || tool.path;
    namespaceCounts.set(topLevel, (namespaceCounts.get(topLevel) ?? 0) + 1);
  }

  const namespaces = [...namespaceCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} (${count})`);

  const examples = tools
    .filter((tool) => tool.path !== "discover")
    .slice(0, 8)
    .map((tool) => `  - tools.${tool.path}(...)`);

  const hasGraphqlTools = tools.some((tool) => tool.path.endsWith(".graphql"));

  return [
    "",
    "You have access to these tool namespaces:",
    `  ${namespaces.join(", ")}`,
    "",
    "Prefer one broad lookup over many small ones: use `tools.catalog.namespaces({})` and `tools.catalog.tools({ namespace?, query?, compact: false, depth: 2, limit: 20 })` first.",
    "Then use `tools.discover({ query, depth?, limit?, compact? })` when you need ranking. It returns `{ bestPath, results, total }` (not an array).",
    "Prefer `bestPath` when present, otherwise copy a `results[i].exampleCall` for invocation shape.",
    "For migration/ETL tasks: discover once, then execute in small batches and return compact summaries (counts, IDs, top-N samples).",
    "Never shadow the global `tools` object (do NOT write `const tools = ...`).",
    "Then call tools directly using the returned path.",
    ...(hasGraphqlTools
      ? ["GraphQL tools return `{ data, errors }`; prefer `source.query.*` / `source.mutation.*` helpers over raw `source.graphql` when available."]
      : []),
    ...(examples.length > 0
      ? ["", "Example callable paths:", ...examples]
      : []),
  ].join("\n");
}

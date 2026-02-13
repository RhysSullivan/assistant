import {
  buildApprovalTree,
  buildNamespaceTree,
  buildSourceTree,
  toolNamespace,
  type ToolGroup,
} from "@/lib/tool-explorer-grouping";
import { sourceLabel } from "@/lib/tool-source-utils";
import type { ToolDescriptor } from "@/lib/types";
import type { ToolSourceRecord } from "@/lib/types";
import type { GroupBy, ViewMode } from "./explorer-toolbar";

export type FilterApproval = "all" | "required" | "auto";

export function expandedKeysForSource(source: string | null): Set<string> {
  return source ? new Set([`source:${source}`]) : new Set();
}

export function filterToolsBySourceAndApproval(
  tools: ToolDescriptor[],
  activeSource: string | null,
  filterApproval: FilterApproval,
): ToolDescriptor[] {
  let result = tools;

  if (activeSource) {
    result = result.filter((tool) => sourceLabel(tool.source) === activeSource);
  }

  if (filterApproval === "required") {
    result = result.filter((tool) => tool.approval === "required");
  } else if (filterApproval === "auto") {
    result = result.filter((tool) => tool.approval !== "required");
  }

  return result;
}

export function filterToolsBySearch(
  tools: ToolDescriptor[],
  search: string,
): ToolDescriptor[] {
  if (!search) {
    return tools;
  }

  const lowerSearch = search.toLowerCase();
  return tools.filter(
    (tool) =>
      tool.path.toLowerCase().includes(lowerSearch) ||
      tool.description.toLowerCase().includes(lowerSearch),
  );
}

export function treeGroupsForView(
  tools: ToolDescriptor[],
  viewMode: ViewMode,
  groupBy: GroupBy,
  options?: {
    loadingSources?: string[];
    sourceRecords?: ToolSourceRecord[];
    activeSource?: string | null;
  },
): ToolGroup[] {
  if (viewMode === "flat") {
    return [];
  }

  if (groupBy === "source") {
    return buildSourceTreeWithLoading(
      buildSourceTree(tools),
      options?.loadingSources ?? [],
      options?.sourceRecords ?? [],
      options?.activeSource ?? null,
    );
  }

  if (groupBy === "namespace") {
    return buildNamespaceTree(tools);
  }

  return buildApprovalTree(tools);
}

function buildSourceTreeWithLoading(
  groups: ToolGroup[],
  loadingSources: string[],
  sourceRecords: ToolSourceRecord[],
  activeSource: string | null,
): ToolGroup[] {
  if (loadingSources.length === 0) return groups;

  const existingSourceKeys = new Set(
    groups
      .filter((group) => group.type === "source")
      .map((group) => group.label),
  );
  const sourceTypeByName = new Map<string, string>(
    sourceRecords.map((source) => [source.name, source.type]),
  );

  const loadingPlaceholders = loadingSources
    .filter((sourceName) =>
      (activeSource ? sourceName === activeSource : true)
      && !existingSourceKeys.has(sourceName),
    )
    .map((sourceName) => ({
      key: `source:${sourceName}`,
      label: sourceName,
      type: "source" as const,
      sourceType: sourceTypeByName.get(sourceName) ?? "local",
      childCount: 0,
      approvalCount: 0,
      loadingPlaceholderCount: 3,
      children: [],
    }));

  if (loadingPlaceholders.length === 0) return groups;

  return [...groups, ...loadingPlaceholders].sort((a, b) => {
    if (a.childCount !== b.childCount) return b.childCount - a.childCount;
    return a.label.localeCompare(b.label);
  });
}

export function flatToolsForView(
  tools: ToolDescriptor[],
  viewMode: ViewMode,
): ToolDescriptor[] {
  if (viewMode !== "flat") {
    return [];
  }

  return [...tools].sort((a, b) => a.path.localeCompare(b.path));
}

export function autoExpandedKeysForSearch(
  search: string,
  filteredTools: ToolDescriptor[],
  viewMode: ViewMode,
): Set<string> | null {
  if (search.length < 2 || viewMode !== "tree") {
    return null;
  }

  const allGroupKeys = new Set<string>();
  const lowerSearch = search.toLowerCase();
  const matching = filteredTools.filter(
    (tool) =>
      tool.path.toLowerCase().includes(lowerSearch) ||
      tool.description.toLowerCase().includes(lowerSearch),
  );

  for (const tool of matching) {
    const source = sourceLabel(tool.source);
    const namespace = toolNamespace(tool.path);
    allGroupKeys.add(`source:${source}`);
    allGroupKeys.add(`source:${source}:ns:${namespace}`);
    allGroupKeys.add(`ns:${namespace}`);
  }

  return allGroupKeys;
}

export function countSelectedTools(
  selectedKeys: Set<string>,
  filteredTools: ToolDescriptor[],
): number {
  return Array.from(selectedKeys).filter((key) =>
    filteredTools.some((tool) => tool.path === key),
  ).length;
}

export function sourceOptionsFromTools(
  tools: ToolDescriptor[],
  loadingSources: string[] = [],
): string[] {
  const sourceSet = new Set(
    tools.map((tool) => sourceLabel(tool.source)),
  );

  for (const source of loadingSources) {
    sourceSet.add(source);
  }

  return Array.from(sourceSet);
}

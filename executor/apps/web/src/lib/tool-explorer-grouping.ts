import { sourceLabel, sourceType } from "@/lib/tool-source-utils";
import type { ToolDescriptor } from "@/lib/types";

export interface ToolGroup {
  key: string;
  label: string;
  type: "source" | "namespace";
  sourceType?: string;
  childCount: number;
  approvalCount: number;
  loadingPlaceholderCount?: number;
  children: ToolGroup[] | ToolDescriptor[];
}

export function toolNamespace(path: string): string {
  const parts = path.split(".");
  if (parts.length >= 2) return parts.slice(0, -1).join(".");
  return parts[0];
}

function trimLeadingNamespace(path: string, prefix: string): string {
  const dottedPrefix = `${prefix}.`;
  if (path.startsWith(dottedPrefix)) {
    return path.slice(dottedPrefix.length);
  }
  return path;
}

export function toolOperation(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

export function buildSourceTree(tools: ToolDescriptor[]): ToolGroup[] {
  const bySource = new Map<string, ToolDescriptor[]>();
  for (const tool of tools) {
    const src = sourceLabel(tool.source);
    let list = bySource.get(src);
    if (!list) {
      list = [];
      bySource.set(src, list);
    }
    list.push(tool);
  }

  return Array.from(bySource.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([src, srcTools]) => {
      const sType = srcTools[0] ? sourceType(srcTools[0].source) : "local";

      const byNs = new Map<string, ToolDescriptor[]>();
      for (const tool of srcTools) {
        const ns = toolNamespace(tool.path);
        let list = byNs.get(ns);
        if (!list) {
          list = [];
          byNs.set(ns, list);
        }
        list.push(tool);
      }

      const nsGroups: ToolGroup[] = Array.from(byNs.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ns, nsTools]) => ({
          key: `source:${src}:ns:${ns}`,
          label: trimLeadingNamespace(ns, src),
          type: "namespace" as const,
          childCount: nsTools.length,
          approvalCount: nsTools.filter((t) => t.approval === "required")
            .length,
          children: [...nsTools].sort((a, b) =>
            a.path.localeCompare(b.path),
          ),
        }));

      return {
        key: `source:${src}`,
        label: src,
        type: "source" as const,
        sourceType: sType,
        childCount: srcTools.length,
        approvalCount: srcTools.filter((t) => t.approval === "required")
          .length,
        children: nsGroups,
      };
    });
}

export function buildNamespaceTree(tools: ToolDescriptor[]): ToolGroup[] {
  const byNs = new Map<string, ToolDescriptor[]>();
  for (const tool of tools) {
    const ns = toolNamespace(tool.path);
    let list = byNs.get(ns);
    if (!list) {
      list = [];
      byNs.set(ns, list);
    }
    list.push(tool);
  }

  return Array.from(byNs.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ns, nsTools]) => ({
      key: `ns:${ns}`,
      label: ns,
      type: "namespace" as const,
      childCount: nsTools.length,
      approvalCount: nsTools.filter((t) => t.approval === "required").length,
      children: [...nsTools].sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

export function buildApprovalTree(tools: ToolDescriptor[]): ToolGroup[] {
  const gated = tools.filter((t) => t.approval === "required");
  const auto = tools.filter((t) => t.approval !== "required");
  const groups: ToolGroup[] = [];

  if (gated.length > 0) {
    groups.push({
      key: "approval:required",
      label: "Approval Required",
      type: "namespace",
      childCount: gated.length,
      approvalCount: gated.length,
      children: [...gated].sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  if (auto.length > 0) {
    groups.push({
      key: "approval:auto",
      label: "Auto-approved",
      type: "namespace",
      childCount: auto.length,
      approvalCount: 0,
      children: [...auto].sort((a, b) => a.path.localeCompare(b.path)),
    });
  }

  return groups;
}

export function collectGroupKeys(groups: ToolGroup[]): Set<string> {
  const keys = new Set<string>();
  const stack = [...groups];

  while (stack.length > 0) {
    const group = stack.pop();
    if (!group) continue;

    keys.add(group.key);
    if (group.children.length > 0 && "key" in group.children[0]) {
      stack.push(...(group.children as ToolGroup[]));
    }
  }

  return keys;
}

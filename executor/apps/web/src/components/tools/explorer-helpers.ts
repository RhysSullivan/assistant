import type { ToolDescriptor } from "@/lib/types";
import type { ToolGroup } from "@/lib/tool/explorer-grouping";

export function findToolsInGroupByKey(
  groups: ToolGroup[],
  key: string,
): ToolDescriptor[] {
  for (const group of groups) {
    if (group.key === key) {
      return collectToolsFromGroup(group);
    }

    if (group.children.length > 0 && "key" in group.children[0]) {
      const found = findToolsInGroupByKey(group.children as ToolGroup[], key);
      if (found.length > 0) {
        return found;
      }
    }
  }

  return [];
}

function collectToolsFromGroup(group: ToolGroup): ToolDescriptor[] {
  if (group.children.length === 0) {
    return [];
  }

  if ("key" in group.children[0]) {
    return (group.children as ToolGroup[]).flatMap(collectToolsFromGroup);
  }

  return group.children as ToolDescriptor[];
}

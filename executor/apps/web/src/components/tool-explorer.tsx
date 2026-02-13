"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  collectGroupKeys,
} from "@/lib/tool-explorer-grouping";
import type { ToolDescriptor, ToolSourceRecord } from "@/lib/types";
import { findToolsInGroupByKey } from "./tool-explorer-helpers";
import {
  autoExpandedKeysForSearch,
  countSelectedTools,
  expandedKeysForSource,
  filterToolsBySearch,
  filterToolsBySourceAndApproval,
  flatToolsForView,
  sourceOptionsFromTools,
  treeGroupsForView,
  type FilterApproval,
} from "./tool-explorer-derived";
import { ToolExplorerLoading } from "./tool-explorer-loading";
import {
  EmptyState,
  VirtualFlatList,
} from "./tool-explorer-rows";
import { GroupNode, SourceSidebar } from "./tool-explorer-groups";
import {
  ToolExplorerToolbar,
  type GroupBy,
  type ViewMode,
} from "./tool-explorer-toolbar";

// ── Main Explorer ──

interface ToolExplorerProps {
  tools: ToolDescriptor[];
  sources: ToolSourceRecord[];
  loading?: boolean;
  warnings?: string[];
  initialSource?: string | null;
  activeSource?: string | null;
  onActiveSourceChange?: (source: string | null) => void;
  showSourceSidebar?: boolean;
}

export function ToolExplorer({
  tools,
  sources,
  loading = false,
  warnings = [],
  initialSource = null,
  activeSource,
  onActiveSourceChange,
  showSourceSidebar = true,
}: ToolExplorerProps) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [groupBy, setGroupBy] = useState<GroupBy>("source");
  const [internalActiveSource, setInternalActiveSource] = useState<string | null>(initialSource);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => expandedKeysForSource(initialSource),
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [filterApproval, setFilterApproval] = useState<FilterApproval>("all");
  const treeListRef = useRef<HTMLDivElement>(null);
  const flatListRef = useRef<HTMLDivElement>(null);
  const resolvedActiveSource =
    activeSource === undefined ? internalActiveSource : activeSource;

  const handleSourceSelect = useCallback((source: string | null) => {
    if (activeSource === undefined) {
      setInternalActiveSource(source);
    }

    onActiveSourceChange?.(source);
    setExpandedKeys(expandedKeysForSource(source));
  }, [activeSource, onActiveSourceChange]);

  const filteredTools = useMemo(() => {
    return filterToolsBySourceAndApproval(
      tools,
      resolvedActiveSource,
      filterApproval,
    );
  }, [tools, resolvedActiveSource, filterApproval]);

  const searchedTools = useMemo(() => {
    return filterToolsBySearch(filteredTools, search);
  }, [filteredTools, search]);

  const treeGroups = useMemo(() => {
    return treeGroupsForView(searchedTools, viewMode, groupBy);
  }, [searchedTools, viewMode, groupBy]);

  const flatTools = useMemo(() => {
    return flatToolsForView(searchedTools, viewMode);
  }, [searchedTools, viewMode]);

  const autoExpandedKeys = useMemo(() => {
    return autoExpandedKeysForSearch(search, filteredTools, viewMode);
  }, [search, filteredTools, viewMode]);

  const visibleExpandedKeys = autoExpandedKeys ?? expandedKeys;

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleSelectTool = useCallback(
    (path: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    [],
  );

  const toggleSelectGroup = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        const childTools = findToolsInGroupByKey(treeGroups, key);
        const allSelected =
          childTools.length > 0 &&
          childTools.every((t) => prev.has(t.path));

        if (allSelected) {
          for (const t of childTools) next.delete(t.path);
          next.delete(key);
        } else {
          for (const t of childTools) next.add(t.path);
          next.add(key);
        }
        return next;
      });
    },
    [treeGroups],
  );

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(filteredTools.map((t) => t.path)));
  }, [filteredTools]);

  const selectedToolCount = useMemo(() => {
    return countSelectedTools(selectedKeys, filteredTools);
  }, [selectedKeys, filteredTools]);

  const sourceOptions = useMemo(() => sourceOptionsFromTools(tools), [tools]);

  const handleExpandAll = useCallback(() => {
    setExpandedKeys(collectGroupKeys(treeGroups));
  }, [treeGroups]);

  const handleCollapseAll = useCallback(() => {
    setExpandedKeys(new Set());
  }, []);

  const handleExplorerWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const listEl = viewMode === "flat" ? flatListRef.current : treeListRef.current;
      if (!listEl) return;

      const target = e.target as HTMLElement | null;
      if (target && listEl.contains(target)) return;

      const atTop = listEl.scrollTop <= 0;
      const atBottom =
        listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 1;

      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return;

      listEl.scrollTop += e.deltaY;
      e.preventDefault();
    },
    [viewMode],
  );

  if (loading) return <ToolExplorerLoading sources={sources} />;

  return (
    <div className="flex" onWheelCapture={handleExplorerWheel}>
      {showSourceSidebar ? (
        <SourceSidebar
          tools={tools}
          activeSource={resolvedActiveSource}
          onSelectSource={handleSourceSelect}
        />
      ) : null}

      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col",
          showSourceSidebar ? "pl-0 lg:pl-4" : "pl-0",
        )}
      >
        <ToolExplorerToolbar
          search={search}
          filteredToolCount={filteredTools.length}
          hasSearch={search.length > 0}
          resultCount={searchedTools.length}
          viewMode={viewMode}
          groupBy={groupBy}
          filterApproval={filterApproval}
          showSourceSidebar={showSourceSidebar}
          activeSource={resolvedActiveSource}
          sourceOptions={sourceOptions}
          selectedToolCount={selectedToolCount}
          warningsCount={warnings.length}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          onViewModeChange={setViewMode}
          onGroupByChange={setGroupBy}
          onFilterApprovalChange={setFilterApproval}
          onSourceSelect={handleSourceSelect}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />

        {viewMode === "flat" ? (
          flatTools.length === 0 ? (
            <div
              ref={flatListRef}
              className="max-h-[calc(100vh-320px)] overflow-y-auto rounded-md border border-border/30 bg-background/30"
            >
              <EmptyState hasSearch={!!search} />
            </div>
          ) : (
            <VirtualFlatList
              tools={flatTools}
              selectedKeys={selectedKeys}
              onSelectTool={toggleSelectTool}
              scrollContainerRef={flatListRef}
            />
          )
        ) : (
          <div
            ref={treeListRef}
            className="max-h-[calc(100vh-320px)] overflow-y-auto rounded-md border border-border/30 bg-background/30"
          >
            {treeGroups.length === 0 ? (
              <EmptyState hasSearch={!!search} />
            ) : (
              <div className="p-1">
                {treeGroups.map((group) => (
                  <GroupNode
                    key={group.key}
                    group={group}
                    depth={0}
                    expandedKeys={visibleExpandedKeys}
                    onToggle={toggleExpand}
                    selectedKeys={selectedKeys}
                    onSelectGroup={toggleSelectGroup}
                    onSelectTool={toggleSelectTool}
                    search={search}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

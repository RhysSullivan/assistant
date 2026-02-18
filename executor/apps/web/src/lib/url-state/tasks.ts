import { parseAsString, parseAsStringLiteral } from "nuqs";
import { asTrimmedString } from "@/lib/url-state/shared";

export const taskTabValues = ["activity", "runner"] as const;

export type TaskTab = (typeof taskTabValues)[number];

export const taskQueryParsers = {
  tab: parseAsStringLiteral(taskTabValues).withDefault("activity"),
  selected: parseAsString,
};

export type TasksSearch = {
  tab?: TaskTab;
  selected?: string;
};

export function normalizeTaskTab(value: unknown): TaskTab {
  return value === "runner" ? "runner" : "activity";
}

export function normalizeTasksSearch(search: Record<string, unknown>): TasksSearch {
  const normalizedTab = normalizeTaskTab(search.tab);
  const selected = asTrimmedString(search.selected);

  return {
    ...(normalizedTab === "activity" ? {} : { tab: normalizedTab }),
    ...(selected ? { selected } : {}),
  };
}

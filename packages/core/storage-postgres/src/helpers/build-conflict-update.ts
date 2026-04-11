import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export const buildConflictUpdateAllColumns = <
  T extends PgTable,
  Q extends keyof T["_"]["columns"],
>(
  table: T,
  excluded: readonly Q[],
): Record<Exclude<keyof T["_"]["columns"], Q>, SQL> => {
  const columns = getTableColumns(table);
  const excludedSet = new Set(excluded as readonly string[]);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([name]) => !excludedSet.has(name))
      .map(([name, column]) => [name, sql.raw(`excluded."${column.name}"`)]),
  ) as Record<Exclude<keyof T["_"]["columns"], Q>, SQL>;
};

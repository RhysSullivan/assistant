// ---------------------------------------------------------------------------
// Where clause compiler — Where[] → SQL fragment
//
// Stub: supports eq, ne, in, not_in, lt, lte, gt, gte. Does NOT support
// contains / starts_with / ends_with yet — they're operator-specific string
// builders and we don't need them for the initial plugin ports.
// ---------------------------------------------------------------------------

import type { Statement } from "@effect/sql/Statement";
import type * as SqlClient from "@effect/sql/SqlClient";
import type { Where } from "@executor/storage-core";

/**
 * Compile a Where[] into a parameterized SQL fragment using the tagged
 * template. Returns `null` if the filter is empty. Values are parameterized,
 * field names are interpolated as identifiers via `sql(name)`.
 */
export const compileWhere = (
  sql: SqlClient.SqlClient,
  where: readonly Where[] | undefined,
): Statement<unknown> | null => {
  if (!where || where.length === 0) return null;

  const parts = where.map((clause, i): Statement<unknown> => {
    const op = clause.operator ?? "eq";
    const field = sql(clause.field);
    let fragment: Statement<unknown>;

    switch (op) {
      case "eq":
        fragment = sql`${field} = ${clause.value as never}`;
        break;
      case "ne":
        fragment = sql`${field} <> ${clause.value as never}`;
        break;
      case "lt":
        fragment = sql`${field} < ${clause.value as never}`;
        break;
      case "lte":
        fragment = sql`${field} <= ${clause.value as never}`;
        break;
      case "gt":
        fragment = sql`${field} > ${clause.value as never}`;
        break;
      case "gte":
        fragment = sql`${field} >= ${clause.value as never}`;
        break;
      case "in":
        fragment = sql`${field} IN ${sql.in(
          (clause.value as readonly unknown[]) ?? [],
        )}`;
        break;
      case "not_in":
        fragment = sql`${field} NOT IN ${sql.in(
          (clause.value as readonly unknown[]) ?? [],
        )}`;
        break;
      default:
        // Stub: fall back to equality for operators we don't implement yet.
        fragment = sql`${field} = ${clause.value as never}`;
    }

    if (i === 0) return fragment;
    const connector = clause.connector ?? "AND";
    return connector === "OR" ? sql` OR ${fragment}` : sql` AND ${fragment}`;
  });

  return parts.reduce((acc, p) => sql`${acc}${p}`);
};

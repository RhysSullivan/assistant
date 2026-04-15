// ---------------------------------------------------------------------------
// Minimal DDL generator — DBSchema → CREATE TABLE IF NOT EXISTS
//
// Stub: SQLite-dialect only, no ALTER, no migrations history. Assumes every
// table has a string `id` primary key unless one is declared in fields.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type * as SqlClient from "@effect/sql/SqlClient";
import type { DBFieldAttribute, DBFieldType, DBSchema } from "@executor/storage-core";

const sqliteColumnType = (type: DBFieldType): string => {
  if (type === "string") return "TEXT";
  if (type === "number") return "REAL";
  if (type === "boolean") return "INTEGER";
  if (type === "date") return "TEXT";
  if (type === "json") return "TEXT";
  if (typeof type === "string" && type.endsWith("[]")) return "TEXT";
  return "TEXT";
};

const columnDef = (name: string, field: DBFieldAttribute): string => {
  const col = field.fieldName ?? name;
  const type = sqliteColumnType(field.type);
  const notNull = field.required === false ? "" : " NOT NULL";
  const unique = field.unique ? " UNIQUE" : "";
  return `"${col}" ${type}${notNull}${unique}`;
};

const tableDdl = (
  modelName: string,
  fields: Record<string, DBFieldAttribute>,
): string => {
  const columns: string[] = [];
  const hasId = "id" in fields;
  if (!hasId) columns.push(`"id" TEXT PRIMARY KEY NOT NULL`);
  for (const [name, field] of Object.entries(fields)) {
    let def = columnDef(name, field);
    if (name === "id") def += " PRIMARY KEY";
    columns.push(def);
  }
  return `CREATE TABLE IF NOT EXISTS "${modelName}" (\n  ${columns.join(",\n  ")}\n)`;
};

const indexDdl = (
  modelName: string,
  fieldName: string,
  field: DBFieldAttribute,
): string | null => {
  if (!field.index) return null;
  const col = field.fieldName ?? fieldName;
  return `CREATE INDEX IF NOT EXISTS "${modelName}_${col}_idx" ON "${modelName}" ("${col}")`;
};

/**
 * Run `CREATE TABLE IF NOT EXISTS` + index creation for every model in the
 * schema. Idempotent — safe to call on every startup.
 */
export const migrate = (
  sql: SqlClient.SqlClient,
  schema: DBSchema,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    for (const { modelName, fields, disableMigrations } of Object.values(schema)) {
      if (disableMigrations) continue;
      yield* sql.unsafe(tableDdl(modelName, fields));
      for (const [fieldName, field] of Object.entries(fields)) {
        const idx = indexDdl(modelName, fieldName, field);
        if (idx) yield* sql.unsafe(idx);
      }
    }
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))));

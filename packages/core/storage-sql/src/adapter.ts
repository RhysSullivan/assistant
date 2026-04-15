// ---------------------------------------------------------------------------
// makeSqlAdapter — DBAdapter on top of @effect/sql
//
// Stub implementation: no transforms, no joins, no transactions (callbacks
// run in-place). Good enough for the initial plugin ports — real backends
// grow from here as the need presents itself.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type * as SqlClient from "@effect/sql/SqlClient";
import { SqlError } from "@effect/sql/SqlError";
import type {
  DBAdapter,
  DBSchema,
  Where,
} from "@executor/storage-core";

import { compileWhere } from "./where";

const absorbSql = <A>(
  eff: Effect.Effect<A, SqlError>,
): Effect.Effect<A, Error> =>
  eff.pipe(
    Effect.catchAll((e) => {
      const cause = (e as unknown as { cause?: unknown }).cause;
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : cause !== undefined
            ? String(cause)
            : "";
      return Effect.fail(
        new Error(`SQL error: ${e.message}${causeMsg ? ` — ${causeMsg}` : ""}`),
      );
    }),
  );

const modelTable = (schema: DBSchema, model: string): string => {
  const entry = schema[model];
  if (!entry) throw new Error(`Unknown model: ${model}`);
  return entry.modelName;
};

/**
 * Coerce a JS value into something the SQLite driver can bind. Stub-level:
 *   - booleans → 0/1
 *   - Date → ISO string
 *   - plain objects / arrays → JSON string
 *   - undefined → null
 *   - everything else passes through
 *
 * Real adapters with `supportsBooleans: false` / `supportsDates: false`
 * / `supportsJSON: false` flags from `DBAdapterFactoryConfig` would do
 * this conditionally based on backend capability. For the SQLite stub
 * we just always coerce.
 */
const coerceValue = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
};

const coerceRow = (
  row: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = coerceValue(v);
  return out;
};

const generateId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

export interface MakeSqlAdapterOptions {
  readonly sql: SqlClient.SqlClient;
  readonly schema: DBSchema;
  /** Override id generation. Default: crypto.randomUUID(). */
  readonly generateId?: () => string;
  /** Adapter id shown in logs. Default: "sql". */
  readonly adapterId?: string;
}

export const makeSqlAdapter = (options: MakeSqlAdapterOptions): DBAdapter => {
  const { sql, schema } = options;
  const idGen = options.generateId ?? generateId;
  const id = options.adapterId ?? "sql";

  const self: DBAdapter = {
    id,

    create: <T extends Record<string, unknown>, R = T>(data: {
      model: string;
      data: Omit<T, "id">;
      select?: string[] | undefined;
      forceAllowId?: boolean | undefined;
    }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const raw: Record<string, unknown> = { ...data.data };
          if (!("id" in raw) || !data.forceAllowId) {
            if (!("id" in raw)) raw.id = idGen();
          }
          const row = coerceRow(raw);
          yield* sql`INSERT INTO ${sql(table)} ${sql.insert(row)}`;
          return raw as unknown as R;
        }),
      ),

    findOne: <T>(data: {
      model: string;
      where: Where[];
      select?: string[] | undefined;
    }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          const rows = whereFrag
            ? yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} WHERE ${whereFrag} LIMIT 1`
            : yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} LIMIT 1`;
          return (rows[0] as unknown as T) ?? null;
        }),
      ),

    findMany: <T>(data: {
      model: string;
      where?: Where[] | undefined;
      limit?: number | undefined;
      select?: string[] | undefined;
      sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
      offset?: number | undefined;
    }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          const limit = data.limit ?? 1000;
          // Stub: no sortBy / offset yet — add when a plugin needs them.
          const rows = whereFrag
            ? yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} WHERE ${whereFrag} LIMIT ${limit}`
            : yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} LIMIT ${limit}`;
          return rows as unknown as T[];
        }),
      ),

    count: (data: { model: string; where?: Where[] | undefined }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          const rows = whereFrag
            ? yield* sql<{ c: number }>`SELECT COUNT(*) as c FROM ${sql(table)} WHERE ${whereFrag}`
            : yield* sql<{ c: number }>`SELECT COUNT(*) as c FROM ${sql(table)}`;
          return Number(rows[0]?.c ?? 0);
        }),
      ),

    update: <T>(data: {
      model: string;
      where: Where[];
      update: Record<string, unknown>;
    }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          if (!whereFrag) return null;
          yield* sql`UPDATE ${sql(table)} SET ${sql.update(coerceRow(data.update))} WHERE ${whereFrag}`;
          const rows = yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} WHERE ${whereFrag} LIMIT 1`;
          return (rows[0] as unknown as T) ?? null;
        }),
      ),

    updateMany: (data: {
      model: string;
      where: Where[];
      update: Record<string, unknown>;
    }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          if (!whereFrag) return 0;
          const before = yield* sql<{ c: number }>`SELECT COUNT(*) as c FROM ${sql(table)} WHERE ${whereFrag}`;
          yield* sql`UPDATE ${sql(table)} SET ${sql.update(coerceRow(data.update))} WHERE ${whereFrag}`;
          return Number(before[0]?.c ?? 0);
        }),
      ),

    delete: (data: { model: string; where: Where[] }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          if (!whereFrag) return;
          yield* sql`DELETE FROM ${sql(table)} WHERE ${whereFrag}`;
        }),
      ),

    deleteMany: (data: { model: string; where: Where[] }) =>
      absorbSql(
        Effect.gen(function* () {
          const table = modelTable(schema, data.model);
          const whereFrag = compileWhere(sql, data.where);
          if (!whereFrag) return 0;
          const before = yield* sql<{ c: number }>`SELECT COUNT(*) as c FROM ${sql(table)} WHERE ${whereFrag}`;
          yield* sql`DELETE FROM ${sql(table)} WHERE ${whereFrag}`;
          return Number(before[0]?.c ?? 0);
        }),
      ),

    // Real transactions via @effect/sql's withTransaction. Same
    // SqlClient is used inside the callback — the client's internal
    // state carries the transactional connection, so our `self` works
    // unchanged as the `trx` argument. If the callback fails, the
    // transaction rolls back; if it succeeds, it commits.
    transaction: <R, E>(
      callback: (trx: Omit<DBAdapter, "transaction">) => Effect.Effect<R, E>,
    ): Effect.Effect<R, E | Error> =>
      sql
        .withTransaction(callback(self))
        .pipe(
          Effect.mapError((e) =>
            e instanceof SqlError
              ? (new Error(`Transaction failed: ${e.message}`) as E | Error)
              : (e as E | Error),
          ),
        ),
  };

  return self;
};

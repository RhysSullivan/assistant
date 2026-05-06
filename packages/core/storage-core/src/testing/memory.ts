// ---------------------------------------------------------------------------
// In-memory CustomAdapter, piped through createAdapter to produce a full
// DBAdapter. Used by the conformance suite and for unit tests that don't
// need real persistence.
//
// Vendored from better-auth (packages/memory-adapter/src/memory-adapter.ts)
// under MIT. Adapted for executor:
//   - Promise/async → Effect.Effect<T, Error>
//   - Stripped the BetterAuthOptions layering (our config is simpler)
//   - Reuses the filter logic from better-auth's memoryAdapter, minus
//     join support (join resolution is not needed for the storage-core
//     testing path — plugins in-process do their own joining)
//   - Transaction uses structuredClone snapshot/rollback, same as
//     better-auth's memory-adapter
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import type {
  CleanedWhere,
  CustomAdapter,
  DBAdapter,
  DBAdapterFactoryConfig,
  JoinConfig,
  StorageFailure,
} from "../adapter";
import type { DBSchema } from "../schema";
import { createAdapter } from "../factory";
import { StorageError } from "../errors";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type Comparable = string | number | boolean | Date;

const compare = (
  a: unknown,
  b: unknown,
  op: "gt" | "gte" | "lt" | "lte",
): boolean => {
  if (
    !(
      typeof a === "string" ||
      typeof a === "number" ||
      typeof a === "boolean" ||
      a instanceof Date
    ) ||
    !(
      typeof b === "string" ||
      typeof b === "number" ||
      typeof b === "boolean" ||
      b instanceof Date
    )
  ) {
    return false;
  }
  const lhs = a as Comparable;
  const rhs = b as Comparable;
  switch (op) {
    case "gt":
      return lhs > rhs;
    case "gte":
      return lhs >= rhs;
    case "lt":
      return lhs < rhs;
    case "lte":
      return lhs <= rhs;
  }
};

const rowAs = <T>(row: Row): T => row as T;
const rowsAs = <T>(rows: readonly Row[]): T[] => rows.map(rowAs<T>);

const invalidArrayValue = (clause: CleanedWhere) =>
  new StorageError({
    message: "Memory adapter where clause expected an array value",
    cause: clause,
  });

const evalClause = (
  record: Row,
  clause: CleanedWhere,
): Effect.Effect<boolean, StorageFailure> =>
  Effect.gen(function* () {
    const { field, value, operator, mode } = clause;
    const isInsensitive =
      mode === "insensitive" &&
      (typeof value === "string" ||
        (Array.isArray(value) &&
          (value as unknown[]).every((v) => typeof v === "string")));

    const lhs = record[field];
    const lowerStr = (v: unknown) =>
      typeof v === "string" ? v.toLowerCase() : v;

    const cmp = (a: unknown, b: unknown): boolean =>
      isInsensitive ? lowerStr(a) === lowerStr(b) : a === b;
    switch (operator) {
      case "in":
        if (!Array.isArray(value)) return yield* invalidArrayValue(clause);
        return (value as unknown[]).some((v) => cmp(lhs, v));
      case "not_in":
        if (!Array.isArray(value)) return yield* invalidArrayValue(clause);
        return !(value as unknown[]).some((v) => cmp(lhs, v));
      case "contains": {
        if (typeof lhs !== "string" || typeof value !== "string") return false;
        return isInsensitive
          ? lhs.toLowerCase().includes(value.toLowerCase())
          : lhs.includes(value);
      }
      case "starts_with": {
        if (typeof lhs !== "string" || typeof value !== "string") return false;
        return isInsensitive
          ? lhs.toLowerCase().startsWith(value.toLowerCase())
          : lhs.startsWith(value);
      }
      case "ends_with": {
        if (typeof lhs !== "string" || typeof value !== "string") return false;
        return isInsensitive
          ? lhs.toLowerCase().endsWith(value.toLowerCase())
          : lhs.endsWith(value);
      }
      case "ne":
        return !cmp(lhs, value);
      case "gt":
        return value != null && compare(lhs, value, "gt");
      case "gte":
        return value != null && compare(lhs, value, "gte");
      case "lt":
        return value != null && compare(lhs, value, "lt");
      case "lte":
        return value != null && compare(lhs, value, "lte");
      case "eq":
      default:
        return cmp(lhs, value);
    }
  });

// Split-group AND/OR grouping: clauses with `connector: "AND"` (or no
// connector) are conjoined, clauses with `connector: "OR"` are disjoined,
// and the two groups are ANDed together. Mirrors the upstream better-auth
// drizzle adapter's `convertWhereClause` so every backend (memory, sqlite,
// postgres) observes the same mixed-connector semantics under the shared
// conformance suite. This diverges from upstream's *memory* adapter, which
// still uses a left-to-right fold; we prefer drizzle parity so that a
// plugin that works against memory always works against SQL.
const matchAll = (
  record: Row,
  where: readonly CleanedWhere[],
): Effect.Effect<boolean, StorageFailure> =>
  Effect.gen(function* () {
    if (where.length === 0) return true;
    if (where.length === 1) return yield* evalClause(record, where[0]!);
    const andGroup = where.filter(
      (w) => w.connector === "AND" || !w.connector,
    );
    const orGroup = where.filter((w) => w.connector === "OR");
    let andResult = true;
    for (const clause of andGroup) {
      if (!(yield* evalClause(record, clause))) {
        andResult = false;
        break;
      }
    }
    if (!andResult) return false;

    if (orGroup.length === 0) return true;
    for (const clause of orGroup) {
      if (yield* evalClause(record, clause)) return true;
    }
    return false;
  });

const filterWhere = (
  rows: Row[],
  where: readonly CleanedWhere[],
): Effect.Effect<Row[], StorageFailure> =>
  Effect.gen(function* () {
    const matches: Row[] = [];
    for (const row of rows) {
      if (yield* matchAll(row, where)) matches.push(row);
    }
    return matches;
  });

const cloneStore = (s: Store): Store => {
  const out: Store = {};
  for (const [k, v] of Object.entries(s)) {
    out[k] = v.map((r) => ({ ...r }));
  }
  return out;
};

// ---------------------------------------------------------------------------
// makeMemoryAdapter — builds a DBAdapter wired up through createAdapter.
// ---------------------------------------------------------------------------

export interface MakeMemoryAdapterOptions {
  readonly schema: DBSchema;
  readonly adapterId?: string;
  readonly generateId?: () => string;
}

export const makeMemoryAdapter = (
  options: MakeMemoryAdapterOptions,
): DBAdapter => {
  let store: Store = {};

  const tableFor = (model: string): Row[] => {
    if (!store[model]) store[model] = [];
    return store[model]!;
  };

  // Join resolver — mirrors the upstream memory adapter's path. Given a
  // base row and a resolved JoinConfig, look up matching rows in the
  // target model's table and attach them under the target's logical name.
  // For one-to-one we attach a single row (or null), otherwise we attach
  // an array capped at `limit`.
  const attachJoins = (base: Row, join: JoinConfig): Row => {
    const out: Row = { ...base };
    for (const [target, cfg] of Object.entries(join)) {
      const targetRows = tableFor(target);
      const matches = targetRows.filter(
        (r) => r[cfg.on.to] === base[cfg.on.from],
      );
      if (cfg.relation === "one-to-one") {
        out[target] = matches[0] ?? null;
      } else {
        const limit = cfg.limit ?? 100;
        out[target] = matches.slice(0, limit);
      }
    }
    return out;
  };

  const findOne: CustomAdapter["findOne"] = <T>({
    model,
    where,
    join,
  }: {
    model: string;
    where: CleanedWhere[];
    select?: string[] | undefined;
    join?: JoinConfig | undefined;
  }) =>
    Effect.gen(function* () {
      const rows = yield* filterWhere(tableFor(model), where);
      const first = rows[0];
      if (!first) return null;
      return rowAs<T>(join ? attachJoins(first, join) : first);
    });

  const findMany: CustomAdapter["findMany"] = <T>({
    model,
    where,
    limit,
    sortBy,
    offset,
    join,
  }: {
    model: string;
    where?: CleanedWhere[] | undefined;
    limit?: number | undefined;
    select?: string[] | undefined;
    sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
    offset?: number | undefined;
    join?: JoinConfig | undefined;
  }) =>
    Effect.gen(function* () {
      let rows = yield* filterWhere(tableFor(model), where ?? []);
      if (sortBy) {
        const { field, direction } = sortBy;
        const sign = direction === "asc" ? 1 : -1;
        rows = rows.slice().sort((a, b) => {
          const av = a[field];
          const bv = b[field];
          if (av === bv) return 0;
          return compare(av, bv, "lt") ? -sign : sign;
        });
      }
      if (offset !== undefined) rows = rows.slice(offset);
      if (limit !== undefined && limit > 0) rows = rows.slice(0, limit);
      if (join) {
        return rowsAs<T>(rows.map((r) => attachJoins(r, join)));
      }
      return rowsAs<T>(rows);
    });

  const updateOne: CustomAdapter["update"] = <T>({
    model,
    where,
    update,
  }: {
    model: string;
    where: CleanedWhere[];
    update: T;
  }) =>
    Effect.gen(function* () {
      const rows = yield* filterWhere(tableFor(model), where);
      const first = rows[0];
      if (!first) return null;
      Object.assign(first, update as Row);
      return rowAs<T>(first);
    });

  const custom: CustomAdapter = {
    create: ({ model, data }) =>
      Effect.sync(() => {
        const table = tableFor(model);
        table.push(data as Row);
        return data;
      }),

    createMany: ({ model, data }) =>
      Effect.sync(() => {
        const table = tableFor(model);
        for (const row of data) table.push(row as Row);
        return data.slice();
      }),

    findOne,

    findMany,

    count: ({ model, where }) =>
      Effect.map(filterWhere(tableFor(model), where ?? []), (rows) => rows.length),

    update: updateOne,

    updateMany: ({ model, where, update }) =>
      Effect.gen(function* () {
        const rows = yield* filterWhere(tableFor(model), where);
        for (const r of rows) Object.assign(r, update);
        return rows.length;
      }),

    delete: ({ model, where }) =>
      Effect.gen(function* () {
        const table = tableFor(model);
        const matches = yield* filterWhere(table, where);
        const first = matches[0];
        if (!first) return;
        const idx = table.indexOf(first);
        if (idx >= 0) table.splice(idx, 1);
      }),

    deleteMany: ({ model, where }) =>
      Effect.gen(function* () {
        const table = tableFor(model);
        const matches = new Set(yield* filterWhere(table, where));
        let count = 0;
        store[model] = table.filter((r) => {
          if (matches.has(r)) {
            count++;
            return false;
          }
          return true;
        });
        return count;
      }),
  };

  // Snapshot-based transaction: clone on entry, restore on failure.
  const txFn: DBAdapterFactoryConfig["transaction"] = <R, E>(
    cb: (trx: Parameters<DBAdapter["transaction"]>[0] extends (
      t: infer T,
    ) => unknown
      ? T
      : never) => Effect.Effect<R, E>,
  ) =>
    Effect.gen(function* () {
      const snapshot = cloneStore(store);
      const result = yield* cb(adapter).pipe(
        Effect.catch((e) => {
          store = snapshot;
          return Effect.fail(e);
        }),
      );
      return result;
    }) as Effect.Effect<R, E | StorageFailure>;

  const adapter: DBAdapter = createAdapter({
    schema: options.schema,
    config: {
      adapterId: options.adapterId ?? "memory",
      supportsJSON: true,
      supportsDates: true,
      supportsBooleans: true,
      supportsArrays: true,
      customIdGenerator: options.generateId
        ? () => options.generateId!()
        : undefined,
      transaction: txFn,
    },
    adapter: custom,
  });

  return adapter;
};

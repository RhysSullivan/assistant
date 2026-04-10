// ---------------------------------------------------------------------------
// Shared Drizzle DB type
// ---------------------------------------------------------------------------

import type { PgDatabase } from "drizzle-orm/pg-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDb = PgDatabase<any, any, any>;

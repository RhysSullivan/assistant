import { createSelectSchema } from "drizzle-orm/effect-schema";

import { dataMigrationsTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";

export const StoredDataMigrationRecordSchema = createSelectSchema(
  dataMigrationsTable,
  {
    appliedAt: TimestampMsSchema,
  },
);

export type StoredDataMigrationRecord =
  typeof StoredDataMigrationRecordSchema.Type;

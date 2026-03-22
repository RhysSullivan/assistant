import {
  Schema,
} from "effect";

import {
  TimestampMsSchema,
} from "../common";

export const StoredCodeMigrationRecordSchema = Schema.Struct({
  id: Schema.String,
  appliedAt: TimestampMsSchema,
});

export type StoredCodeMigrationRecord =
  typeof StoredCodeMigrationRecordSchema.Type;

import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import {
  executionInteractionsTable,
  executionsTable,
} from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import {
  AccountIdSchema,
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  WorkspaceIdSchema,
} from "../ids";

export const ExecutionStatusSchema = Schema.Literal(
  "pending",
  "running",
  "waiting_for_interaction",
  "completed",
  "failed",
  "cancelled",
);

const executionSchemaOverrides = {
  id: ExecutionIdSchema,
  workspaceId: WorkspaceIdSchema,
  createdByAccountId: AccountIdSchema,
  status: ExecutionStatusSchema,
  resultJson: Schema.NullOr(Schema.String),
  errorText: Schema.NullOr(Schema.String),
  logsJson: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(TimestampMsSchema),
  completedAt: Schema.NullOr(TimestampMsSchema),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const ExecutionSchema = createSelectSchema(
  executionsTable,
  executionSchemaOverrides,
);

export const ExecutionInsertSchema = createInsertSchema(
  executionsTable,
  executionSchemaOverrides,
);

export const ExecutionUpdateSchema = createUpdateSchema(
  executionsTable,
  executionSchemaOverrides,
);

export const ExecutionInteractionStatusSchema = Schema.Literal(
  "pending",
  "resolved",
  "cancelled",
);

const executionInteractionSchemaOverrides = {
  id: ExecutionInteractionIdSchema,
  executionId: ExecutionIdSchema,
  status: ExecutionInteractionStatusSchema,
  responseJson: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const ExecutionInteractionSchema = createSelectSchema(
  executionInteractionsTable,
  executionInteractionSchemaOverrides,
);

export const ExecutionInteractionInsertSchema = createInsertSchema(
  executionInteractionsTable,
  executionInteractionSchemaOverrides,
);

export const ExecutionInteractionUpdateSchema = createUpdateSchema(
  executionInteractionsTable,
  executionInteractionSchemaOverrides,
);

export type ExecutionStatus = typeof ExecutionStatusSchema.Type;
export type Execution = typeof ExecutionSchema.Type;
export type ExecutionInteractionStatus = typeof ExecutionInteractionStatusSchema.Type;
export type ExecutionInteraction = typeof ExecutionInteractionSchema.Type;

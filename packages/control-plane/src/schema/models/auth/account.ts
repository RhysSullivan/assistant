import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { accountsTable } from "../../../persistence/schema";
import { TimestampMsSchema } from "../../common";
import { AccountIdSchema } from "../../ids";
import { PrincipalProviderSchema } from "./principal";

const accountSchemaOverrides = {
  id: AccountIdSchema,
  provider: PrincipalProviderSchema,
  email: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const AccountSchema = createSelectSchema(accountsTable, accountSchemaOverrides);

export const AccountInsertSchema = createInsertSchema(
  accountsTable,
  accountSchemaOverrides,
);

export const AccountUpdateSchema = createUpdateSchema(
  accountsTable,
  accountSchemaOverrides,
);

export type Account = typeof AccountSchema.Type;

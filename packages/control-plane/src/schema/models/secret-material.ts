import { Schema } from "effect";

import { TimestampMsSchema } from "../common";
import { SecretMaterialIdSchema } from "../ids";

export const SecretMaterialPurposeSchema = Schema.Literal(
  "auth_material",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauth_client_info",
);

const LegacySecretMaterialSchema = Schema.Struct({
  id: SecretMaterialIdSchema,
  name: Schema.NullOr(Schema.String),
  purpose: SecretMaterialPurposeSchema,
  value: Schema.String,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

const SecretMaterialStorageSchema = Schema.Struct({
  id: SecretMaterialIdSchema,
  name: Schema.NullOr(Schema.String),
  purpose: SecretMaterialPurposeSchema,
  providerId: Schema.String,
  handle: Schema.String,
  value: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const SecretMaterialSchema = Schema.transform(
  Schema.Union(LegacySecretMaterialSchema, SecretMaterialStorageSchema),
  SecretMaterialStorageSchema,
  {
    strict: false,
    decode: (row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      providerId: "providerId" in row ? row.providerId : "local",
      handle: "handle" in row ? row.handle : row.id,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    encode: (material) => ({
      id: material.id,
      name: material.name,
      purpose: material.purpose,
      providerId: material.providerId,
      handle: material.handle,
      value: material.value,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    }),
  },
);

export type SecretMaterialPurpose = typeof SecretMaterialPurposeSchema.Type;
export type SecretMaterial = typeof SecretMaterialSchema.Type;

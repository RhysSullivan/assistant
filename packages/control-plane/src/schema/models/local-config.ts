import { Schema } from "effect";

import { SourceTransportSchema, StringMapSchema } from "./source";

export const LocalConfigSecretProviderSourceSchema = Schema.Literal(
  "env",
  "file",
  "exec",
  "params",
);

export const LocalConfigEnvSecretProviderSchema = Schema.Struct({
  source: Schema.Literal("env"),
});

export const LocalConfigFileSecretProviderModeSchema = Schema.Literal(
  "singleValue",
  "json",
);

export const LocalConfigFileSecretProviderSchema = Schema.Struct({
  source: Schema.Literal("file"),
  path: Schema.String,
  mode: Schema.optional(LocalConfigFileSecretProviderModeSchema),
});

export const LocalConfigExecSecretProviderSchema = Schema.Struct({
  source: Schema.Literal("exec"),
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  allowSymlinkCommand: Schema.optional(Schema.Boolean),
  trustedDirs: Schema.optional(Schema.Array(Schema.String)),
});

export const LocalConfigSecretProviderSchema = Schema.Union(
  LocalConfigEnvSecretProviderSchema,
  LocalConfigFileSecretProviderSchema,
  LocalConfigExecSecretProviderSchema,
);

export const LocalConfigExplicitSecretRefSchema = Schema.Struct({
  source: LocalConfigSecretProviderSourceSchema,
  provider: Schema.String,
  id: Schema.String,
});

export const LocalConfigSecretInputSchema = Schema.Union(
  Schema.String,
  LocalConfigExplicitSecretRefSchema,
);

export const LocalConfigSourceConnectionSchema = Schema.Struct({
  endpoint: Schema.String,
  auth: Schema.optional(LocalConfigSecretInputSchema),
});

export const LocalConfigOpenApiBindingSchema = Schema.Struct({
  specUrl: Schema.String,
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});

export const LocalConfigGraphqlBindingSchema = Schema.Struct({
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
});

export const LocalConfigMcpBindingSchema = Schema.Struct({
  transport: Schema.optional(Schema.NullOr(SourceTransportSchema)),
  queryParams: Schema.optional(Schema.NullOr(StringMapSchema)),
  headers: Schema.optional(Schema.NullOr(StringMapSchema)),
});

export const LocalConfigGoogleDiscoveryBindingSchema = Schema.Struct({
  service: Schema.String,
  version: Schema.String,
  discoveryUrl: Schema.optional(Schema.NullOr(Schema.String)),
  defaultHeaders: Schema.optional(Schema.NullOr(StringMapSchema)),
  scopes: Schema.optional(Schema.Array(Schema.String)),
});

const LocalConfigSourceEntryBaseSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  connection: LocalConfigSourceConnectionSchema,
});

export const LocalConfigOpenApiSourceSchema = Schema.extend(
  LocalConfigSourceEntryBaseSchema,
  Schema.Struct({
    kind: Schema.Literal("openapi"),
    binding: LocalConfigOpenApiBindingSchema,
  }),
);

export const LocalConfigGraphqlSourceSchema = Schema.extend(
  LocalConfigSourceEntryBaseSchema,
  Schema.Struct({
    kind: Schema.Literal("graphql"),
    binding: LocalConfigGraphqlBindingSchema,
  }),
);

export const LocalConfigMcpSourceSchema = Schema.extend(
  LocalConfigSourceEntryBaseSchema,
  Schema.Struct({
    kind: Schema.Literal("mcp"),
    binding: LocalConfigMcpBindingSchema,
  }),
);

export const LocalConfigGoogleDiscoverySourceSchema = Schema.extend(
  LocalConfigSourceEntryBaseSchema,
  Schema.Struct({
    kind: Schema.Literal("google_discovery"),
    binding: LocalConfigGoogleDiscoveryBindingSchema,
  }),
);

export const LocalConfigSourceSchema = Schema.Union(
  LocalConfigOpenApiSourceSchema,
  LocalConfigGraphqlSourceSchema,
  LocalConfigMcpSourceSchema,
  LocalConfigGoogleDiscoverySourceSchema,
);

export const LocalConfigPolicyActionSchema = Schema.Literal("allow", "deny");
export const LocalConfigPolicyApprovalSchema = Schema.Literal("auto", "manual");

export const LocalConfigPolicySchema = Schema.Struct({
  match: Schema.String,
  action: LocalConfigPolicyActionSchema,
  approval: LocalConfigPolicyApprovalSchema,
  enabled: Schema.optional(Schema.Boolean),
  priority: Schema.optional(Schema.Number),
});

export const LocalConfigSecretsSchema = Schema.Struct({
  providers: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: LocalConfigSecretProviderSchema,
    }),
  ),
  defaults: Schema.optional(
    Schema.Struct({
      env: Schema.optional(Schema.String),
      file: Schema.optional(Schema.String),
      exec: Schema.optional(Schema.String),
    }),
  ),
});

export const LocalConfigWorkspaceSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
});

export const LocalExecutorConfigSchema = Schema.Struct({
  workspace: Schema.optional(LocalConfigWorkspaceSchema),
  sources: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: LocalConfigSourceSchema,
    }),
  ),
  policies: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: LocalConfigPolicySchema,
    }),
  ),
  secrets: Schema.optional(LocalConfigSecretsSchema),
});

export type LocalConfigSecretProviderSource =
  typeof LocalConfigSecretProviderSourceSchema.Type;
export type LocalConfigSecretProvider =
  typeof LocalConfigSecretProviderSchema.Type;
export type LocalConfigExplicitSecretRef =
  typeof LocalConfigExplicitSecretRefSchema.Type;
export type LocalConfigSecretInput = typeof LocalConfigSecretInputSchema.Type;
export type LocalConfigSource = typeof LocalConfigSourceSchema.Type;
export type LocalConfigPolicy = typeof LocalConfigPolicySchema.Type;
export type LocalConfigSecrets = typeof LocalConfigSecretsSchema.Type;
export type LocalExecutorConfig = typeof LocalExecutorConfigSchema.Type;

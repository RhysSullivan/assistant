import {
  type ToolDescriptor,
  type ToolPath,
  type ToolSchemaBundle,
  typeSignatureFromSchemaJson,
} from "@executor/codemode-core";
import {
  type CredentialSlot,
  SecretRefSchema,
  SourceImportAuthPolicySchema,
  SourceTransportSchema,
  StringMapSchema,
} from "#schema";
import type {
  SecretRef,
  Source,
  SourceTransport,
  StoredSourceRecipeOperationRecord,
  StringMap,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyStringSchema,
} from "../../api/string-schemas";

const asToolPath = (value: string): ToolPath => value as ToolPath;

export const OptionalNullableStringSchema = Schema.optional(
  Schema.NullOr(Schema.String),
);

export const ConnectBearerAuthSchema = Schema.Struct({
  kind: Schema.Literal("bearer"),
  headerName: OptionalNullableStringSchema,
  prefix: OptionalNullableStringSchema,
  token: OptionalNullableStringSchema,
  tokenRef: Schema.optional(
    Schema.NullOr(SecretRefSchema as Schema.Schema<SecretRef, SecretRef, never>),
  ),
});

export const ConnectOAuth2AuthSchema = Schema.Struct({
  kind: Schema.Literal("oauth2"),
  headerName: OptionalNullableStringSchema,
  prefix: OptionalNullableStringSchema,
  accessToken: OptionalNullableStringSchema,
  accessTokenRef: Schema.optional(
    Schema.NullOr(SecretRefSchema as Schema.Schema<SecretRef, SecretRef, never>),
  ),
  refreshToken: OptionalNullableStringSchema,
  refreshTokenRef: Schema.optional(
    Schema.NullOr(SecretRefSchema as Schema.Schema<SecretRef, SecretRef, never>),
  ),
});

export const ConnectHttpAuthSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  ConnectBearerAuthSchema,
  ConnectOAuth2AuthSchema,
);

export const ConnectHttpImportAuthSchema = Schema.Struct({
  importAuthPolicy: Schema.optional(SourceImportAuthPolicySchema),
  importAuth: Schema.optional(ConnectHttpAuthSchema),
});

export const SourceConnectCommonFieldsSchema = Schema.Struct({
  endpoint: TrimmedNonEmptyStringSchema,
  name: OptionalNullableStringSchema,
  namespace: OptionalNullableStringSchema,
});

export const McpConnectFieldsSchema = Schema.Struct({
  transport: Schema.optional(Schema.NullOr(SourceTransportSchema)),
  queryParams: Schema.optional(Schema.NullOr(StringMapSchema)),
  headers: Schema.optional(Schema.NullOr(StringMapSchema)),
});

export const parseJsonValue = <T>(input: {
  label: string;
  value: string | null;
}): Effect.Effect<T | null, Error, never> =>
  input.value === null
    ? Effect.succeed<T | null>(null)
    : Effect.try({
        try: () => JSON.parse(input.value!) as T,
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Invalid ${input.label}: ${cause.message}`)
            : new Error(`Invalid ${input.label}: ${String(cause)}`),
      });

export class SourceCredentialRequiredError extends Error {
  readonly _tag = "SourceCredentialRequiredError";

  constructor(
    readonly slot: CredentialSlot,
    message: string,
  ) {
    super(message);
  }
}

export const isSourceCredentialRequiredError = (
  error: unknown,
): error is SourceCredentialRequiredError =>
  error instanceof SourceCredentialRequiredError;

export const emptySourceBindingState = {
  transport: null,
  queryParams: null,
  headers: null,
  specUrl: null,
  defaultHeaders: null,
} satisfies {
  transport: SourceTransport | null;
  queryParams: StringMap | null;
  headers: StringMap | null;
  specUrl: string | null;
  defaultHeaders: StringMap | null;
};

export const encodeBindingConfig = (schema: Schema.Schema.AnyNoContext, value: unknown): string =>
  Schema.encodeSync(Schema.parseJson(schema))(value);

export const decodeBindingConfig = <A>(input: {
  sourceId: string;
  label: string;
  schema: Schema.Schema<A, any, never>;
  value: string | null;
}): Effect.Effect<A, Error, never> =>
  input.value === null
    ? Effect.fail(
        new Error(`Missing ${input.label} binding config for ${input.sourceId}`),
      )
    : Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.parseJson(input.schema))(input.value),
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Invalid ${input.label} binding config for ${input.sourceId}: ${cause.message}`)
            : new Error(`Invalid ${input.label} binding config for ${input.sourceId}: ${String(cause)}`),
      });

export const firstSchemaBundle = (input: {
  schemaBundles: readonly ToolSchemaBundle[];
  preferredKind: string | null;
}): ToolSchemaBundle | null =>
  (input.preferredKind
    ? input.schemaBundles.find((schemaBundle) => schemaBundle.kind === input.preferredKind)
    : null)
  ?? input.schemaBundles[0]
  ?? null;

export const createStandardToolDescriptor = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
  path: string;
  includeSchemas: boolean;
  interaction: "auto" | "required";
  outputType?: string | undefined;
  schemaBundleId?: string | null;
}): ToolDescriptor => ({
  path: asToolPath(input.path),
  sourceKey: input.source.id,
  description: input.operation.description ?? input.operation.title ?? undefined,
  interaction: input.interaction,
  inputType: typeSignatureFromSchemaJson(
    input.operation.inputSchemaJson ?? undefined,
    "unknown",
    320,
  ),
  ...(input.outputType ? { outputType: input.outputType } : {}),
  inputSchemaJson: input.includeSchemas ? input.operation.inputSchemaJson ?? undefined : undefined,
  outputSchemaJson: input.includeSchemas ? input.operation.outputSchemaJson ?? undefined : undefined,
  ...(input.schemaBundleId ? { schemaBundleId: input.schemaBundleId } : {}),
  ...(input.operation.providerKind
    ? { providerKind: input.operation.providerKind }
    : {}),
  ...(input.operation.providerDataJson
    ? { providerDataJson: input.operation.providerDataJson }
    : {}),
});

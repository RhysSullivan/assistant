import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CredentialSlotSchema,
  SecretRefSchema,
  SourceBindingVersionSchema,
  SourceImportAuthPolicySchema,
  SourceOauthClientInputSchema,
  SourceTransportSchema,
  StringMapSchema,
  type CredentialSlot,
  type SecretRef,
  type SourceBinding,
  type SourceTransport,
  type StringMap,
} from "./source-models";

const TrimmedNonEmptyStringSchema = Schema.Trim.pipe(Schema.nonEmptyString());

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

export const ConnectOauthClientSchema = Schema.optional(
  Schema.NullOr(SourceOauthClientInputSchema),
);

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

const BindingConfigEnvelopeSchema = <A, I>(
  adapterKey: string,
  payloadSchema: Schema.Schema<A, I, never>,
) =>
  Schema.Struct({
    adapterKey: Schema.Literal(adapterKey),
    version: SourceBindingVersionSchema,
    payload: payloadSchema,
  });

export const encodeBindingConfig = <A, I>(input: {
  adapterKey: string;
  version: number;
  payloadSchema: Schema.Schema<A, I, never>;
  payload: A;
}): string =>
  Schema.encodeSync(
    Schema.parseJson(BindingConfigEnvelopeSchema(input.adapterKey, input.payloadSchema)),
  )({
    adapterKey: input.adapterKey,
    version: input.version,
    payload: input.payload,
  });

export const decodeBindingConfig = <A>(input: {
  sourceId: string;
  label: string;
  adapterKey: string;
  version: number;
  payloadSchema: Schema.Schema<A, any, never>;
  value: string | null;
}): Effect.Effect<SourceBinding & { payload: A }, Error, never> => {
  if (input.value === null) {
    return Effect.fail(
      new Error(`Missing ${input.label} binding config for ${input.sourceId}`),
    );
  }

  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(
        Schema.parseJson(BindingConfigEnvelopeSchema(input.adapterKey, input.payloadSchema)),
      )(input.value),
    catch: (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      return new Error(
        `Invalid ${input.label} binding config for ${input.sourceId}: ${message}`,
      );
    },
  }).pipe(
    Effect.flatMap((decoded) =>
      decoded.version === input.version
        ? Effect.succeed({
            version: decoded.version,
            payload: decoded.payload,
          } as SourceBinding & { payload: A })
        : Effect.fail(
            new Error(
              `Unsupported ${input.label} binding config version ${decoded.version} for ${input.sourceId}; expected ${input.version}`,
            ),
          ),
    ),
  );
};

export const decodeSourceBindingPayload = <A>(input: {
  sourceId: string;
  label: string;
  version: number;
  expectedVersion: number;
  schema: Schema.Schema<A, any, never>;
  value: unknown;
  allowedKeys?: readonly string[] | undefined;
}): Effect.Effect<A, Error, never> =>
  input.version !== input.expectedVersion
    ? Effect.fail(
        new Error(
          `Unsupported ${input.label} binding version ${input.version} for ${input.sourceId}; expected ${input.expectedVersion}`,
        ),
      )
    : Effect.try({
        try: () => {
          if (
            input.allowedKeys
            && input.value !== null
            && typeof input.value === "object"
            && !Array.isArray(input.value)
          ) {
            const extraKeys = Object.keys(input.value as Record<string, unknown>).filter(
              (key) => !input.allowedKeys!.includes(key),
            );
            if (extraKeys.length > 0) {
              throw new Error(
                `Unsupported fields: ${extraKeys.join(", ")}`,
              );
            }
          }

          return Schema.decodeUnknownSync(input.schema)(input.value);
        },
        catch: (cause) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          return new Error(
            `Invalid ${input.label} binding payload for ${input.sourceId}: ${message}`,
          );
        },
      });

export const decodeExecutableBindingPayload = <A>(input: {
  executableId: string;
  label: string;
  version: number;
  expectedVersion: number;
  schema: Schema.Schema<A, any, never>;
  value: unknown;
}): A => {
  if (input.version !== input.expectedVersion) {
    throw new Error(
      `Unsupported ${input.label} executable binding version ${input.version} for ${input.executableId}; expected ${input.expectedVersion}`,
    );
  }

  try {
    return Schema.decodeUnknownSync(input.schema)(input.value);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Invalid ${input.label} executable binding for ${input.executableId}: ${message}`,
    );
  }
};

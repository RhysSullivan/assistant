import { Effect, Schema, SchemaGetter } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { GraphqlIntrospectionError } from "./errors";

// ---------------------------------------------------------------------------
// Introspection query — standard GraphQL introspection
// ---------------------------------------------------------------------------

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: false) {
          name
          description
          args {
            name
            description
            type {
              ...TypeRef
            }
            defaultValue
          }
          type {
            ...TypeRef
          }
        }
        inputFields {
          name
          description
          type {
            ...TypeRef
          }
          defaultValue
        }
        enumValues(includeDeprecated: false) {
          name
          description
        }
      }
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Introspection result schema
// ---------------------------------------------------------------------------

interface IntrospectionTypeRefRecursive {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType: IntrospectionTypeRefRecursive | null;
}

const IntrospectionTypeRefModel: Schema.Codec<IntrospectionTypeRefRecursive> = Schema.Struct({
  kind: Schema.String,
  name: Schema.NullOr(Schema.String),
  ofType: Schema.NullOr(
    Schema.suspend((): Schema.Codec<IntrospectionTypeRefRecursive> => IntrospectionTypeRefModel),
  ),
});

const IntrospectionInputValueModel = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  type: IntrospectionTypeRefModel,
  defaultValue: Schema.NullOr(Schema.String),
});

const IntrospectionFieldModel = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  args: Schema.Array(IntrospectionInputValueModel),
  type: IntrospectionTypeRefModel,
});

const IntrospectionEnumValueModel = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});

const IntrospectionTypeModel = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  fields: Schema.NullOr(Schema.Array(IntrospectionFieldModel)),
  inputFields: Schema.NullOr(Schema.Array(IntrospectionInputValueModel)),
  enumValues: Schema.NullOr(Schema.Array(IntrospectionEnumValueModel)),
});

const IntrospectionSchemaModel = Schema.Struct({
  queryType: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  mutationType: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  types: Schema.Array(IntrospectionTypeModel),
});

const IntrospectionResultModel = Schema.Struct({
  __schema: IntrospectionSchemaModel,
});

export type IntrospectionTypeRef = Schema.Schema.Type<typeof IntrospectionTypeRefModel>;
export type IntrospectionInputValue = Schema.Schema.Type<typeof IntrospectionInputValueModel>;
export type IntrospectionField = Schema.Schema.Type<typeof IntrospectionFieldModel>;
export type IntrospectionEnumValue = Schema.Schema.Type<typeof IntrospectionEnumValueModel>;
export type IntrospectionType = Schema.Schema.Type<typeof IntrospectionTypeModel>;
export type IntrospectionSchema = Schema.Schema.Type<typeof IntrospectionSchemaModel>;
export type IntrospectionResult = Schema.Schema.Type<typeof IntrospectionResultModel>;

const IntrospectionJsonModel = Schema.Union([
  IntrospectionResultModel,
  Schema.Struct({ data: IntrospectionResultModel }),
]).pipe(
  Schema.decodeTo(IntrospectionResultModel, {
    decode: SchemaGetter.transform((value) => ("data" in value ? value.data : value)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// ---------------------------------------------------------------------------
// Introspect a GraphQL endpoint
// ---------------------------------------------------------------------------

export const introspect = Effect.fn("GraphQL.introspect")(function* (
  endpoint: string,
  headers?: Record<string, string>,
  queryParams?: Record<string, string>,
) {
  const client = yield* HttpClient.HttpClient;
  const requestEndpoint =
    queryParams && Object.keys(queryParams).length > 0
      ? (() => {
          const url = new URL(endpoint);
          for (const [name, value] of Object.entries(queryParams)) {
            url.searchParams.set(name, value);
          }
          return url.toString();
        })()
      : endpoint;

  let request = HttpClientRequest.post(requestEndpoint).pipe(
    HttpClientRequest.setHeader("Content-Type", "application/json"),
    HttpClientRequest.bodyJsonUnsafe({
      query: INTROSPECTION_QUERY,
    }),
  );

  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      request = HttpClientRequest.setHeader(request, k, v);
    }
  }

  const response = yield* client.execute(request).pipe(
    Effect.tapCause((cause) => Effect.logError("graphql introspection request failed", cause)),
    Effect.mapError(
      (err) =>
        new GraphqlIntrospectionError({
          message: `Failed to reach GraphQL endpoint: ${err.message}`,
        }),
    ),
  );

  if (response.status !== 200) {
    return yield* new GraphqlIntrospectionError({
      message: `Introspection failed with status ${response.status}`,
    });
  }

  const raw = yield* response.json.pipe(
    Effect.tapCause((cause) => Effect.logError("graphql introspection JSON parse failed", cause)),
    Effect.mapError(
      () =>
        new GraphqlIntrospectionError({
          message: `Failed to parse introspection response as JSON`,
        }),
    ),
  );

  const json = raw as { data?: IntrospectionResult; errors?: unknown[] };

  if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
    return yield* new GraphqlIntrospectionError({
      message: `Introspection returned ${json.errors.length} error(s)`,
    });
  }

  if (!json.data?.__schema) {
    return yield* new GraphqlIntrospectionError({
      message: "Introspection response missing __schema",
    });
  }

  return json.data;
});

// ---------------------------------------------------------------------------
// Parse an introspection result from a JSON string (for offline/text input)
// ---------------------------------------------------------------------------

export const parseIntrospectionJson = (
  text: string,
): Effect.Effect<IntrospectionResult, GraphqlIntrospectionError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(IntrospectionJsonModel))(text).pipe(
    Effect.mapError(
      () =>
        new GraphqlIntrospectionError({
          message: "Failed to parse introspection JSON",
        }),
    ),
  );

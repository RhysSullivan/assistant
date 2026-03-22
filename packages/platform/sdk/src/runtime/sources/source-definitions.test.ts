import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  CredentialIdSchema,
  decodeBuiltInAuthArtifactConfig,
  SourceIdSchema,
  ScopeIdSchema,
  type Source,
} from "#schema";

import {
  createSourceFromPayload,
  projectSourceFromStorage,
  splitSourceForStorage,
  stableSourceCatalogId,
  stableSourceCatalogRevisionId,
  updateSourceFromPayload,
} from "./source-definitions";
import {
  namespaceFromSourceName,
} from "./source-names";

const openApiBinding = (
  specUrl = "https://api.github.com/openapi.json",
  defaultHeaders: Record<string, string> | null = null,
) => ({
  specUrl,
  defaultHeaders,
});

const graphqlBinding = (
  defaultHeaders: Record<string, string> | null = null,
) => ({
  defaultHeaders,
});

type McpRemoteBindingInput = {
  transport?: "auto" | "streamable-http" | "sse" | null;
  queryParams?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  command?: never;
  args?: never;
  env?: never;
  cwd?: never;
};

type McpStdioBindingInput = {
  transport: "stdio";
  command?: string | null;
  args?: ReadonlyArray<string> | null;
  env?: Record<string, string> | null;
  cwd?: string | null;
  queryParams?: never;
  headers?: never;
};

const mcpBinding = (
  input: McpRemoteBindingInput | McpStdioBindingInput = {},
) => {
  if (input.transport === "stdio") {
    return {
      transport: "stdio" as const,
      queryParams: null,
      headers: null,
      command: input.command ?? null,
      args: input.args ?? null,
      env: input.env ?? null,
      cwd: input.cwd ?? null,
    };
  }

  return {
    transport: input.transport ?? null,
    queryParams: input.queryParams ?? null,
    headers: input.headers ?? null,
    command: null,
    args: null,
    env: null,
    cwd: null,
  };
};

const makeSource = (overrides: Partial<Source> = {}): Source => ({
  id: SourceIdSchema.make("src_source_definitions"),
  scopeId: ScopeIdSchema.make("ws_source_definitions"),
  name: "GitHub",
  kind: "openapi",
  endpoint: "https://api.github.com",
  status: "connected",
  enabled: true,
  namespace: "github",
  bindingVersion: 1,
  binding: openApiBinding(),
  importAuthPolicy: "reuse_runtime",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: null,
  lastError: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe("source-definitions", () => {
  describe("stable catalog ids", () => {
    it("is deterministic across calls and ignores source name/workspace", () => {
      const source = makeSource();
      const renamed = makeSource({
        name: "Renamed GitHub",
      });
      const differentWorkspace = makeSource({
        scopeId: ScopeIdSchema.make("ws_source_definitions_other"),
      });

      expect(stableSourceCatalogId(source)).toBe(stableSourceCatalogId(source));
      expect(stableSourceCatalogRevisionId(source)).toBe(
        stableSourceCatalogRevisionId(source),
      );
      expect(stableSourceCatalogId(renamed)).toBe(
        stableSourceCatalogId(source),
      );
      expect(stableSourceCatalogRevisionId(renamed)).toBe(
        stableSourceCatalogRevisionId(source),
      );
      expect(stableSourceCatalogId(differentWorkspace)).toBe(
        stableSourceCatalogId(source),
      );
      expect(stableSourceCatalogRevisionId(differentWorkspace)).toBe(
        stableSourceCatalogRevisionId(source),
      );
    });

    it("changes catalog and revision ids when the source config changes", () => {
      const source = makeSource();
      const changedEndpoint = makeSource({
        endpoint: "https://example.com",
        binding: openApiBinding("https://example.com/openapi.json"),
      });

      expect(stableSourceCatalogId(changedEndpoint)).not.toBe(
        stableSourceCatalogId(source),
      );
      expect(stableSourceCatalogRevisionId(changedEndpoint)).not.toBe(
        stableSourceCatalogRevisionId(source),
      );
    });
  });

  describe("payload normalization and validation", () => {
    it.effect(
      "defaults created sources to draft/enabled and trims fields",
      () =>
        Effect.gen(function* () {
          const source = yield* createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_create_defaults"),
            sourceId: SourceIdSchema.make("src_create_defaults"),
            payload: {
              name: "  GitHub  ",
              kind: "openapi",
              endpoint: " https://api.github.com ",
              binding: openApiBinding(" https://api.github.com/openapi.json "),
            },
            now: 1234,
          });

          expect(source.name).toBe("GitHub");
          expect(source.endpoint).toBe("https://api.github.com");
          expect(source.binding).toEqual(
            openApiBinding("https://api.github.com/openapi.json"),
          );
          expect(source.status).toBe("draft");
          expect(source.enabled).toBe(true);
          expect(source.auth).toEqual({ kind: "none" });
        }),
    );

    it.effect(
      "preserves existing values on partial update and keeps auth when undefined",
      () =>
        Effect.gen(function* () {
          const source = makeSource({
            kind: "graphql",
            endpoint: "https://example.com/graphql",
            binding: graphqlBinding({ accept: "application/json" }),
            auth: {
              kind: "bearer",
              headerName: "Authorization",
              prefix: "Bearer ",
              token: {
                providerId: "local",
                handle: "sec_token",
              },
            },
          });

          const updated = yield* updateSourceFromPayload({
            source,
            payload: {
              status: "error",
              lastError: "bad gateway",
            },
            now: 2000,
          });

          expect(updated.name).toBe(source.name);
          expect(updated.endpoint).toBe(source.endpoint);
          expect(updated.binding).toEqual(source.binding);
          expect(updated.auth).toEqual(source.auth);
          expect(updated.status).toBe("error");
          expect(updated.lastError).toBe("bad gateway");
          expect(updated.updatedAt).toBe(2000);
        }),
    );

    it.effect(
      "normalizes oauth2 auth defaults and allows null refresh tokens",
      () =>
        Effect.gen(function* () {
          const source = yield* createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_create_oauth_defaults"),
            sourceId: SourceIdSchema.make("src_create_oauth_defaults"),
            payload: {
              name: "GraphQL Demo",
              kind: "graphql",
              endpoint: "https://example.com/graphql",
              auth: {
                kind: "oauth2",
                headerName: "   ",
                prefix: undefined,
                accessToken: {
                  providerId: " local ",
                  handle: " sec_access ",
                },
                refreshToken: null,
              } as never,
            },
            now: 1234,
          });

          expect(source.auth).toEqual({
            kind: "oauth2",
            headerName: "Authorization",
            prefix: "Bearer ",
            accessToken: {
              providerId: "local",
              handle: "sec_access",
            },
            refreshToken: null,
          });
        }),
    );

    it.effect("rejects invalid bearer and oauth2 secret refs", () =>
      Effect.gen(function* () {
        const invalidBearer = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_bearer"),
            sourceId: SourceIdSchema.make("src_invalid_bearer"),
            payload: {
              name: "Bad Bearer",
              kind: "openapi",
              endpoint: "https://example.com",
              binding: openApiBinding("https://example.com/openapi.json"),
              auth: {
                kind: "bearer",
                headerName: "Authorization",
                prefix: "Bearer ",
                token: {
                  providerId: "   ",
                  handle: "sec_token",
                },
              },
            },
            now: 1234,
          }),
        );
        expect(invalidBearer.message).toContain(
          "Bearer auth requires a token secret ref",
        );

        const invalidRefresh = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_refresh"),
            sourceId: SourceIdSchema.make("src_invalid_refresh"),
            payload: {
              name: "Bad OAuth",
              kind: "graphql",
              endpoint: "https://example.com/graphql",
              binding: graphqlBinding(),
              auth: {
                kind: "oauth2",
                headerName: "Authorization",
                prefix: "Bearer ",
                accessToken: {
                  providerId: "local",
                  handle: "sec_access",
                },
                refreshToken: {
                  providerId: "local",
                  handle: "   ",
                },
              } as never,
            },
            now: 1234,
          }),
        );
        expect(invalidRefresh.message).toContain(
          "OAuth2 refresh token ref must include providerId and handle",
        );
      }),
    );

    it.effect("rejects invalid source kind combinations", () =>
      Effect.gen(function* () {
        const invalidMcp = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_mcp"),
            sourceId: SourceIdSchema.make("src_invalid_mcp"),
            payload: {
              name: "MCP",
              kind: "mcp",
              endpoint: "https://example.com/mcp",
              binding: {
                specUrl: "https://example.com/openapi.json",
              },
            } as never,
            now: 1234,
          }),
        );
        expect(invalidMcp.message).toContain(
          "MCP sources cannot define specUrl",
        );

        const invalidOpenApiSpec = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_openapi_spec"),
            sourceId: SourceIdSchema.make("src_invalid_openapi_spec"),
            payload: {
              name: "OpenAPI",
              kind: "openapi",
              endpoint: "https://example.com",
              binding: openApiBinding("   "),
            } as never,
            now: 1234,
          }),
        );
        expect(invalidOpenApiSpec.message).toContain(
          "OpenAPI sources require specUrl",
        );

        const invalidOpenApiTransport = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_openapi_transport"),
            sourceId: SourceIdSchema.make("src_invalid_openapi_transport"),
            payload: {
              name: "OpenAPI",
              kind: "openapi",
              endpoint: "https://example.com",
              binding: {
                specUrl: "https://example.com/openapi.json",
                transport: "sse",
              },
            } as never,
            now: 1234,
          }),
        );
        expect(invalidOpenApiTransport.message).toContain(
          "OpenAPI sources cannot define MCP transport settings",
        );

        const invalidGraphql = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_graphql"),
            sourceId: SourceIdSchema.make("src_invalid_graphql"),
            payload: {
              name: "GraphQL",
              kind: "graphql",
              endpoint: "https://example.com/graphql",
              binding: {
                specUrl: "https://example.com/openapi.json",
              },
            } as never,
            now: 1234,
          }),
        );
        expect(invalidGraphql.message).toContain(
          "GraphQL sources cannot define specUrl",
        );

        const invalidInternal = yield* Effect.flip(
          createSourceFromPayload({
            scopeId: ScopeIdSchema.make("ws_invalid_internal"),
            sourceId: SourceIdSchema.make("src_invalid_internal"),
            payload: {
              name: "Internal",
              kind: "internal",
              endpoint: "internal://executor",
              binding: {
                defaultHeaders: {
                  accept: "application/json",
                },
              },
            } as never,
            now: 1234,
          }),
        );
        expect(invalidInternal.message).toContain(
          "internal sources cannot define HTTP source settings",
        );
      }),
    );

    it.effect("normalizes new auth during updates", () =>
      Effect.gen(function* () {
        const updated = yield* updateSourceFromPayload({
          source: makeSource({
            auth: { kind: "none" },
          }),
          payload: {
            auth: {
              kind: "bearer",
              headerName: "  ",
              prefix: "Token ",
              token: {
                providerId: " local ",
                handle: " sec_token ",
              },
            } as never,
          },
          now: 2000,
        });

        expect(updated.auth).toEqual({
          kind: "bearer",
          headerName: "Authorization",
          prefix: "Token ",
          token: {
            providerId: "local",
            handle: "sec_token",
          },
        });
      }),
    );
  });

  describe("storage roundtrip", () => {
    it.effect("roundtrips bearer auth and serialized maps", () =>
      Effect.gen(function* () {
        const source = makeSource({
          kind: "mcp",
          binding: mcpBinding({
            transport: "auto",
            queryParams: { page: "1" },
            headers: { "x-api-key": "secret" },
          }),
          auth: {
            kind: "bearer",
            headerName: "Authorization",
            prefix: "Bearer ",
            token: {
              providerId: "local",
              handle: "sec_bearer",
            },
          },
        });
        const catalogId = stableSourceCatalogId(source);
        const catalogRevisionId = stableSourceCatalogRevisionId(source);
        const existingCredentialId = CredentialIdSchema.make("cred_existing");

        const { sourceRecord, runtimeAuthArtifact } = splitSourceForStorage({
          source,
          catalogId,
          catalogRevisionId,
          existingRuntimeAuthArtifactId: existingCredentialId,
        });

        expect(runtimeAuthArtifact?.id).toBe(existingCredentialId);
        const decoded = runtimeAuthArtifact
          ? decodeBuiltInAuthArtifactConfig(runtimeAuthArtifact)
          : null;
        expect(decoded?.artifactKind).toBe("static_bearer");
        expect(JSON.parse(sourceRecord.bindingConfigJson ?? "{}")).toEqual({
          adapterKey: "mcp",
          version: 1,
          payload: source.binding,
        });

        const projected = yield* projectSourceFromStorage({
          sourceRecord,
          runtimeAuthArtifact: runtimeAuthArtifact ?? null,
          importAuthArtifact: null,
        });

        expect(projected).toEqual(source);
      }),
    );

    it.effect("roundtrips oauth2 auth with and without refresh tokens", () =>
      Effect.gen(function* () {
        const withRefresh = makeSource({
          kind: "graphql",
          endpoint: "https://example.com/graphql",
          binding: graphqlBinding({ accept: "application/json" }),
          auth: {
            kind: "oauth2",
            headerName: "Authorization",
            prefix: "Bearer ",
            accessToken: {
              providerId: "local",
              handle: "sec_access",
            },
            refreshToken: {
              providerId: "local",
              handle: "sec_refresh",
            },
          },
        });
        const withoutRefresh = makeSource({
          id: SourceIdSchema.make("src_source_definitions_no_refresh"),
          kind: "graphql",
          endpoint: "https://example.com/graphql",
          binding: graphqlBinding({ accept: "application/json" }),
          auth: {
            kind: "oauth2",
            headerName: "Authorization",
            prefix: "Bearer ",
            accessToken: {
              providerId: "local",
              handle: "sec_access",
            },
            refreshToken: null,
          },
        });

        for (const source of [withRefresh, withoutRefresh]) {
          const { sourceRecord, runtimeAuthArtifact } = splitSourceForStorage({
            source,
            catalogId: stableSourceCatalogId(source),
            catalogRevisionId: stableSourceCatalogRevisionId(source),
          });
          const projected = yield* projectSourceFromStorage({
            sourceRecord,
            runtimeAuthArtifact: runtimeAuthArtifact ?? null,
            importAuthArtifact: null,
          });

          expect(projected).toEqual(source);
        }
      }),
    );

    it.effect("roundtrips stdio MCP bindings without remote fields", () =>
      Effect.gen(function* () {
        const source = makeSource({
          kind: "mcp",
          endpoint: "stdio://local/chrome-devtools-mcp",
          binding: mcpBinding({
            transport: "stdio",
            command: "npx",
            args: ["-y", "chrome-devtools-mcp@latest"],
            env: {
              CHROME_PATH:
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            },
            cwd: "/tmp/chrome-devtools",
          }),
          auth: { kind: "none" },
        });

        const { sourceRecord, runtimeAuthArtifact } = splitSourceForStorage({
          source,
          catalogId: stableSourceCatalogId(source),
          catalogRevisionId: stableSourceCatalogRevisionId(source),
        });

        expect(runtimeAuthArtifact).toBeNull();
        expect(JSON.parse(sourceRecord.bindingConfigJson ?? "{}")).toEqual({
          adapterKey: "mcp",
          version: 1,
          payload: source.binding,
        });

        const projected = yield* projectSourceFromStorage({
          sourceRecord,
          runtimeAuthArtifact: null,
          importAuthArtifact: null,
        });

        expect(projected).toEqual(source);
      }),
    );

    it.effect(
      "stores no credential for auth.kind none and projects back correctly",
      () =>
        Effect.gen(function* () {
          const source = makeSource({
            auth: { kind: "none" },
          });
          const { sourceRecord, runtimeAuthArtifact } = splitSourceForStorage({
            source,
            catalogId: stableSourceCatalogId(source),
            catalogRevisionId: stableSourceCatalogRevisionId(source),
          });

          expect(runtimeAuthArtifact).toBeNull();

          const projected = yield* projectSourceFromStorage({
            sourceRecord,
            runtimeAuthArtifact: null,
            importAuthArtifact: null,
          });

          expect(projected.auth).toEqual({ kind: "none" });
          expect(projected).toEqual(source);
        }),
    );
  });

  describe("namespaceFromSourceName", () => {
    it("normalizes names into namespace-safe dotted segments", () => {
      expect(namespaceFromSourceName("My API v2!")).toBe("my.api.v2");
      expect(namespaceFromSourceName("   ")).toBe("source");
      expect(namespaceFromSourceName("!!!")).toBe("source");
    });
  });
});

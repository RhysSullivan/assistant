import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  extractOpenApiManifest,
} from "@executor/codemode-openapi";

import {
  AccountIdSchema,
  SourceIdSchema,
  type LocalConfigSource,
  SourceRecipeIdSchema,
  SourceRecipeRevisionIdSchema,
  WorkspaceIdSchema,
  type Source,
  type StoredSourceRecipeOperationRecord,
} from "#schema";
import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "#persistence";

import {
  loadLocalExecutorConfig,
  resolveLocalWorkspaceContext,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import {
  buildLocalSourceArtifact,
  writeLocalSourceArtifact,
} from "./local-source-artifacts";
import {
  RuntimeLocalWorkspaceService,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import {
  writeLocalWorkspaceState,
} from "./local-workspace-state";
import {
  expandRecipeTools,
  loadSourceWithRecipe,
  loadWorkspaceSourceRecipes,
  recipeToolDescriptor,
  recipeToolPath,
  recipeToolSearchNamespace,
  type LoadedSourceRecipe,
} from "./source-recipes-runtime";

const makePersistence = () =>
  Effect.runPromise(
    createSqlControlPlanePersistence({
      localDataDir: ":memory:",
    }),
  );

const makeRuntimeLocalWorkspaceState = (
  workspaceId: ReturnType<typeof WorkspaceIdSchema.make>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const workspaceRoot = mkdtempSync(
        join(tmpdir(), "executor-source-recipes-runtime-"),
      );
      const context = yield* Effect.tryPromise({
        try: () => resolveLocalWorkspaceContext({ workspaceRoot }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      const loadedConfig = yield* Effect.tryPromise({
        try: () => loadLocalExecutorConfig(context),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      return {
        context,
        installation: {
          workspaceId,
          accountId: AccountIdSchema.make("acc_local_source_recipes"),
          organizationId: "org_local_personal" as never,
        },
        loadedConfig,
      } satisfies RuntimeLocalWorkspaceState;
    }),
  );

const withRuntimeLocalWorkspace = <A, E>(
  effect: Effect.Effect<A, E, never>,
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState,
) =>
  effect.pipe(
    Effect.provideService(RuntimeLocalWorkspaceService, runtimeLocalWorkspace),
  );

const openApiBindingConfigJson = (specUrl: string): string =>
  JSON.stringify({
    adapterKey: "openapi",
    version: 1,
    payload: {
      specUrl,
      defaultHeaders: null,
    },
  });

const graphqlBindingConfigJson = (): string =>
  JSON.stringify({
    adapterKey: "graphql",
    version: 1,
    payload: {
      defaultHeaders: null,
    },
  });

const makeSource = (overrides: Partial<Source> = {}): Source => {
  const kind = overrides.kind ?? "openapi";
  const endpoint = overrides.endpoint
    ?? (kind === "graphql"
      ? "https://example.com/graphql"
      : kind === "mcp"
        ? "https://example.com/mcp"
        : "https://api.github.com");
  const binding =
    overrides.binding
    ?? (kind === "openapi"
      ? {
          specUrl: "https://api.github.com/openapi.json",
          defaultHeaders: null,
        }
      : kind === "graphql"
        ? {
            defaultHeaders: null,
          }
        : kind === "mcp"
          ? {
              transport: null,
              queryParams: null,
              headers: null,
            }
          : {});

  return {
    id: SourceIdSchema.make("src_runtime_recipe"),
    workspaceId: WorkspaceIdSchema.make("ws_runtime_recipe"),
    name: "GitHub",
    kind,
    endpoint,
    status: "connected",
    enabled: true,
    namespace: "github",
    bindingVersion: 1,
    binding,
    importAuthPolicy: "reuse_runtime",
    importAuth: { kind: "none" },
    auth: { kind: "none" },
    sourceHash: null,
    lastError: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
};

const makeOperation = (
  overrides: Partial<StoredSourceRecipeOperationRecord> = {},
): StoredSourceRecipeOperationRecord => ({
  id: "src_recipe_op_runtime",
  recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_runtime"),
  operationKey: "getRepo",
  transportKind: "http",
  toolId: "getRepo",
  title: "Get Repo",
  description: "Read a repository",
  operationKind: "read",
  searchText: "get repo github",
  inputSchemaJson: JSON.stringify({
    type: "object",
    additionalProperties: false,
  }),
  outputSchemaJson: JSON.stringify({
    type: "object",
    properties: {
      full_name: { type: "string" },
    },
  }),
  providerKind: "openapi",
  providerDataJson: JSON.stringify({
    kind: "openapi",
    toolId: "getRepo",
    rawToolId: "repos_getRepo",
    operationId: "repos.getRepo",
    group: "repos",
    leaf: "getRepo",
    tags: ["repos"],
    method: "get",
    path: "/repos/{owner}/{repo}",
    operationHash: "hash",
    invocation: {
      method: "get",
      pathTemplate: "/repos/{owner}/{repo}",
      parameters: [],
      requestBody: null,
    },
  }),
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const makeGraphqlOperation = (
  overrides: Partial<StoredSourceRecipeOperationRecord> = {},
): StoredSourceRecipeOperationRecord => ({
  id: "src_recipe_op_graphql_runtime",
  recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_runtime"),
  operationKey: "viewer",
  transportKind: "graphql",
  toolId: "viewer",
  title: "Viewer",
  description: "Query the current viewer",
  operationKind: "read",
  searchText: "viewer graphql query",
  inputSchemaJson: JSON.stringify({
    type: "object",
    additionalProperties: false,
  }),
  outputSchemaJson: JSON.stringify({
    type: "object",
    properties: {
      login: { type: "string" },
    },
  }),
  providerKind: "graphql",
  providerDataJson: JSON.stringify({
    kind: "graphql",
    toolKind: "field",
    toolId: "viewer",
    rawToolId: "viewer",
    group: "query",
    leaf: "viewer",
    fieldName: "viewer",
    operationType: "query",
    operationName: "viewer",
    operationDocument: "query Viewer { viewer { login } }",
    queryTypeName: "Query",
    mutationTypeName: null,
    subscriptionTypeName: null,
  }),
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const makeMcpOperation = (
  overrides: Partial<StoredSourceRecipeOperationRecord> = {},
): StoredSourceRecipeOperationRecord => ({
  id: "src_recipe_op_mcp_runtime",
  recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_runtime"),
  operationKey: "echo",
  transportKind: "mcp",
  toolId: "echo",
  title: "Echo",
  description: "Echo a value",
  operationKind: "unknown",
  searchText: "echo mcp",
  inputSchemaJson: null,
  outputSchemaJson: null,
  providerKind: "mcp",
  providerDataJson: JSON.stringify({
    kind: "mcp",
    toolId: "echo",
    toolName: "echo",
    description: "Echo a value",
  }),
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const configSourceFromSource = (source: Source): LocalConfigSource => {
  switch (source.kind) {
    case "openapi":
      return {
        kind: "openapi" as const,
        ...(source.name !== source.id ? { name: source.name } : {}),
        ...(source.namespace && source.namespace !== source.id
          ? { namespace: source.namespace }
          : {}),
        ...(source.enabled ? {} : { enabled: false }),
        connection: {
          endpoint: source.endpoint,
        },
        binding: {
          specUrl:
            typeof source.binding.specUrl === "string"
              ? source.binding.specUrl
              : "https://example.com/openapi.json",
          defaultHeaders:
            (source.binding.defaultHeaders as Record<string, string> | null | undefined)
            ?? null,
        },
      };
    case "graphql":
      return {
        kind: "graphql" as const,
        ...(source.name !== source.id ? { name: source.name } : {}),
        ...(source.namespace && source.namespace !== source.id
          ? { namespace: source.namespace }
          : {}),
        ...(source.enabled ? {} : { enabled: false }),
        connection: {
          endpoint: source.endpoint,
        },
        binding: {
          defaultHeaders:
            (source.binding.defaultHeaders as Record<string, string> | null | undefined)
            ?? null,
        },
      };
    case "mcp":
      return {
        kind: "mcp" as const,
        ...(source.name !== source.id ? { name: source.name } : {}),
        ...(source.namespace && source.namespace !== source.id
          ? { namespace: source.namespace }
          : {}),
        ...(source.enabled ? {} : { enabled: false }),
        connection: {
          endpoint: source.endpoint,
        },
        binding: {
          transport:
            (source.binding.transport as "auto" | "streamable-http" | "sse" | null | undefined)
            ?? null,
          queryParams:
            (source.binding.queryParams as Record<string, string> | null | undefined)
            ?? null,
          headers:
            (source.binding.headers as Record<string, string> | null | undefined)
            ?? null,
        },
      };
    default:
      throw new Error(`Unsupported source kind in test fixture: ${source.kind}`);
  }
};

const seedLocalWorkspaceSources = async (input: {
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState;
  fixtures: ReadonlyArray<{
    source: Source;
    materialization: {
      manifestJson: string | null;
      manifestHash: string | null;
      sourceHash: string | null;
      documents: ReadonlyArray<any>;
      schemaBundles: ReadonlyArray<any>;
      operations: ReadonlyArray<StoredSourceRecipeOperationRecord>;
    };
  }>;
}) => {
  await writeProjectLocalExecutorConfig({
    context: input.runtimeLocalWorkspace.context,
    config: {
      sources: Object.fromEntries(
        input.fixtures.map(({ source }) => [source.id, configSourceFromSource(source)]),
      ),
    },
  });

  await Promise.all(
    input.fixtures.map(({ source, materialization }) =>
      writeLocalSourceArtifact({
        context: input.runtimeLocalWorkspace.context,
        sourceId: source.id,
        artifact: buildLocalSourceArtifact({
          source,
          materialization,
        }),
      })),
  );

  await writeLocalWorkspaceState({
    context: input.runtimeLocalWorkspace.context,
    state: {
      version: 1,
      sources: Object.fromEntries(
        input.fixtures.map(({ source }) => [
          source.id,
          {
            status: source.status,
            lastError: source.lastError,
            sourceHash: source.sourceHash,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
          },
        ]),
      ),
      policies: {},
    },
  });
};

describe("source-recipes-runtime", () => {
  describe("recipe tool helpers", () => {
    it("derives tool paths from explicit and implicit namespaces", () => {
      const source = makeSource();
      const operation = makeOperation();

      expect(recipeToolPath({
        source,
        operation,
      })).toBe("github.getRepo");
      expect(recipeToolPath({
        source: makeSource({
          namespace: null,
          name: "My GitHub",
        }),
        operation,
      })).toBe("my.github.getRepo");
      expect(recipeToolPath({
        source: makeSource({
          namespace: "",
        }),
        operation,
      })).toBe("getRepo");
    });

    it("derives search namespaces from path segments and graphql namespaces", () => {
      const openApiSource = makeSource();
      const graphqlSource = makeSource({
        kind: "graphql",
        namespace: "issues",
      });

      expect(recipeToolSearchNamespace({
        source: openApiSource,
        path: "github.getRepo",
        operation: makeOperation(),
      })).toBe("github.getRepo");
      expect(recipeToolSearchNamespace({
        source: openApiSource,
        path: "a.b.c",
        operation: makeOperation(),
      })).toBe("a.b");
      expect(recipeToolSearchNamespace({
        source: graphqlSource,
        path: "ignored.path",
        operation: makeGraphqlOperation(),
      })).toBe("issues");
    });

    it("computes interaction modes and descriptor fields correctly", () => {
      expect(recipeToolDescriptor({
        source: makeSource(),
        operation: makeOperation(),
        path: "github.getRepo",
        includeSchemas: true,
      }).interaction).toBe("auto");

      expect(recipeToolDescriptor({
        source: makeSource(),
        operation: makeOperation({
          operationKind: "delete",
        }),
        path: "github.deleteRepo",
        includeSchemas: true,
      }).interaction).toBe("required");

      expect(recipeToolDescriptor({
        source: makeSource({
          kind: "graphql",
        }),
        operation: makeGraphqlOperation(),
        path: "graphql.viewer",
        includeSchemas: true,
      }).interaction).toBe("auto");

      expect(recipeToolDescriptor({
        source: makeSource({
          kind: "graphql",
        }),
        operation: makeGraphqlOperation({
          operationKind: "write",
        }),
        path: "graphql.createIssue",
        includeSchemas: true,
      }).interaction).toBe("required");

      expect(recipeToolDescriptor({
        source: makeSource({
          kind: "mcp",
          binding: {
            transport: "streamable-http",
            queryParams: null,
            headers: null,
          },
        }),
        operation: makeMcpOperation(),
        path: "mcp.echo",
        includeSchemas: true,
      }).interaction).toBe("auto");

      const descriptor = recipeToolDescriptor({
        source: makeSource(),
        operation: makeOperation({
          description: null,
          title: "Fallback Title",
          providerDataJson: null,
        }),
        path: "github.getRepo",
        includeSchemas: false,
      });

      expect(descriptor.description).toBe("Fallback Title");
      expect(descriptor.inputSchemaJson).toBeUndefined();
      expect(descriptor.outputSchemaJson).toBeUndefined();
      expect(descriptor).not.toHaveProperty("providerDataJson");
    });

    it("expands recipes into lower-cased searchable tools and handles empty operation sets", () => {
      const recipe: LoadedSourceRecipe = {
        source: makeSource({
          name: "GITHUB API",
        }),
        sourceRecord: {
          id: SourceIdSchema.make("src_runtime_recipe"),
          workspaceId: WorkspaceIdSchema.make("ws_runtime_recipe"),
          recipeId: SourceRecipeIdSchema.make("src_recipe_runtime"),
          recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_runtime"),
          name: "GITHUB API",
          kind: "openapi",
          endpoint: "https://api.github.com",
          status: "connected",
          enabled: true,
          namespace: "github",
          importAuthPolicy: "reuse_runtime",
          bindingConfigJson: openApiBindingConfigJson("https://api.github.com/openapi.json"),
          sourceHash: null,
          lastError: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
        revision: {
          id: SourceRecipeRevisionIdSchema.make("src_recipe_rev_runtime"),
          recipeId: SourceRecipeIdSchema.make("src_recipe_runtime"),
          revisionNumber: 1,
          sourceConfigJson: "{}",
          manifestJson: null,
          manifestHash: null,
          materializationHash: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
        documents: [],
        schemaBundles: [],
        operations: [makeOperation({
          searchText: "",
        })],
        manifest: null,
      };

      const expanded = Effect.runSync(
        expandRecipeTools({
          recipes: [recipe],
          includeSchemas: false,
        }),
      );
      expect(expanded).toHaveLength(1);
      expect(expanded[0]?.searchText).toBe(
        "github.getrepo github.getrepo github api github.getrepo getrepo get repo read a repository repos_getrepo repos.getrepo get /repos/{owner}/{repo} repos getrepo repos",
      );

      expect(Effect.runSync(expandRecipeTools({
        recipes: [{
          ...recipe,
          operations: [],
        }],
        includeSchemas: false,
      }))).toEqual([]);
    });
  });

  describe("recipe loading", () => {
    it("loads multiple sources sharing the same recipe revision", async () => {
      const persistence = await makePersistence();
      try {
        const workspaceId = WorkspaceIdSchema.make("ws_shared_revision");
        const runtimeLocalWorkspace =
          await makeRuntimeLocalWorkspaceState(workspaceId);
        const openApiDocument = JSON.stringify({
          openapi: "3.0.3",
          info: {
            title: "GitHub",
            version: "1.0.0",
          },
          paths: {
            "/repos/{owner}/{repo}": {
              get: {
                operationId: "repos.getRepo",
                parameters: [
                  {
                    name: "owner",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                  },
                  {
                    name: "repo",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                  },
                ],
                responses: {
                  200: {
                    description: "ok",
                  },
                },
              },
            },
          },
        });
        const manifest = await Effect.runPromise(extractOpenApiManifest("GitHub", openApiDocument));
        const definition = compileOpenApiToolDefinitions(manifest)[0]!;
        const presentation = buildOpenApiToolPresentation({
          definition,
        });

        await seedLocalWorkspaceSources({
          runtimeLocalWorkspace,
          fixtures: ["GitHub One", "GitHub Two"].map((name, index) => ({
            source: makeSource({
              id: SourceIdSchema.make(`src_shared_revision_${index}`),
              workspaceId,
              name,
              sourceHash: manifest.sourceHash,
              createdAt: 1000 + index,
              updatedAt: 1000 + index,
            }),
            materialization: {
              manifestJson: JSON.stringify(manifest),
              manifestHash: manifest.sourceHash,
              sourceHash: manifest.sourceHash,
              documents: [{
                id: `src_recipe_doc_shared_revision_${index}`,
                recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_materialization"),
                documentKind: "openapi",
                documentKey: "https://api.github.com/openapi.json",
                contentText: openApiDocument,
                contentHash: manifest.sourceHash,
                fetchedAt: 1000,
                createdAt: 1000,
                updatedAt: 1000,
              }],
              schemaBundles: [],
              operations: [makeOperation({
                id: `src_recipe_op_shared_revision_${index}`,
                recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_materialization"),
                operationKey: definition.toolId,
                toolId: definition.toolId,
                title: definition.name,
                description: definition.description,
                searchText: `${definition.toolId} ${definition.name}`.toLowerCase(),
                inputSchemaJson: presentation.inputSchemaJson ?? null,
                outputSchemaJson: presentation.outputSchemaJson ?? null,
                providerDataJson: presentation.providerDataJson,
              })],
            },
          })),
        });

        const recipes = await Effect.runPromise(
          withRuntimeLocalWorkspace(
            loadWorkspaceSourceRecipes({
              rows: persistence.rows,
              workspaceId,
            }),
            runtimeLocalWorkspace,
          ),
        );

        expect(recipes).toHaveLength(2);
        expect(recipes[0]?.documents).toHaveLength(1);
        expect(recipes[0]?.operations).toHaveLength(1);
        expect(recipes[0]?.documents[0]?.contentText).toBe(
          recipes[1]?.documents[0]?.contentText,
        );
        expect(recipes[0]?.operations[0]?.providerDataJson).toBe(
          recipes[1]?.operations[0]?.providerDataJson,
        );
      } finally {
        await persistence.close();
      }
    });

    it("loads sources with empty recipe documents and operations", async () => {
      const persistence = await makePersistence();
      try {
        const workspaceId = WorkspaceIdSchema.make("ws_empty_recipe_rows");
        const sourceId = SourceIdSchema.make("src_empty_recipe_rows");
        const runtimeLocalWorkspace =
          await makeRuntimeLocalWorkspaceState(workspaceId);

        await seedLocalWorkspaceSources({
          runtimeLocalWorkspace,
          fixtures: [{
            source: makeSource({
              id: sourceId,
              workspaceId,
              name: "GraphQL Demo",
              kind: "graphql",
              endpoint: "https://example.com/graphql",
              namespace: "graphql",
              binding: {
                defaultHeaders: null,
              },
            }),
            materialization: {
              manifestJson: null,
              manifestHash: null,
              sourceHash: null,
              documents: [],
              schemaBundles: [],
              operations: [],
            },
          }],
        });

        const recipes = await Effect.runPromise(
          withRuntimeLocalWorkspace(
            loadWorkspaceSourceRecipes({
              rows: persistence.rows,
              workspaceId,
            }),
            runtimeLocalWorkspace,
          ),
        );

        expect(recipes).toHaveLength(1);
        expect(recipes[0]?.documents).toEqual([]);
        expect(recipes[0]?.operations).toEqual([]);
        expect(recipes[0]?.manifest).toBeNull();
      } finally {
        await persistence.close();
      }
    });

    it("fails clearly when loading a missing source, missing revision, or invalid manifest", async () => {
      const persistence = await makePersistence();
      try {
        const missingWorkspaceId = WorkspaceIdSchema.make("ws_missing_source");
        const missingRuntimeLocalWorkspace =
          await makeRuntimeLocalWorkspaceState(missingWorkspaceId);

        await expect(
          Effect.runPromise(
            withRuntimeLocalWorkspace(
              loadSourceWithRecipe({
                rows: persistence.rows,
                workspaceId: missingWorkspaceId,
                sourceId: SourceIdSchema.make("src_missing_source"),
              }),
              missingRuntimeLocalWorkspace,
            ),
          ),
        ).rejects.toThrow("Source not found");

        const workspaceId = WorkspaceIdSchema.make("ws_bad_recipe_runtime");
        const sourceId = SourceIdSchema.make("src_bad_recipe_runtime");
        const runtimeLocalWorkspace =
          await makeRuntimeLocalWorkspaceState(workspaceId);

        await writeProjectLocalExecutorConfig({
          context: runtimeLocalWorkspace.context,
          config: {
            sources: {
              [sourceId]: configSourceFromSource(
                makeSource({
                  id: sourceId,
                  workspaceId,
                  name: "Broken GitHub",
                }),
              ),
            },
          },
        });
        await writeLocalWorkspaceState({
          context: runtimeLocalWorkspace.context,
          state: {
            version: 1,
            sources: {
              [sourceId]: {
                status: "connected",
                lastError: null,
                sourceHash: null,
                createdAt: 1000,
                updatedAt: 1000,
              },
            },
            policies: {},
          },
        });

        await expect(
          Effect.runPromise(
            withRuntimeLocalWorkspace(
              loadSourceWithRecipe({
                rows: persistence.rows,
                workspaceId,
                sourceId,
              }),
              runtimeLocalWorkspace,
            ),
          ),
        ).rejects.toThrow("Recipe artifact missing");

        const invalidManifestSource = makeSource({
          id: sourceId,
          workspaceId,
          name: "Broken GitHub",
        });
        const invalidArtifact = buildLocalSourceArtifact({
          source: invalidManifestSource,
          materialization: {
            manifestJson: "{}",
            manifestHash: "manifest_hash_invalid",
            sourceHash: "manifest_hash_invalid",
            documents: [],
            schemaBundles: [],
            operations: [],
          },
        });
        await writeLocalSourceArtifact({
          context: runtimeLocalWorkspace.context,
          sourceId,
          artifact: {
            ...invalidArtifact,
            revision: {
              ...invalidArtifact.revision,
              manifestJson: "{bad-json",
            },
          },
        });

        await expect(
          Effect.runPromise(
            withRuntimeLocalWorkspace(
              loadSourceWithRecipe({
                rows: persistence.rows,
                workspaceId,
                sourceId,
              }),
              runtimeLocalWorkspace,
            ),
          ),
        ).rejects.toThrow(`Invalid OpenAPI manifest for ${sourceId}`);
      } finally {
        await persistence.close();
      }
    });
  });
});

import { describe, expect, it } from "@effect/vitest";
import {
  AccountIdSchema,
  OrganizationIdSchema,
  SourceIdSchema,
  SourceRecipeIdSchema,
  SourceRecipeRevisionIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import {
  buildSchema,
  getIntrospectionQuery,
  graphqlSync,
} from "graphql";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "./index";
import { runPostMigrationRepairs } from "./post-migrations";

const makePersistence: Effect.Effect<SqlControlPlanePersistence, unknown, Scope.Scope> =
  Effect.acquireRelease(
    createSqlControlPlanePersistence({
      localDataDir: ":memory:",
    }),
    (persistence) =>
      Effect.tryPromise({
        try: () => persistence.close(),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.orDie),
  );

const seedMigratedSourceRecipe = (input: {
  persistence: SqlControlPlanePersistence;
  kind: "openapi" | "graphql";
  workspaceId: ReturnType<typeof WorkspaceIdSchema.make>;
  sourceId: ReturnType<typeof SourceIdSchema.make>;
  documentText: string;
}): Effect.Effect<{
  recipeRevisionId: ReturnType<typeof SourceRecipeRevisionIdSchema.make>;
}, unknown, never> =>
  Effect.gen(function* () {
    const now = Date.now();
    const accountId = AccountIdSchema.make(`acc_${input.sourceId}`);
    const organizationId = OrganizationIdSchema.make(`org_${input.sourceId}`);
    const recipeId = SourceRecipeIdSchema.make(`src_recipe_${input.sourceId}`);
    const recipeRevisionId = SourceRecipeRevisionIdSchema.make(`src_recipe_rev_${input.sourceId}`);

    yield* input.persistence.rows.organizations.insert({
      id: organizationId,
      slug: `org-${input.sourceId}`,
      name: `Org ${input.sourceId}`,
      status: "active",
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.workspaces.insert({
      id: input.workspaceId,
      organizationId,
      name: `Workspace ${input.sourceId}`,
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sourceRecipes.upsert({
      id: recipeId,
      kind: input.kind === "openapi" ? "http_recipe" : "graphql_recipe",
      importerKind: input.kind === "openapi" ? "openapi" : "graphql_introspection",
      providerKey: input.kind === "openapi" ? "generic_http" : "generic_graphql",
      name: input.kind === "openapi" ? "GitHub" : "GraphQL Demo",
      summary: null,
      visibility: "workspace",
      latestRevisionId: recipeRevisionId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sourceRecipeRevisions.upsert({
      id: recipeRevisionId,
      recipeId,
      revisionNumber: 1,
      sourceConfigJson: JSON.stringify(
        input.kind === "openapi"
          ? {
              kind: "openapi",
              endpoint: "https://api.example.com",
              specUrl: "https://api.example.com/openapi.json",
              defaultHeaders: null,
            }
          : {
              kind: "graphql",
              endpoint: "https://api.example.com/graphql",
              defaultHeaders: null,
            },
      ),
      manifestJson: null,
      manifestHash: null,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sources.insert({
      id: input.sourceId,
      workspaceId: input.workspaceId,
      recipeId,
      recipeRevisionId,
      name: input.kind === "openapi" ? "GitHub" : "GraphQL Demo",
      kind: input.kind,
      endpoint:
        input.kind === "openapi"
          ? "https://api.example.com"
          : "https://api.example.com/graphql",
      status: "connected",
      enabled: true,
      namespace: input.kind === "openapi" ? "github" : "graphql",
      transport: null,
      bindingConfigJson: null,
      queryParamsJson: null,
      headersJson: null,
      specUrl: input.kind === "openapi" ? "https://api.example.com/openapi.json" : null,
      defaultHeadersJson: null,
      sourceHash: null,
      sourceDocumentText: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sourceRecipeDocuments.replaceForRevision({
      recipeRevisionId,
      documents: [{
        id: `src_recipe_doc_${input.sourceId}`,
        recipeRevisionId,
        documentKind: input.kind === "openapi" ? "openapi" : "graphql_introspection",
        documentKey:
          input.kind === "openapi"
            ? "https://api.example.com/openapi.json"
            : "https://api.example.com/graphql",
        contentText: input.documentText,
        contentHash: `hash_${input.sourceId}`,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      }],
    });

    return { recipeRevisionId };
  });

describe("post-migrations", () => {
  it.scoped("repairs migrated OpenAPI recipes from stored documents", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_post_migration_openapi");
      const sourceId = SourceIdSchema.make("src_post_migration_openapi");

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
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          full_name: { type: "string" },
                        },
                        required: ["full_name"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const { recipeRevisionId } = yield* seedMigratedSourceRecipe({
        persistence,
        kind: "openapi",
        workspaceId,
        sourceId,
        documentText: openApiDocument,
      });

      yield* runPostMigrationRepairs(persistence.rows);

      const revision = yield* persistence.rows.sourceRecipeRevisions.getById(recipeRevisionId);
      expect(Option.isSome(revision)).toBe(true);
      expect(revision.pipe(Option.getOrNull)?.manifestJson).not.toBeNull();
      expect((yield* persistence.rows.sourceRecipeOperations.listByRevisionId(recipeRevisionId)).length)
        .toBeGreaterThan(0);
    }),
  );

  it.scoped("repairs migrated GraphQL recipes from stored documents", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const workspaceId = WorkspaceIdSchema.make("ws_post_migration_graphql");
      const sourceId = SourceIdSchema.make("src_post_migration_graphql");
      const schema = buildSchema(`
        type Query {
          viewer: User!
        }

        type Mutation {
          createIssue(title: String!): Issue!
        }

        type User {
          login: String!
        }

        type Issue {
          id: ID!
          title: String!
        }
      `);
      const graphqlDocument = JSON.stringify(
        graphqlSync({
          schema,
          source: getIntrospectionQuery(),
        }),
      );

      const { recipeRevisionId } = yield* seedMigratedSourceRecipe({
        persistence,
        kind: "graphql",
        workspaceId,
        sourceId,
        documentText: graphqlDocument,
      });

      yield* runPostMigrationRepairs(persistence.rows);

      const revision = yield* persistence.rows.sourceRecipeRevisions.getById(recipeRevisionId);
      expect(Option.isSome(revision)).toBe(true);
      expect(revision.pipe(Option.getOrNull)?.manifestJson).not.toBeNull();
      expect((yield* persistence.rows.sourceRecipeOperations.listByRevisionId(recipeRevisionId)).length)
        .toBeGreaterThan(0);
    }),
  );
});

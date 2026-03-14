import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import {
  AccountIdSchema,
  type LocalConfigSource,
  SourceIdSchema,
  SourceRecipeRevisionIdSchema,
  SourceRecipeSchemaBundleIdSchema,
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
  getSourceInspection,
  getSourceInspectionSchemaBundle,
  getSourceInspectionToolDetail,
} from "./source-inspection";
import {
  RuntimeLocalWorkspaceService,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import {
  writeLocalWorkspaceState,
} from "./local-workspace-state";
import { ControlPlaneStore } from "./store";

const makePersistence = () =>
  Effect.runPromise(
    createSqlControlPlanePersistence({
      localDataDir: ":memory:",
    }),
  );

const makeRuntimeLocalWorkspaceState = (
  workspaceId: ReturnType<typeof WorkspaceIdSchema.make>,
  accountId: ReturnType<typeof AccountIdSchema.make>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const workspaceRoot = mkdtempSync(
        join(tmpdir(), "executor-source-inspection-"),
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
          accountId,
          organizationId: "org_local_personal" as never,
        },
        loadedConfig,
      } satisfies RuntimeLocalWorkspaceState;
    }),
  );

const makeSource = (input: {
  workspaceId: Source["workspaceId"];
  sourceId: Source["id"];
}): Source => ({
  id: input.sourceId,
  workspaceId: input.workspaceId,
  name: "Cloudflare API",
  kind: "openapi",
  endpoint: "https://api.cloudflare.com/client/v4",
  status: "connected",
  enabled: true,
  namespace: "cloudflare.api",
  bindingVersion: 1,
  binding: {
    specUrl: "https://example.com/openapi.json",
    defaultHeaders: null,
  },
  importAuthPolicy: "reuse_runtime",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: null,
  lastError: null,
  createdAt: 1000,
  updatedAt: 1000,
});

const makeOperation = (
  overrides: Partial<StoredSourceRecipeOperationRecord> = {},
): StoredSourceRecipeOperationRecord => ({
  id: "src_recipe_op_inspection",
  recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_inspection"),
  operationKey: "zones.listZones",
  transportKind: "http",
  toolId: "zones.listZones",
  title: "List zones",
  description: "List Cloudflare zones",
  operationKind: "read",
  searchText: "zones list cloudflare",
  inputSchemaJson: JSON.stringify({
    type: "object",
    properties: {
      page: { type: "number" },
    },
  }),
  outputSchemaJson: JSON.stringify({
    type: "object",
    properties: {
      result: {
        type: "array",
        items: { type: "string" },
      },
    },
  }),
  providerKind: "openapi",
  providerDataJson: JSON.stringify({
    kind: "openapi",
    toolId: "zones.listZones",
    rawToolId: "zones_listZones",
    operationId: "zones.listZones",
    group: "zones",
    leaf: "listZones",
    tags: ["zones"],
    method: "get",
    path: "/zones",
    operationHash: "hash",
    invocation: {
      method: "get",
      pathTemplate: "/zones",
      parameters: [],
      requestBody: null,
    },
  }),
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const configSourceFromSource = (source: Source): LocalConfigSource => ({
  kind: "openapi",
  ...(source.name !== source.id ? { name: source.name } : {}),
  ...(source.namespace && source.namespace !== source.id
    ? { namespace: source.namespace }
    : {}),
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
});

describe("source-inspection", () => {
  it("returns a lightweight inspection bundle and loads rich detail on demand", async () => {
    const persistence = await makePersistence();
    try {
      const workspaceId = WorkspaceIdSchema.make("ws_source_inspection");
      const accountId = AccountIdSchema.make("acc_source_inspection");
      const sourceId = SourceIdSchema.make("src_source_inspection");
      const recipeRevisionId =
        SourceRecipeRevisionIdSchema.make("src_recipe_rev_materialization");
      const runtimeLocalWorkspace = await makeRuntimeLocalWorkspaceState(
        workspaceId,
        accountId,
      );
      const hugeDocument = JSON.stringify({
        openapi: "3.0.3",
        info: {
          title: "Cloudflare API",
          version: "1.0.0",
        },
        paths: Object.fromEntries(
          Array.from({ length: 256 }, (_, index) => [
            `/zones/${index}`,
            {
              get: {
                operationId: `zones.listZones${index}`,
                responses: { 200: { description: "ok" } },
              },
            },
          ]),
        ),
      });

      const source = makeSource({
        workspaceId,
        sourceId,
      });
      await writeProjectLocalExecutorConfig({
        context: runtimeLocalWorkspace.context,
        config: {
          sources: {
            [sourceId]: configSourceFromSource(source),
          },
        },
      });
      await writeLocalSourceArtifact({
        context: runtimeLocalWorkspace.context,
        sourceId,
        artifact: buildLocalSourceArtifact({
          source: {
            ...source,
            sourceHash: "manifest_hash",
          },
          materialization: {
            manifestJson: JSON.stringify({
              sourceHash: "manifest_hash",
            }),
            manifestHash: "manifest_hash",
            sourceHash: "manifest_hash",
            documents: [{
              id: "src_recipe_doc_inspection",
              recipeRevisionId,
              documentKind: "openapi",
              documentKey: "https://example.com/openapi.json",
              contentText: hugeDocument,
              contentHash: "doc_hash",
              fetchedAt: 1000,
              createdAt: 1000,
              updatedAt: 1000,
            }],
            schemaBundles: [{
              id: SourceRecipeSchemaBundleIdSchema.make(
                "src_recipe_bundle_inspection",
              ),
              recipeRevisionId,
              bundleKind: "json_schema_ref_map",
              refsJson: JSON.stringify({
                "#/components/schemas/Pagination": {
                  type: "object",
                  properties: {
                    page: { type: "number" },
                  },
                },
              }),
              contentHash: "bundle_hash",
              createdAt: 1000,
              updatedAt: 1000,
            }],
            operations: [makeOperation({
              recipeRevisionId,
            })],
          },
        }),
      });
      await writeLocalWorkspaceState({
        context: runtimeLocalWorkspace.context,
        state: {
          version: 1,
          sources: {
            [sourceId]: {
              status: "connected",
              lastError: null,
              sourceHash: "manifest_hash",
              createdAt: 1000,
              updatedAt: 1000,
            },
          },
          policies: {},
        },
      });

      const inspection = await Effect.runPromise(
        getSourceInspection({
          workspaceId,
          sourceId,
        }).pipe(
          Effect.provideService(ControlPlaneStore, persistence.rows),
          Effect.provideService(
            RuntimeLocalWorkspaceService,
            runtimeLocalWorkspace,
          ),
        ),
      );

      expect(inspection.toolCount).toBe(1);
      expect(inspection.tools[0]?.path).toBe("cloudflare.api.zones.listZones");
      expect("manifestJson" in inspection).toBe(false);
      expect("rawDocumentText" in inspection).toBe(false);
      expect("definitionsJson" in inspection).toBe(false);

      const detail = await Effect.runPromise(
        getSourceInspectionToolDetail({
          workspaceId,
          sourceId,
          toolPath: "cloudflare.api.zones.listZones",
        }).pipe(
          Effect.provideService(ControlPlaneStore, persistence.rows),
          Effect.provideService(
            RuntimeLocalWorkspaceService,
            runtimeLocalWorkspace,
          ),
        ),
      );

      expect(detail.summary.method).toBe("get");
      expect(detail.summary.inputType).toContain("page");
      expect(detail.summary.outputType).toContain("result");
      expect(detail.providerDataJson).toContain("/zones");
      expect(detail.inputSchemaJson).toContain("\"page\"");
      expect(detail.outputSchemaJson).toContain("\"result\"");
      expect(detail.schemaBundleId).toBe("src_recipe_bundle_inspection");

      const schemaBundle = await Effect.runPromise(
        getSourceInspectionSchemaBundle({
          workspaceId,
          sourceId,
          schemaBundleId: "src_recipe_bundle_inspection",
        }).pipe(
          Effect.provideService(ControlPlaneStore, persistence.rows),
          Effect.provideService(
            RuntimeLocalWorkspaceService,
            runtimeLocalWorkspace,
          ),
        ),
      );

      expect(schemaBundle.kind).toBe("json_schema_ref_map");
      expect(schemaBundle.refsJson).toContain("Pagination");
    } finally {
      await persistence.close();
    }
  });
});

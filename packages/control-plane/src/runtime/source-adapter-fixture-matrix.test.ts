import { readFileSync } from "node:fs";

import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  extractOpenApiManifest,
  type OpenApiJsonObject,
} from "@executor/codemode-openapi";
import {
  buildGoogleDiscoveryToolPresentation,
  compileGoogleDiscoveryToolDefinitions,
  extractGoogleDiscoveryManifest,
} from "@executor/codemode-google-discovery";
import { describe, expect, it } from "@effect/vitest";

import type {
  Source,
  StoredSourceCatalogRevisionRecord,
  StoredSourceRecord,
} from "#schema";
import {
  SourceCatalogIdSchema,
  SourceCatalogRevisionIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";

import { projectCatalogForAgentSdk } from "../ir/catalog";
import type { CatalogSnapshotV1 } from "../ir/model";
import { createCatalogTypeProjector, projectedCatalogTypeRoots } from "./catalog-typescript";
import {
  buildGraphqlToolPresentation,
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
} from "./graphql-tools";
import {
  expandCatalogToolByPath,
  type LoadedSourceCatalog,
} from "./source-catalog-runtime";
import {
  createGoogleDiscoveryCatalogSnapshot,
  createGraphqlCatalogSnapshot,
  createOpenApiCatalogSnapshot,
} from "./source-catalog-snapshot";

const FIXTURE_WORKSPACE_ID = WorkspaceIdSchema.make("ws_source_fixture_matrix");

const readFixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const makeSource = (input: {
  id: string;
  name: string;
  kind: Source["kind"];
  endpoint: string;
  namespace: string;
  binding: Source["binding"];
}): Source => ({
  id: SourceIdSchema.make(input.id),
  workspaceId: FIXTURE_WORKSPACE_ID,
  name: input.name,
  kind: input.kind,
  endpoint: input.endpoint,
  status: "connected",
  enabled: true,
  namespace: input.namespace,
  bindingVersion: 1,
  binding: input.binding,
  importAuthPolicy: "none",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: `hash_${input.id}`,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
});

const makeLoadedCatalog = (input: {
  source: Source;
  snapshot: CatalogSnapshotV1;
}): LoadedSourceCatalog => {
  const catalogId = SourceCatalogIdSchema.make(`catalog_${input.source.id}`);
  const revisionId = SourceCatalogRevisionIdSchema.make(
    `catalog_revision_${input.source.id}`,
  );
  const sourceRecord = {
    id: input.source.id,
    workspaceId: input.source.workspaceId,
    catalogId,
    catalogRevisionId: revisionId,
    name: input.source.name,
    kind: input.source.kind,
    endpoint: input.source.endpoint,
    status: input.source.status,
    enabled: input.source.enabled,
    namespace: input.source.namespace,
    importAuthPolicy: input.source.importAuthPolicy,
    bindingConfigJson: JSON.stringify(input.source.binding),
    sourceHash: input.source.sourceHash,
    lastError: input.source.lastError,
    createdAt: input.source.createdAt,
    updatedAt: input.source.updatedAt,
  } satisfies StoredSourceRecord;
  const revision = {
    id: revisionId,
    catalogId,
    revisionNumber: 1,
    sourceConfigJson: JSON.stringify({
      kind: input.source.kind,
      endpoint: input.source.endpoint,
      binding: input.source.binding,
    }),
    importMetadataJson: JSON.stringify(input.snapshot.import),
    importMetadataHash: "hash_import",
    snapshotHash: "hash_snapshot",
    createdAt: 1,
    updatedAt: 1,
  } satisfies StoredSourceCatalogRevisionRecord;
  const projected = projectCatalogForAgentSdk({
    catalog: input.snapshot.catalog,
  });

  return {
    source: input.source,
    sourceRecord,
    revision,
    snapshot: input.snapshot,
    catalog: input.snapshot.catalog,
    projected,
    typeProjector: createCatalogTypeProjector({
      catalog: projected.catalog,
      roots: projectedCatalogTypeRoots(projected),
    }),
    importMetadata: input.snapshot.import,
  };
};

const unresolvedDiagnosticsForPrefix = (
  snapshot: CatalogSnapshotV1,
  prefix: string,
) =>
  Object.values(snapshot.catalog.diagnostics).filter(
    (diagnostic) =>
      diagnostic.code === "unresolved_ref"
      && diagnostic.provenance.some((entry) =>
        entry.pointer?.startsWith(prefix),
      ),
  );

const openApiSnapshotFromFixture = (input: {
  source: Source;
  specText: string;
  documentKey: string;
}) =>
  Effect.gen(function* () {
    const spec = JSON.parse(input.specText) as OpenApiJsonObject;
    const manifest = yield* extractOpenApiManifest(input.source.name, spec);
    const definitions = compileOpenApiToolDefinitions(manifest);

    const snapshot = createOpenApiCatalogSnapshot({
      source: input.source,
      documents: [{
        documentKind: "openapi",
        documentKey: input.documentKey,
        contentText: input.specText,
        fetchedAt: 1,
      }],
      operations: definitions.map((definition) => {
        const presentation = buildOpenApiToolPresentation({
          definition,
          refHintTable: manifest.refHintTable,
        });
        const method = definition.method.toUpperCase();

        return {
          toolId: definition.toolId,
          title: definition.name,
          description: definition.description,
          effect:
            method === "GET" || method === "HEAD"
              ? "read"
              : method === "DELETE"
                ? "delete"
                : "write",
          inputSchema: presentation.inputSchema,
          outputSchema: presentation.outputSchema,
          providerData: presentation.providerData,
        };
      }),
    });

    return {
      manifest,
      snapshot,
    };
  });

const googleDiscoverySnapshotFromFixture = (input: {
  source: Source;
  documentText: string;
  documentKey: string;
}) =>
  Effect.gen(function* () {
    const manifest = yield* extractGoogleDiscoveryManifest(
      input.source.name,
      input.documentText,
    );
    const definitions = compileGoogleDiscoveryToolDefinitions(manifest);

    const snapshot = createGoogleDiscoveryCatalogSnapshot({
      source: input.source,
      documents: [{
        documentKind: "google_discovery",
        documentKey: input.documentKey,
        contentText: input.documentText,
        fetchedAt: 1,
      }],
      operations: definitions.map((definition) => {
        const presentation = buildGoogleDiscoveryToolPresentation({
          manifest,
          definition,
        });

        return {
          toolId: definition.toolId,
          title: definition.name,
          description: definition.description,
          effect:
            definition.method === "get" || definition.method === "head"
              ? "read"
              : definition.method === "delete"
                ? "delete"
                : "write",
          inputSchema: presentation.inputSchema,
          outputSchema: presentation.outputSchema,
          providerData: presentation.providerData,
        };
      }),
    });

    return {
      manifest,
      snapshot,
    };
  });

const graphqlSnapshotFromFixture = (input: {
  source: Source;
  documentText: string;
}) =>
  Effect.gen(function* () {
    const manifest = yield* extractGraphqlManifest(
      input.source.name,
      input.documentText,
    );
    const definitions = compileGraphqlToolDefinitions(manifest);

    const snapshot = createGraphqlCatalogSnapshot({
      source: input.source,
      documents: [{
        documentKind: "graphql_introspection",
        documentKey: input.source.endpoint,
        contentText: input.documentText,
        fetchedAt: 1,
      }],
      operations: definitions.map((definition) => {
        const presentation = buildGraphqlToolPresentation({
          manifest,
          definition,
        });

        return {
          toolId: definition.toolId,
          title: definition.name,
          description: definition.description,
          effect: definition.operationType === "query" ? "read" : "write",
          inputSchema: presentation.inputSchema,
          outputSchema: presentation.outputSchema,
          providerData: presentation.providerData,
        };
      }),
    });

    return {
      manifest,
      snapshot,
    };
  });

describe("source adapter fixture matrix", () => {
  it.effect(
    "imports the raw recorded Vercel OpenAPI spec into IR and discover projections",
    () =>
      Effect.gen(function* () {
        const specText = readFixture("vercel-openapi.json");
        const source = makeSource({
          id: "src_vercel_fixture",
          name: "Vercel",
          kind: "openapi",
          endpoint: "https://api.vercel.com",
          namespace: "vercel",
          binding: {
            specUrl: "https://openapi.vercel.sh/",
            defaultHeaders: null,
          },
        });
        const { manifest, snapshot } = yield* openApiSnapshotFromFixture({
          source,
          specText,
          documentKey: "https://openapi.vercel.sh/",
        });
        const tool = yield* expandCatalogToolByPath({
          catalogs: [makeLoadedCatalog({ source, snapshot })],
          path: "vercel.projects.addProjectDomain",
          includeSchemas: true,
        });

        expect(manifest.tools.length).toBeGreaterThan(250);
        expect(Object.keys(snapshot.catalog.capabilities).length).toBeGreaterThan(250);
        expect(tool).toBeDefined();
        expect(tool?.descriptor.previewInputType).not.toContain("unknown");
        expect(tool?.descriptor.previewOutputType).not.toContain("unknown");
        expect(tool?.descriptor.inputSchema).toMatchObject({
          type: "object",
          properties: {
            idOrName: {
              type: "string",
            },
            body: {
              type: "object",
            },
          },
        });
        expect(
          unresolvedDiagnosticsForPrefix(snapshot, "#/openapi/addProjectDomain"),
        ).toEqual([]);
      }),
    120_000,
  );

  it.effect(
    "imports the raw recorded Neon OpenAPI spec into IR with resolved request body schemas",
    () =>
      Effect.gen(function* () {
        const specText = readFixture("neon-openapi.json");
        const source = makeSource({
          id: "src_neon_fixture",
          name: "Neon API",
          kind: "openapi",
          endpoint: "https://console.neon.tech/api/v2",
          namespace: "neon",
          binding: {
            specUrl: "https://neon.com/api_spec/release/v2.json",
            defaultHeaders: null,
          },
        });
        const { manifest, snapshot } = yield* openApiSnapshotFromFixture({
          source,
          specText,
          documentKey: "https://neon.com/api_spec/release/v2.json",
        });
        const tool = yield* expandCatalogToolByPath({
          catalogs: [makeLoadedCatalog({ source, snapshot })],
          path: "neon.apiKey.createApiKey",
          includeSchemas: true,
        });

        expect(manifest.tools.length).toBeGreaterThan(50);
        expect(tool).toBeDefined();
        expect(tool?.descriptor.previewInputType).toContain("key_name");
        expect(tool?.descriptor.inputSchema).toMatchObject({
          type: "object",
          properties: {
            body: {
              type: "object",
              properties: {
                key_name: {
                  type: "string",
                },
              },
              required: ["key_name"],
            },
          },
          required: ["body"],
        });
        expect(tool?.descriptor.outputSchema).toMatchObject({
          type: "object",
          properties: {
            id: {
              type: "integer",
            },
            key: {
              type: "string",
            },
            name: {
              type: "string",
            },
          },
        });
        expect(
          unresolvedDiagnosticsForPrefix(snapshot, "#/openapi/apiKey.createApiKey"),
        ).toEqual([]);
      }),
    120_000,
  );

  it.effect(
    "imports the raw recorded Google Sheets discovery document into IR and discover projections",
    () =>
      Effect.gen(function* () {
        const documentText = readFixture("google-sheets-discovery.json");
        const source = makeSource({
          id: "src_google_sheets_fixture",
          name: "Google Sheets",
          kind: "google_discovery",
          endpoint: "https://sheets.googleapis.com/",
          namespace: "google.sheets",
          binding: {
            service: "sheets",
            version: "v4",
            discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest",
            defaultHeaders: null,
            scopes: [],
          },
        });
        const { manifest, snapshot } = yield* googleDiscoverySnapshotFromFixture({
          source,
          documentText,
          documentKey: "https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest",
        });
        const tool = yield* expandCatalogToolByPath({
          catalogs: [makeLoadedCatalog({ source, snapshot })],
          path: "google.sheets.spreadsheets.sheets.copyTo",
          includeSchemas: true,
        });

        expect(manifest.service).toBe("sheets");
        expect(Object.keys(snapshot.catalog.capabilities).length).toBeGreaterThan(10);
        expect(tool).toBeDefined();
        expect(tool?.descriptor.previewInputType).not.toContain("unknown");
        expect(tool?.descriptor.previewOutputType).not.toContain("unknown");
        expect(tool?.descriptor.inputSchema).toMatchObject({
          type: "object",
          properties: {
            spreadsheetId: {
              type: "string",
            },
            sheetId: {
              type: "integer",
            },
            body: {
              type: "object",
              properties: {
                destinationSpreadsheetId: {
                  type: "string",
                },
              },
            },
          },
        });
        expect(JSON.stringify(tool?.descriptor.outputSchema)).toContain("\"gridProperties\"");
        expect(
          unresolvedDiagnosticsForPrefix(
            snapshot,
            "#/googleDiscovery/spreadsheets.sheets.copyTo",
          ),
        ).toEqual([]);
    }),
    120_000,
  );

  it.effect(
    "projects every raw recorded Google Sheets discovery method into schemas and capabilities",
    () =>
      Effect.gen(function* () {
        const documentText = readFixture("google-sheets-discovery.json");
        const source = makeSource({
          id: "src_google_sheets_coverage",
          name: "Google Sheets",
          kind: "google_discovery",
          endpoint: "https://sheets.googleapis.com/",
          namespace: "google.sheets",
          binding: {
            service: "sheets",
            version: "v4",
            discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest",
            defaultHeaders: null,
            scopes: [],
          },
        });
        const { manifest, snapshot } = yield* googleDiscoverySnapshotFromFixture({
          source,
          documentText,
          documentKey: "https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest",
        });

        const mismatches = compileGoogleDiscoveryToolDefinitions(manifest).flatMap((definition) => {
          const presentation = buildGoogleDiscoveryToolPresentation({
            manifest,
            definition,
          });
          const issues: string[] = [];

          if ((definition.parameters.length > 0 || definition.requestSchemaId) && presentation.inputSchema === undefined) {
            issues.push(`${definition.toolId}: missing input schema`);
          }
          if (definition.responseSchemaId && presentation.outputSchema === undefined) {
            issues.push(`${definition.toolId}: missing output schema`);
          }

          return issues;
        });

        expect(manifest.methods.length).toBeGreaterThan(10);
        expect(Object.keys(snapshot.catalog.capabilities).length).toBe(
          manifest.methods.length,
        );
        expect(mismatches).toEqual([]);
      }),
    120_000,
  );

  it.effect(
    "imports the raw recorded Linear GraphQL introspection dump into IR and resolves nested input refs",
    () =>
      Effect.gen(function* () {
        const documentText = readFixture("linear-introspection.json");
        const source = makeSource({
          id: "src_linear_fixture",
          name: "Linear GraphQL",
          kind: "graphql",
          endpoint: "https://api.linear.app/graphql",
          namespace: "linear",
          binding: {
            defaultHeaders: null,
          },
        });
        const { manifest, snapshot } = yield* graphqlSnapshotFromFixture({
          source,
          documentText,
        });
        const tool = yield* expandCatalogToolByPath({
          catalogs: [makeLoadedCatalog({ source, snapshot })],
          path: "linear.agentActivityCreatePrompt",
          includeSchemas: true,
        });

        expect(manifest.tools.length).toBeGreaterThan(100);
        expect(Object.keys(snapshot.catalog.capabilities).length).toBeGreaterThan(100);
        expect(
          Object.values(snapshot.catalog.diagnostics).filter(
            (diagnostic) => diagnostic.code === "unresolved_ref",
          ),
        ).toEqual([]);
        expect(tool).toBeDefined();
        expect(tool?.descriptor.previewInputType).toContain("args: {");
        expect(tool?.descriptor.previewInputType).toContain("input: {");
        expect(tool?.descriptor.previewOutputType).toContain("data:");
        expect(tool?.descriptor.previewOutputType).not.toContain("unknown[]");
        expect(tool?.descriptor.inputSchema).toMatchObject({
          type: "object",
          required: ["args"],
          properties: {
            args: {
              type: "object",
              required: ["input"],
              properties: {
                input: {
                  type: "object",
                  required: ["agentSessionId", "content"],
                  properties: {
                    agentSessionId: {
                      type: "string",
                    },
                    content: {
                      type: "object",
                      properties: {
                        body: {
                          type: "string",
                        },
                      },
                    },
                    sourceCommentId: {
                      type: "string",
                    },
                  },
                },
                headers: {
                  type: "object",
                },
              },
            },
          },
        });
        expect(
          unresolvedDiagnosticsForPrefix(
            snapshot,
            "#/graphql/agentActivityCreatePrompt",
          ),
        ).toEqual([]);
    }),
    120_000,
  );

  it.effect(
    "projects every raw recorded Linear GraphQL tool into schemas and capabilities",
    () =>
      Effect.gen(function* () {
        const documentText = readFixture("linear-introspection.json");
        const source = makeSource({
          id: "src_linear_coverage",
          name: "Linear GraphQL",
          kind: "graphql",
          endpoint: "https://api.linear.app/graphql",
          namespace: "linear",
          binding: {
            defaultHeaders: null,
          },
        });
        const { manifest, snapshot } = yield* graphqlSnapshotFromFixture({
          source,
          documentText,
        });

        const mismatches = compileGraphqlToolDefinitions(manifest).flatMap((definition) => {
          const presentation = buildGraphqlToolPresentation({
            manifest,
            definition,
          });
          const issues: string[] = [];

          if (definition.operationType && presentation.outputSchema === undefined) {
            issues.push(`${definition.toolId}: missing output schema`);
          }
          if (JSON.stringify(presentation.inputSchema ?? {}).includes("shape_")) {
            issues.push(`${definition.toolId}: leaked internal shape id in input schema`);
          }
          if (JSON.stringify(presentation.outputSchema ?? {}).includes("shape_")) {
            issues.push(`${definition.toolId}: leaked internal shape id in output schema`);
          }

          return issues;
        });

        expect(manifest.tools.length).toBeGreaterThan(100);
        expect(Object.keys(snapshot.catalog.capabilities).length).toBe(
          manifest.tools.length,
        );
        expect(
          Object.values(snapshot.catalog.diagnostics).filter(
            (diagnostic) => diagnostic.code === "unresolved_ref",
          ),
        ).toEqual([]);
        expect(mismatches).toEqual([]);
      }),
    120_000,
  );
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  SourceIdSchema,
  WorkspaceIdSchema,
  type Source,
} from "#schema";

import {
  createCatalogSnapshotV1,
  createEmptyCatalogV1,
} from "../ir/catalog";
import {
  CapabilityIdSchema,
  DocumentIdSchema,
  ExecutableIdSchema,
  ResponseSetIdSchema,
  ScopeIdSchema,
  ShapeSymbolIdSchema,
} from "../ir/ids";
import type { CatalogV1, ProvenanceRef } from "../ir/model";
import { syncWorkspaceSourceTypeDeclarationsNode } from "./source-type-declarations";

const put = <K extends string, V>(record: Record<K, V>, key: K, value: V) => {
  record[key] = value;
};

const docId = DocumentIdSchema.make("doc_graphql");
const baseProvenance = (pointer: string): ProvenanceRef[] => [{
  relation: "declared",
  documentId: docId,
  pointer,
}];

const createSnapshot = (): ReturnType<typeof createCatalogSnapshotV1> => {
  const catalog = createEmptyCatalogV1();
  const scopeId = ScopeIdSchema.make("scope_graphql");
  const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
  const teamFilterShapeId = ShapeSymbolIdSchema.make("shape_team_filter");
  const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
  const resultShapeId = ShapeSymbolIdSchema.make("shape_team_connection");
  const executableId = ExecutableIdSchema.make("exec_graphql_teams");
  const capabilityId = CapabilityIdSchema.make("cap_graphql_teams");
  const responseSetId = ResponseSetIdSchema.make("response_set_graphql_teams");
  const secondExecutableId = ExecutableIdSchema.make("exec_graphql_teams_search");
  const secondCapabilityId = CapabilityIdSchema.make("cap_graphql_teams_search");

  put(catalog.documents as Record<typeof docId, CatalogV1["documents"][typeof docId]>, docId, {
    id: docId,
    kind: "graphql-schema",
    title: "Linear GraphQL",
    fetchedAt: "2026-03-14T00:00:00.000Z",
    rawRef: "memory://linear/graphql",
  });

  put(catalog.scopes as Record<typeof scopeId, CatalogV1["scopes"][typeof scopeId]>, scopeId, {
    id: scopeId,
    kind: "service",
    name: "Linear",
    namespace: "linear",
    synthetic: false,
    provenance: baseProvenance("#"),
  });

  put(catalog.symbols as Record<typeof stringShapeId, CatalogV1["symbols"][typeof stringShapeId]>, stringShapeId, {
    id: stringShapeId,
    kind: "shape",
    title: "String",
    node: {
      type: "scalar",
      scalar: "string",
    },
    synthetic: false,
    provenance: baseProvenance("#/scalar/String"),
  });

  put(catalog.symbols as Record<typeof teamFilterShapeId, CatalogV1["symbols"][typeof teamFilterShapeId]>, teamFilterShapeId, {
    id: teamFilterShapeId,
    kind: "shape",
    title: "TeamFilter",
    node: {
      type: "object",
      fields: {
        name: {
          shapeId: stringShapeId,
        },
      },
      additionalProperties: false,
    },
    synthetic: false,
    provenance: baseProvenance("#/input/TeamFilter"),
  });

  put(catalog.symbols as Record<typeof callShapeId, CatalogV1["symbols"][typeof callShapeId]>, callShapeId, {
    id: callShapeId,
    kind: "shape",
    title: "TeamsArgs",
    node: {
      type: "object",
      fields: {
        filter: {
          shapeId: teamFilterShapeId,
        },
      },
      additionalProperties: false,
    },
    synthetic: false,
    provenance: baseProvenance("#/query/teams/args"),
  });

  put(catalog.symbols as Record<typeof resultShapeId, CatalogV1["symbols"][typeof resultShapeId]>, resultShapeId, {
    id: resultShapeId,
    kind: "shape",
    title: "TeamConnection",
    node: {
      type: "object",
      fields: {
        nodes: {
          shapeId: teamFilterShapeId,
        },
      },
      additionalProperties: false,
    },
    synthetic: false,
    provenance: baseProvenance("#/query/teams/result"),
  });

  put(catalog.responseSets as Record<typeof responseSetId, CatalogV1["responseSets"][typeof responseSetId]>, responseSetId, {
    id: responseSetId,
    variants: [],
    synthetic: false,
    provenance: baseProvenance("#/responses"),
  });

  put(catalog.capabilities as Record<typeof capabilityId, CatalogV1["capabilities"][typeof capabilityId]>, capabilityId, {
    id: capabilityId,
    serviceScopeId: scopeId,
    surface: {
      toolPath: ["linear", "teams"],
      title: "Teams",
      summary: "List teams",
    },
    semantics: {
      effect: "read",
      safe: true,
      idempotent: true,
      destructive: false,
    },
    auth: { kind: "none" },
    interaction: {
      approval: { mayRequire: false },
      elicitation: { mayRequest: false },
      resume: { supported: false },
    },
    executableIds: [executableId],
    preferredExecutableId: executableId,
    synthetic: false,
    provenance: baseProvenance("#/query/teams"),
  });

  put(catalog.executables as Record<typeof executableId, CatalogV1["executables"][typeof executableId]>, executableId, {
    id: executableId,
    protocol: "graphql",
    capabilityId,
    scopeId,
    operationType: "query",
    rootField: "teams",
    argumentShapeId: callShapeId,
    resultShapeId,
    selectionMode: "fixed",
    responseSetId,
    synthetic: false,
    provenance: baseProvenance("#/query/teams"),
  });

  put(catalog.capabilities as Record<typeof secondCapabilityId, CatalogV1["capabilities"][typeof secondCapabilityId]>, secondCapabilityId, {
    id: secondCapabilityId,
    serviceScopeId: scopeId,
    surface: {
      toolPath: ["linear", "teamsSearch"],
      title: "Teams Search",
      summary: "Search teams",
    },
    semantics: {
      effect: "read",
      safe: true,
      idempotent: true,
      destructive: false,
    },
    auth: { kind: "none" },
    interaction: {
      approval: { mayRequire: false },
      elicitation: { mayRequest: false },
      resume: { supported: false },
    },
    executableIds: [secondExecutableId],
    preferredExecutableId: secondExecutableId,
    synthetic: false,
    provenance: baseProvenance("#/query/teamsSearch"),
  });

  put(catalog.executables as Record<typeof secondExecutableId, CatalogV1["executables"][typeof secondExecutableId]>, secondExecutableId, {
    id: secondExecutableId,
    protocol: "graphql",
    capabilityId: secondCapabilityId,
    scopeId,
    operationType: "query",
    rootField: "teamsSearch",
    argumentShapeId: callShapeId,
    resultShapeId,
    selectionMode: "fixed",
    responseSetId,
    synthetic: false,
    provenance: baseProvenance("#/query/teamsSearch"),
  });

  return createCatalogSnapshotV1({
    import: {
      sourceKind: "graphql-schema",
      adapterKey: "graphql",
      importerVersion: "test",
      importedAt: "2026-03-14T00:00:00.000Z",
      sourceConfigHash: "hash_test",
    },
    catalog,
  });
};

const makeSource = (input: {
  id: string;
  enabled?: boolean;
  status?: Source["status"];
}): Source => ({
  id: SourceIdSchema.make(input.id),
  workspaceId: WorkspaceIdSchema.make("ws_test"),
  name: input.id,
  kind: "graphql",
  endpoint: "https://api.linear.app/graphql",
  status: input.status ?? "connected",
  enabled: input.enabled ?? true,
  namespace: "linear",
  bindingVersion: 1,
  binding: {
    defaultHeaders: null,
  },
  importAuthPolicy: "reuse_runtime",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: "hash_test",
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("source-type-declarations", () => {
  it("writes per-source and aggregate declaration files", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-types-"));
    const context = {
      cwd: workspaceRoot,
      workspaceRoot,
      workspaceName: "executor-types",
      configDirectory: join(workspaceRoot, ".executor"),
      projectConfigPath: join(workspaceRoot, ".executor", "executor.jsonc"),
      homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
      artifactsDirectory: join(workspaceRoot, ".executor", "artifacts"),
      stateDirectory: join(workspaceRoot, ".executor", "state"),
    };

    const snapshot = createSnapshot();
    await Effect.runPromise(syncWorkspaceSourceTypeDeclarationsNode({
      context,
      entries: [
        {
          source: makeSource({ id: "src_linear" }),
          snapshot,
        },
        {
          source: makeSource({ id: "src_hidden", enabled: false }),
          snapshot,
        },
      ],
    }));

    const sourceDeclaration = readFileSync(
      join(workspaceRoot, ".executor", "types", "sources", "src_linear.d.ts"),
      "utf8",
    );
    const aggregateDeclaration = readFileSync(
      join(workspaceRoot, ".executor", "types", "index.d.ts"),
      "utf8",
    );

    expect(sourceDeclaration).toContain("export interface SourceTools_src_linear");
    expect(sourceDeclaration).toContain("type TeamConnection = {");
    expect(sourceDeclaration.match(/type TeamFilter =/g)?.length).toBe(1);
    expect(sourceDeclaration.match(/type Teams_call =/g)?.length).toBe(1);
    expect(sourceDeclaration).toContain("linear: {");
    expect(sourceDeclaration).toContain("teams: (args?: Teams_call) => Promise<TeamConnection>;");
    expect(sourceDeclaration).toContain("teamsSearch: (args?: Teams_call) => Promise<TeamConnection>;");
    expect(aggregateDeclaration).toContain('import type { SourceTools_src_linear } from "./sources/src_linear";');
    expect(aggregateDeclaration).not.toContain("src_hidden");
    expect(aggregateDeclaration).toContain("declare global {");
    expect(aggregateDeclaration).toContain("const tools: ExecutorSourceTools;");
  });

  it("removes stale source declarations when the source disappears", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-types-stale-"));
    const context = {
      cwd: workspaceRoot,
      workspaceRoot,
      workspaceName: "executor-types-stale",
      configDirectory: join(workspaceRoot, ".executor"),
      projectConfigPath: join(workspaceRoot, ".executor", "executor.jsonc"),
      homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
      artifactsDirectory: join(workspaceRoot, ".executor", "artifacts"),
      stateDirectory: join(workspaceRoot, ".executor", "state"),
    };

    const snapshot = createSnapshot();
    await Effect.runPromise(syncWorkspaceSourceTypeDeclarationsNode({
      context,
      entries: [{ source: makeSource({ id: "src_linear" }), snapshot }],
    }));
    await Effect.runPromise(syncWorkspaceSourceTypeDeclarationsNode({
      context,
      entries: [],
    }));

    const aggregateDeclaration = readFileSync(
      join(workspaceRoot, ".executor", "types", "index.d.ts"),
      "utf8",
    );

    expect(aggregateDeclaration).toContain("export type ExecutorSourceTools = {};");
    expect(() =>
      readFileSync(
        join(workspaceRoot, ".executor", "types", "sources", "src_linear.d.ts"),
        "utf8",
      )
    ).toThrow();
  });
});

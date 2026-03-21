import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

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

import {
  createCatalogSnapshotV1,
  createEmptyCatalogV1,
  projectCatalogForAgentSdk,
} from "@executor/ir/catalog";
import {
  CapabilityIdSchema,
  DocumentIdSchema,
  ExecutableIdSchema,
  ResourceIdSchema,
  ResponseSetIdSchema,
  ScopeIdSchema,
  ShapeSymbolIdSchema,
} from "@executor/ir/ids";
import type { CatalogV1, ProvenanceRef } from "@executor/ir/model";
import {
  createCatalogTypeProjector,
  formatTypeNameSegment,
  joinTypeNameSegments,
  projectedCatalogTypeRoots,
} from "../catalog-typescript";
import {
  expandCatalogToolByPath,
  expandCatalogTools,
  type LoadedSourceCatalog,
} from "./runtime";

const put = <K extends string, V>(record: Record<K, V>, key: K, value: V) => {
  record[key] = value;
};

const docId = DocumentIdSchema.make("doc_graphql");
const baseProvenance = (pointer: string): ProvenanceRef[] => [{
  relation: "declared",
  documentId: docId,
  pointer,
}];

const createGraphqlCatalog = (): CatalogV1 => {
  const catalog = createEmptyCatalogV1();
  const resourceId = ResourceIdSchema.make("res_graphql");
  const scopeId = ScopeIdSchema.make("scope_graphql");
  const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
  const teamFilterShapeId = ShapeSymbolIdSchema.make("shape_team_filter");
  const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
  const resultShapeId = ShapeSymbolIdSchema.make("shape_team_connection");
  const executableId = ExecutableIdSchema.make("exec_graphql_teams");
  const capabilityId = CapabilityIdSchema.make("cap_graphql_teams");
  const responseSetId = ResponseSetIdSchema.make("response_set_graphql_teams");

  put(catalog.documents as Record<typeof docId, CatalogV1["documents"][typeof docId]>, docId, {
    id: docId,
    kind: "graphql-schema",
    title: "Linear GraphQL",
    fetchedAt: "2026-03-14T00:00:00.000Z",
    rawRef: "memory://linear/graphql",
  });

  put(catalog.resources as Record<typeof resourceId, CatalogV1["resources"][typeof resourceId]>, resourceId, {
    id: resourceId,
    documentId: docId,
    canonicalUri: "https://api.linear.app/graphql",
    baseUri: "https://api.linear.app/graphql",
    anchors: {},
    dynamicAnchors: {},
    synthetic: false,
    provenance: baseProvenance("#"),
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
    resourceId,
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
    resourceId,
    title: "TeamFilter",
    node: {
      type: "object",
      fields: {
        name: {
          shapeId: stringShapeId,
          docs: {
            description: "Filter teams by name.",
          },
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
    resourceId,
    title: "TeamsArgs",
    node: {
      type: "object",
      fields: {
        filter: {
          shapeId: teamFilterShapeId,
          docs: {
            description: "Filter returned teams.",
          },
        },
        after: {
          shapeId: stringShapeId,
          docs: {
            description: "A cursor to be used with first for forward pagination",
          },
        },
        before: {
          shapeId: stringShapeId,
          docs: {
            description: "A cursor to be used with last for backward pagination.",
          },
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
    resourceId,
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
    capabilityId,
    scopeId,
    adapterKey: "graphql",
    bindingVersion: 1,
    binding: {
      kind: "graphql",
      toolKind: "field",
      toolId: "teams",
      rawToolId: "teams",
      group: "query",
      leaf: "teams",
      fieldName: "teams",
      operationType: "query",
      operationName: "TeamsQuery",
      operationDocument: "query TeamsQuery { teams { nodes { id } } }",
      queryTypeName: "Query",
      mutationTypeName: null,
      subscriptionTypeName: null,
    },
    projection: {
      responseSetId,
      callShapeId,
      resultDataShapeId: resultShapeId,
    },
    display: {
      protocol: "graphql",
      method: "query",
      pathTemplate: "teams",
      operationId: "teams",
      group: "query",
      leaf: "teams",
      rawToolId: "teams",
      title: "Teams",
      summary: "List teams",
    },
    synthetic: false,
    provenance: baseProvenance("#/query/teams"),
  });

  return catalog;
};

const createLoadedCatalog = (options?: {
  mutateCatalog?: (catalog: CatalogV1) => void;
}): LoadedSourceCatalog => {
  const catalog = createGraphqlCatalog();
  options?.mutateCatalog?.(catalog);
  const projected = projectCatalogForAgentSdk({
    catalog,
  });
  const snapshot = createCatalogSnapshotV1({
    import: {
      sourceKind: "graphql-schema",
      adapterKey: "graphql",
      importerVersion: "test",
      importedAt: "2026-03-14T00:00:00.000Z",
      sourceConfigHash: "hash_test",
    },
    catalog,
  });

  const source = {
    id: SourceIdSchema.make("src_linear"),
    workspaceId: WorkspaceIdSchema.make("ws_linear"),
    name: "Linear",
    kind: "graphql-schema",
    endpoint: "https://api.linear.app/graphql",
    status: "connected",
    enabled: true,
    namespace: "linear",
    bindingVersion: 1,
    binding: {},
    importAuthPolicy: "reuse_runtime",
    importAuth: { kind: "none" },
    auth: { kind: "none" },
    sourceHash: "hash_test",
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
  } satisfies Source;

  const sourceRecord = {
    id: source.id,
    workspaceId: source.workspaceId,
    catalogId: SourceCatalogIdSchema.make("catalog_linear"),
    catalogRevisionId: SourceCatalogRevisionIdSchema.make("catalog_revision_linear"),
    name: source.name,
    kind: source.kind,
    endpoint: source.endpoint,
    status: source.status,
    enabled: source.enabled,
    namespace: source.namespace,
    importAuthPolicy: source.importAuthPolicy,
    bindingConfigJson: "{}",
    sourceHash: source.sourceHash,
    lastError: source.lastError,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  } satisfies StoredSourceRecord;

  const revision = {
    id: SourceCatalogRevisionIdSchema.make("catalog_revision_linear"),
    catalogId: SourceCatalogIdSchema.make("catalog_linear"),
    revisionNumber: 1,
    sourceConfigJson: "{}",
    importMetadataJson: "{}",
    importMetadataHash: "hash_import",
    snapshotHash: "hash_snapshot",
    createdAt: 0,
    updatedAt: 0,
  } satisfies StoredSourceCatalogRevisionRecord;

  return {
    source,
    sourceRecord,
    revision,
    snapshot,
    catalog,
    projected,
    typeProjector: createCatalogTypeProjector({
      catalog: projected.catalog,
      roots: projectedCatalogTypeRoots(projected),
    }),
    importMetadata: snapshot.import,
  };
};

describe("source-catalog-runtime", () => {
  it("formats declaration aliases as safe PascalCase names", () => {
    expect(formatTypeNameSegment("teams_call")).toBe("TeamsCall");
    expect(formatTypeNameSegment("120 factors 1 member 1")).toBe("T120Factors1Member1");
    expect(joinTypeNameSegments("linear", "teamsSearch", "call")).toBe("LinearTeamsSearchCall");
  });

  it("keeps nominally distinct shapes separate in declaration exports", () => {
    const loadedCatalog = createLoadedCatalog({
      mutateCatalog: (catalog) => {
        const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
        const projectFilterShapeId = ShapeSymbolIdSchema.make("shape_project_filter");
        const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
        const stringShape = catalog.symbols[stringShapeId];
        const callShape = catalog.symbols[callShapeId];
        const resourceId = stringShape?.kind === "shape" ? stringShape.resourceId : undefined;

        if (!callShape || callShape.kind !== "shape" || callShape.node.type !== "object") {
          throw new Error("Expected object call shape in fixture");
        }

        put(catalog.symbols as Record<typeof projectFilterShapeId, CatalogV1["symbols"][typeof projectFilterShapeId]>, projectFilterShapeId, {
          id: projectFilterShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          title: "ProjectFilter",
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
          provenance: baseProvenance("#/input/ProjectFilter"),
        });

        put(catalog.symbols as Record<typeof callShapeId, CatalogV1["symbols"][typeof callShapeId]>, callShapeId, {
          ...callShape,
          node: {
            ...callShape.node,
            fields: {
              ...callShape.node.fields,
              projectFilter: {
                shapeId: projectFilterShapeId,
                docs: {
                  description: "Filter projects by name.",
                },
              },
            },
          },
        });
      },
    });

    const descriptor = Object.values(loadedCatalog.projected.toolDescriptors).find((tool) =>
      tool.toolPath.join(".") === "linear.teams"
    );
    if (!descriptor) {
      throw new Error("Expected linear.teams descriptor in fixture");
    }

    const projector = createCatalogTypeProjector({
      catalog: loadedCatalog.projected.catalog,
      roots: [{
        shapeId: descriptor.callShapeId,
        aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
      }],
    });

    const rootType = projector.renderDeclarationShape(descriptor.callShapeId, {
      aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
    });
    const declarations = projector.supportingDeclarations();
    const declarationText = declarations.join("\n\n");

    expect(rootType).toBe("LinearTeamsCall");
    expect(declarations).toHaveLength(3);
    expect(declarationText).toContain("type LinearTeamsCall = {");
    expect(declarationText).toContain("filter?: TeamFilter;");
    expect(declarationText).toContain("projectFilter?: ProjectFilter;");
    expect(declarationText).toContain("type TeamFilter = {");
    expect(declarationText).toContain("type ProjectFilter = {");
    expect(declarationText).not.toContain("type LinearTeamsCallProjectFilter");
  });

  it("uses provenance names for GraphQL depth variants instead of numeric suffixes", () => {
    const loadedCatalog = createLoadedCatalog({
      mutateCatalog: (catalog) => {
        const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
        const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
        const teamShapeId = ShapeSymbolIdSchema.make("shape_team_output");
        const teamDepthShapeId = ShapeSymbolIdSchema.make(
          "shape_team_output_depth_1",
        );
        const teamRefShapeId = ShapeSymbolIdSchema.make("shape_team_output_ref");
        const teamDepthRefShapeId = ShapeSymbolIdSchema.make(
          "shape_team_output_depth_1_ref",
        );
        const stringShape = catalog.symbols[stringShapeId];
        const callShape = catalog.symbols[callShapeId];
        const resourceId =
          stringShape?.kind === "shape" ? stringShape.resourceId : undefined;

        if (!callShape || callShape.kind !== "shape" || callShape.node.type !== "object") {
          throw new Error("Expected object call shape in fixture");
        }

        put(catalog.symbols as Record<typeof teamShapeId, CatalogV1["symbols"][typeof teamShapeId]>, teamShapeId, {
          id: teamShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "object",
            fields: {
              __typename: {
                shapeId: stringShapeId,
              },
            },
            required: ["__typename"],
            additionalProperties: false,
          },
          synthetic: false,
          provenance: baseProvenance("#/$defs/graphql/output/Team"),
        });

        put(catalog.symbols as Record<typeof teamDepthShapeId, CatalogV1["symbols"][typeof teamDepthShapeId]>, teamDepthShapeId, {
          id: teamDepthShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "object",
            fields: {
              __typename: {
                shapeId: stringShapeId,
              },
              name: {
                shapeId: stringShapeId,
              },
            },
            required: ["__typename", "name"],
            additionalProperties: false,
          },
          synthetic: false,
          provenance: baseProvenance("#/$defs/graphql/output/Team__depth1"),
        });

        put(catalog.symbols as Record<typeof teamRefShapeId, CatalogV1["symbols"][typeof teamRefShapeId]>, teamRefShapeId, {
          id: teamRefShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "ref",
            target: teamShapeId,
          },
          synthetic: false,
          provenance: baseProvenance("#/query/teams/args/properties/team"),
        });

        put(catalog.symbols as Record<typeof teamDepthRefShapeId, CatalogV1["symbols"][typeof teamDepthRefShapeId]>, teamDepthRefShapeId, {
          id: teamDepthRefShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "ref",
            target: teamDepthShapeId,
          },
          synthetic: false,
          provenance: baseProvenance("#/query/teams/args/properties/teamDepth"),
        });

        put(catalog.symbols as Record<typeof callShapeId, CatalogV1["symbols"][typeof callShapeId]>, callShapeId, {
          ...callShape,
          node: {
            ...callShape.node,
            fields: {
              ...callShape.node.fields,
              team: {
                shapeId: teamRefShapeId,
              },
              teamDepth: {
                shapeId: teamDepthRefShapeId,
              },
            },
          },
        });
      },
    });

    const descriptor = Object.values(loadedCatalog.projected.toolDescriptors).find((tool) =>
      tool.toolPath.join(".") === "linear.teams"
    );
    if (!descriptor) {
      throw new Error("Expected linear.teams descriptor in fixture");
    }

    const projector = createCatalogTypeProjector({
      catalog: loadedCatalog.projected.catalog,
      roots: [{
        shapeId: descriptor.callShapeId,
        aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
      }],
    });

    projector.renderDeclarationShape(descriptor.callShapeId, {
      aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
    });
    const declarationText = projector.supportingDeclarations().join("\n\n");

    expect(declarationText).toContain("team?: Team;");
    expect(declarationText).toContain("teamDepth?: TeamDepth1;");
    expect(declarationText).toContain("type Team = {");
    expect(declarationText).toContain("type TeamDepth1 = {");
    expect(declarationText).not.toContain("type Team_2 = {");
  });

  it("keeps recursive JSON-like wrappers inline without numeric helper aliases", () => {
    const catalog = createEmptyCatalogV1();
    const resourceId = ResourceIdSchema.make("res_json");
    const stringShapeId = ShapeSymbolIdSchema.make("shape_json_string");
    const numberShapeId = ShapeSymbolIdSchema.make("shape_json_number");
    const booleanShapeId = ShapeSymbolIdSchema.make("shape_json_boolean");
    const arrayShapeId = ShapeSymbolIdSchema.make("shape_json_array");
    const objectShapeId = ShapeSymbolIdSchema.make("shape_json_object");
    const rootShapeId = ShapeSymbolIdSchema.make("shape_json_value");

    put(catalog.documents as Record<typeof docId, CatalogV1["documents"][typeof docId]>, docId, {
      id: docId,
      kind: "graphql-schema",
      title: "Json Test",
      fetchedAt: "2026-03-20T00:00:00.000Z",
      rawRef: "memory://json-test",
    });
    put(catalog.resources as Record<typeof resourceId, CatalogV1["resources"][typeof resourceId]>, resourceId, {
      id: resourceId,
      documentId: docId,
      canonicalUri: "memory://json-test",
      baseUri: "memory://json-test",
      anchors: {},
      dynamicAnchors: {},
      synthetic: false,
      provenance: baseProvenance("#"),
    });

    put(catalog.symbols as Record<typeof stringShapeId, CatalogV1["symbols"][typeof stringShapeId]>, stringShapeId, {
      id: stringShapeId,
      kind: "shape",
      resourceId,
      node: { type: "scalar", scalar: "string" },
      synthetic: false,
      provenance: baseProvenance("#/string"),
    });
    put(catalog.symbols as Record<typeof numberShapeId, CatalogV1["symbols"][typeof numberShapeId]>, numberShapeId, {
      id: numberShapeId,
      kind: "shape",
      resourceId,
      node: { type: "scalar", scalar: "number" },
      synthetic: false,
      provenance: baseProvenance("#/number"),
    });
    put(catalog.symbols as Record<typeof booleanShapeId, CatalogV1["symbols"][typeof booleanShapeId]>, booleanShapeId, {
      id: booleanShapeId,
      kind: "shape",
      resourceId,
      node: { type: "scalar", scalar: "boolean" },
      synthetic: false,
      provenance: baseProvenance("#/boolean"),
    });
    put(catalog.symbols as Record<typeof arrayShapeId, CatalogV1["symbols"][typeof arrayShapeId]>, arrayShapeId, {
      id: arrayShapeId,
      kind: "shape",
      resourceId,
      node: {
        type: "array",
        itemShapeId: rootShapeId,
      },
      synthetic: false,
      provenance: baseProvenance("#/array"),
    });
    put(catalog.symbols as Record<typeof objectShapeId, CatalogV1["symbols"][typeof objectShapeId]>, objectShapeId, {
      id: objectShapeId,
      kind: "shape",
      resourceId,
      node: {
        type: "object",
        fields: {},
        required: [],
        additionalProperties: rootShapeId,
      },
      synthetic: false,
      provenance: baseProvenance("#/object"),
    });
    put(catalog.symbols as Record<typeof rootShapeId, CatalogV1["symbols"][typeof rootShapeId]>, rootShapeId, {
      id: rootShapeId,
      kind: "shape",
      resourceId,
      title: "JsonValue",
      node: {
        type: "oneOf",
        items: [
          stringShapeId,
          numberShapeId,
          booleanShapeId,
          arrayShapeId,
          objectShapeId,
        ],
      },
      synthetic: false,
      provenance: baseProvenance("#/jsonValue"),
    });

    const projector = createCatalogTypeProjector({
      catalog,
      roots: [{
        shapeId: rootShapeId,
        aliasHint: "JsonValue",
      }],
    });

    const rootType = projector.renderDeclarationShape(rootShapeId, {
      aliasHint: "JsonValue",
    });
    const declarationText = projector.supportingDeclarations().join("\n\n");

    expect(rootType).toBe("JsonValue");
    expect(declarationText).toContain("type JsonValue =");
    expect(declarationText).toContain("Array<JsonValue>");
    expect(declarationText).toContain("[key: string]: JsonValue;");
    expect(declarationText).not.toContain("type JsonValue_2");
    expect(declarationText).not.toContain("type JsonValue_3");
  });

  it("uses provenance names before numeric suffixes for duplicate titled ref targets", () => {
    const loadedCatalog = createLoadedCatalog({
      mutateCatalog: (catalog) => {
        const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
        const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
        const accessCentrifyShapeId = ShapeSymbolIdSchema.make("shape_access_centrify");
        const accessSchemasCentrifyShapeId = ShapeSymbolIdSchema.make("shape_access_schemas_centrify");
        const accessCentrifyRefShapeId = ShapeSymbolIdSchema.make("shape_access_centrify_ref");
        const accessSchemasCentrifyRefShapeId = ShapeSymbolIdSchema.make("shape_access_schemas_centrify_ref");
        const stringShape = catalog.symbols[stringShapeId];
        const callShape = catalog.symbols[callShapeId];
        const resourceId =
          stringShape?.kind === "shape" ? stringShape.resourceId : undefined;

        if (!callShape || callShape.kind !== "shape" || callShape.node.type !== "object") {
          throw new Error("Expected object call shape in fixture");
        }

        for (const [shapeId, pointer] of [
          [accessCentrifyShapeId, "#/components/schemas/access_centrify"],
          [accessSchemasCentrifyShapeId, "#/components/schemas/access_schemas-centrify"],
        ] as const) {
          put(catalog.symbols as Record<typeof shapeId, CatalogV1["symbols"][typeof shapeId]>, shapeId, {
            id: shapeId,
            kind: "shape",
            ...(resourceId ? { resourceId } : {}),
            title: "Centrify",
            node: {
              type: "object",
              fields: {
                name: {
                  shapeId: stringShapeId,
                },
              },
              required: ["name"],
              additionalProperties: false,
            },
            synthetic: false,
            provenance: baseProvenance(pointer),
          });
        }

        put(catalog.symbols as Record<typeof accessCentrifyRefShapeId, CatalogV1["symbols"][typeof accessCentrifyRefShapeId]>, accessCentrifyRefShapeId, {
          id: accessCentrifyRefShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "ref",
            target: accessCentrifyShapeId,
          },
          synthetic: false,
          provenance: baseProvenance("#/query/teams/args/properties/primaryIdp"),
        });
        put(catalog.symbols as Record<typeof accessSchemasCentrifyRefShapeId, CatalogV1["symbols"][typeof accessSchemasCentrifyRefShapeId]>, accessSchemasCentrifyRefShapeId, {
          id: accessSchemasCentrifyRefShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "ref",
            target: accessSchemasCentrifyShapeId,
          },
          synthetic: false,
          provenance: baseProvenance("#/query/teams/args/properties/secondaryIdp"),
        });

        put(catalog.symbols as Record<typeof callShapeId, CatalogV1["symbols"][typeof callShapeId]>, callShapeId, {
          ...callShape,
          node: {
            ...callShape.node,
            fields: {
              ...callShape.node.fields,
              primaryIdp: {
                shapeId: accessCentrifyRefShapeId,
              },
              secondaryIdp: {
                shapeId: accessSchemasCentrifyRefShapeId,
              },
            },
          },
        });
      },
    });

    const descriptor = Object.values(loadedCatalog.projected.toolDescriptors).find((tool) =>
      tool.toolPath.join(".") === "linear.teams"
    );
    if (!descriptor) {
      throw new Error("Expected linear.teams descriptor in fixture");
    }

    const projector = createCatalogTypeProjector({
      catalog: loadedCatalog.projected.catalog,
      roots: [{
        shapeId: descriptor.callShapeId,
        aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
      }],
    });

    projector.renderDeclarationShape(descriptor.callShapeId, {
      aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
    });
    const declarationText = projector.supportingDeclarations().join("\n\n");

    expect(declarationText).toContain("primaryIdp?: AccessCentrify;");
    expect(declarationText).toContain("secondaryIdp?: AccessSchemasCentrify;");
    expect(declarationText).toContain("type AccessCentrify = {");
    expect(declarationText).toContain("type AccessSchemasCentrify = {");
    expect(declarationText).not.toContain("type Centrify_2 = {");
  });

  it("renders shared GraphQL typename-only refs through normal aliasing", () => {
    const loadedCatalog = createLoadedCatalog({
      mutateCatalog: (catalog) => {
        const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
        const callShapeId = ShapeSymbolIdSchema.make("shape_team_query_args");
        const teamDepthShapeId = ShapeSymbolIdSchema.make("shape_team_output_depth_2");
        const teamDepthRefShapeId = ShapeSymbolIdSchema.make(
          "shape_team_output_depth_2_ref",
        );
        const stringShape = catalog.symbols[stringShapeId];
        const callShape = catalog.symbols[callShapeId];
        const resourceId =
          stringShape?.kind === "shape" ? stringShape.resourceId : undefined;

        if (!callShape || callShape.kind !== "shape" || callShape.node.type !== "object") {
          throw new Error("Expected object call shape in fixture");
        }

        put(catalog.symbols as Record<typeof teamDepthShapeId, CatalogV1["symbols"][typeof teamDepthShapeId]>, teamDepthShapeId, {
          id: teamDepthShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "object",
            fields: {
              __typename: {
                shapeId: stringShapeId,
              },
            },
            required: ["__typename"],
            additionalProperties: false,
          },
          synthetic: false,
          provenance: baseProvenance("#/$defs/graphql/output/GraphqlTypenameOnly"),
        });

        put(catalog.symbols as Record<typeof teamDepthRefShapeId, CatalogV1["symbols"][typeof teamDepthRefShapeId]>, teamDepthRefShapeId, {
          id: teamDepthRefShapeId,
          kind: "shape",
          ...(resourceId ? { resourceId } : {}),
          node: {
            type: "ref",
            target: teamDepthShapeId,
          },
          synthetic: false,
          provenance: baseProvenance("#/query/teams/args/properties/teamDepthTwo"),
        });

        put(catalog.symbols as Record<typeof callShapeId, CatalogV1["symbols"][typeof callShapeId]>, callShapeId, {
          ...callShape,
          node: {
            ...callShape.node,
            fields: {
              ...callShape.node.fields,
              teamDepthTwo: {
                shapeId: teamDepthRefShapeId,
              },
            },
          },
        });
      },
    });

    const descriptor = Object.values(loadedCatalog.projected.toolDescriptors).find((tool) =>
      tool.toolPath.join(".") === "linear.teams"
    );
    if (!descriptor) {
      throw new Error("Expected linear.teams descriptor in fixture");
    }

    const projector = createCatalogTypeProjector({
      catalog: loadedCatalog.projected.catalog,
      roots: [{
        shapeId: descriptor.callShapeId,
        aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
      }],
    });

    projector.renderDeclarationShape(descriptor.callShapeId, {
      aliasHint: joinTypeNameSegments(...descriptor.toolPath, "call"),
    });
    const declarationText = projector.supportingDeclarations().join("\n\n");

    expect(declarationText).toContain("type GraphqlTypenameOnly = {");
    expect(declarationText).toContain("__typename: string;");
    expect(declarationText).toContain("teamDepthTwo?: GraphqlTypenameOnly;");
    expect(declarationText).not.toContain("type TeamDepth2 = {");
  });

  it.effect("projects friendly schemas for discover and inspection consumers", () =>
    Effect.gen(function* () {
      const [tool] = yield* expandCatalogTools({
        catalogs: [createLoadedCatalog()],
        includeSchemas: true,
      });

      expect(tool).toBeDefined();
      expect(tool?.descriptor.contract?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          filter: {
            title: "TeamFilter",
          },
          after: {
            type: "string",
          },
          before: {
            type: "string",
          },
        },
      });

      const serializedInput = JSON.stringify(tool?.descriptor.contract?.inputSchema);
      expect(serializedInput).not.toContain("\"$ref\":\"#/$defs/shape_");
      expect(serializedInput).not.toContain("\"shape_");
      expect(tool?.descriptor.contract?.inputTypePreview).toContain("filter?: {");
      expect(tool?.descriptor.contract?.outputTypePreview).toContain("nodes?: {");
    }));

  it.effect("can skip type previews when only list metadata is needed", () =>
    Effect.gen(function* () {
      const [tool] = yield* expandCatalogTools({
        catalogs: [createLoadedCatalog()],
        includeSchemas: false,
        includeTypePreviews: false,
      });

      expect(tool).toBeDefined();
      expect(tool?.descriptor.contract?.inputSchema).toBeUndefined();
      expect(tool?.descriptor.contract?.outputSchema).toBeUndefined();
      expect(tool?.descriptor.contract?.inputTypePreview).toBeUndefined();
      expect(tool?.descriptor.contract?.outputTypePreview).toBeUndefined();
    }));

  it.effect("projects a single tool by path without expanding the whole catalog", () =>
    Effect.gen(function* () {
      const tool = yield* expandCatalogToolByPath({
        catalogs: [createLoadedCatalog()],
        path: "linear.teams",
        includeSchemas: true,
      });

      expect(tool).not.toBeNull();
      expect(tool?.path).toBe("linear.teams");
      expect(tool?.descriptor.contract?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          filter: {
            title: "TeamFilter",
          },
        },
      });
    }));

  it.effect("normalizes object unions into discriminated unions with shared fields", () =>
    Effect.gen(function* () {
      const tool = yield* expandCatalogToolByPath({
        catalogs: [createLoadedCatalog({
          mutateCatalog: (catalog) => {
            const stringShapeId = ShapeSymbolIdSchema.make("shape_string");
            const numberShapeId = ShapeSymbolIdSchema.make("shape_number");
            const blockedActionShapeId = ShapeSymbolIdSchema.make("shape_action_blocked");
            const unblockedActionShapeId = ShapeSymbolIdSchema.make("shape_action_unblocked");
            const routeBlockedActionShapeId = ShapeSymbolIdSchema.make("shape_action_route_blocked");
            const routeShapeId = ShapeSymbolIdSchema.make("shape_route");
            const blockedShapeId = ShapeSymbolIdSchema.make("shape_abuse_blocked");
            const unblockedShapeId = ShapeSymbolIdSchema.make("shape_abuse_unblocked");
            const routeBlockedShapeId = ShapeSymbolIdSchema.make("shape_abuse_route_blocked");
            const unionShapeId = ShapeSymbolIdSchema.make("shape_abuse_union");
            const executable = Object.values(catalog.executables)[0]!;
            const resourceId = catalog.symbols[stringShapeId]?.kind === "shape"
              ? catalog.symbols[stringShapeId].resourceId
              : undefined;

            put(catalog.symbols as Record<typeof numberShapeId, CatalogV1["symbols"][typeof numberShapeId]>, numberShapeId, {
              id: numberShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "Number",
              node: {
                type: "scalar",
                scalar: "number",
              },
              synthetic: false,
              provenance: baseProvenance("#/scalar/Number"),
            });

            for (const [shapeId, action] of [
              [blockedActionShapeId, "blocked"],
              [unblockedActionShapeId, "unblocked"],
              [routeBlockedActionShapeId, "route-blocked"],
            ] as const) {
              put(catalog.symbols as Record<typeof shapeId, CatalogV1["symbols"][typeof shapeId]>, shapeId, {
                id: shapeId,
                kind: "shape",
                ...(resourceId ? { resourceId } : {}),
                title: String(action),
                node: {
                  type: "const",
                  value: action,
                },
                synthetic: false,
                provenance: baseProvenance(`#/const/${action}`),
              });
            }

            put(catalog.symbols as Record<typeof routeShapeId, CatalogV1["symbols"][typeof routeShapeId]>, routeShapeId, {
              id: routeShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "RouteInfo",
              node: {
                type: "object",
                fields: {
                  source: {
                    shapeId: stringShapeId,
                  },
                },
                required: ["source"],
                additionalProperties: false,
              },
              synthetic: false,
              provenance: baseProvenance("#/route"),
            });

            put(catalog.symbols as Record<typeof blockedShapeId, CatalogV1["symbols"][typeof blockedShapeId]>, blockedShapeId, {
              id: blockedShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "BlockedHistoryItem",
              node: {
                type: "object",
                fields: {
                  action: { shapeId: blockedActionShapeId },
                  actor: { shapeId: stringShapeId },
                  createdAt: { shapeId: numberShapeId },
                  reason: { shapeId: stringShapeId },
                  statusCode: { shapeId: numberShapeId },
                },
                required: ["action", "createdAt", "reason", "statusCode"],
                additionalProperties: false,
              },
              synthetic: false,
              provenance: baseProvenance("#/blocked"),
            });

            put(catalog.symbols as Record<typeof unblockedShapeId, CatalogV1["symbols"][typeof unblockedShapeId]>, unblockedShapeId, {
              id: unblockedShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "UnblockedHistoryItem",
              node: {
                type: "object",
                fields: {
                  action: { shapeId: unblockedActionShapeId },
                  actor: { shapeId: stringShapeId },
                  createdAt: { shapeId: numberShapeId },
                },
                required: ["action", "createdAt"],
                additionalProperties: false,
              },
              synthetic: false,
              provenance: baseProvenance("#/unblocked"),
            });

            put(catalog.symbols as Record<typeof routeBlockedShapeId, CatalogV1["symbols"][typeof routeBlockedShapeId]>, routeBlockedShapeId, {
              id: routeBlockedShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "RouteBlockedHistoryItem",
              node: {
                type: "object",
                fields: {
                  action: { shapeId: routeBlockedActionShapeId },
                  actor: { shapeId: stringShapeId },
                  createdAt: { shapeId: numberShapeId },
                  reason: { shapeId: stringShapeId },
                  route: { shapeId: routeShapeId },
                },
                required: ["action", "createdAt", "reason", "route"],
                additionalProperties: false,
              },
              synthetic: false,
              provenance: baseProvenance("#/routeBlocked"),
            });

            put(catalog.symbols as Record<typeof unionShapeId, CatalogV1["symbols"][typeof unionShapeId]>, unionShapeId, {
              id: unionShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "AbuseBlockHistoryItem",
              node: {
                type: "oneOf",
                items: [blockedShapeId, unblockedShapeId, routeBlockedShapeId],
              },
              synthetic: false,
              provenance: baseProvenance("#/union"),
            });

            put(catalog.executables as Record<typeof executable.id, CatalogV1["executables"][typeof executable.id]>, executable.id, {
              ...executable,
              projection: {
                ...executable.projection,
                resultDataShapeId: unionShapeId,
              },
            });
          },
        })],
        path: "linear.teams",
        includeSchemas: true,
      });

      expect(tool).not.toBeNull();
      expect(tool?.descriptor.contract?.outputTypePreview).toContain("actor?: string;");
      expect(tool?.descriptor.contract?.outputTypePreview).toContain('action: "blocked";');
      expect(tool?.descriptor.contract?.outputTypePreview).toContain('action: "unblocked";');
      expect(tool?.descriptor.contract?.outputTypePreview).toContain('action: "route-blocked";');
      expect(tool?.descriptor.contract?.outputTypePreview).toContain("& (");
      expect(tool?.descriptor.contract?.outputTypePreview).not.toContain("Member2");
    }));

  it.effect("uses the shared TS projector for unsupported preview shapes", () =>
    Effect.gen(function* () {
      const tool = yield* expandCatalogToolByPath({
        catalogs: [createLoadedCatalog({
          mutateCatalog: (catalog) => {
            const unsupportedShapeId = ShapeSymbolIdSchema.make("shape_unsupported_not");
            const executable = Object.values(catalog.executables)[0]!;
            const callShape = catalog.symbols[executable.projection.callShapeId];
            const resourceId = callShape?.kind === "shape" ? callShape.resourceId : undefined;
            if (!callShape || callShape.kind !== "shape" || callShape.node.type !== "object") {
              throw new Error("Expected object argument shape in fixture");
            }

            put(catalog.symbols as Record<typeof unsupportedShapeId, CatalogV1["symbols"][typeof unsupportedShapeId]>, unsupportedShapeId, {
              id: unsupportedShapeId,
              kind: "shape",
              ...(resourceId ? { resourceId } : {}),
              title: "UnsupportedNot",
              node: {
                type: "not",
                itemShapeId: callShape.node.fields.filter!.shapeId,
              },
              synthetic: false,
              provenance: baseProvenance("#/unsupported/not"),
            });

            put(catalog.symbols as Record<typeof callShape.id, CatalogV1["symbols"][typeof callShape.id]>, callShape.id, {
              ...callShape,
              node: {
                ...callShape.node,
                fields: {
                  ...callShape.node.fields,
                  unsupported: {
                    shapeId: unsupportedShapeId,
                  },
                },
              },
            });
          },
        })],
        path: "linear.teams",
        includeSchemas: true,
      });

      expect(tool).not.toBeNull();
      expect(tool?.descriptor.contract?.inputTypePreview).toContain("unsupported?: unknown;");
    }));
});

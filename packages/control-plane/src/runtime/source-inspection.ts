import type {
  Source,
  SourceId,
  SourceInspection,
  SourceInspectionDiscoverPayload,
  SourceInspectionDiscoverResult,
  SourceInspectionDiscoverResultItem,
  SourceInspectionToolDetail,
  SourceInspectionToolListItem,
  SourceInspectionToolSummary,
  WorkspaceId,
} from "#schema";
import {
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../api/errors";
import * as Effect from "effect/Effect";

import { joinTypeNameSegments } from "./catalog-typescript";
import { LocalSourceArtifactMissingError } from "./local-errors";
import { operationErrors } from "./operation-errors";
import { formatWithPrettier } from "./prettier-format";
import {
  expandCatalogToolByPath,
  expandCatalogTools,
  loadSourceWithCatalog,
  type LoadedSourceCatalogTool,
} from "./source-catalog-runtime";
import { RuntimeSourceStoreService } from "./source-store";

const sourceInspectOps = {
  bundle: operationErrors("sources.inspect.bundle"),
  tool: operationErrors("sources.inspect.tool"),
  discover: operationErrors("sources.inspect.discover"),
} as const;

const tokenize = (value: string): Array<string> =>
  value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const formatOptionalJson = (value: string | null) =>
  value === null
    ? Effect.succeed<string | null>(null)
    : Effect.promise(() => formatWithPrettier(value, "json"));

const formatOptionalTypeScript = (value: string | undefined) =>
  value === undefined
    ? Effect.succeed<string | undefined>(undefined)
    : Effect.promise(() => formatWithPrettier(value, "typescript"));

const formatInspectionToolDetail = (detail: SourceInspectionToolDetail) =>
  Effect.gen(function* () {
    const summary = yield* Effect.all({
      inputTypePreview: formatOptionalTypeScript(detail.summary.inputTypePreview),
      outputTypePreview: formatOptionalTypeScript(detail.summary.outputTypePreview),
      fullInputType: formatOptionalTypeScript(detail.summary.fullInputType),
      fullOutputType: formatOptionalTypeScript(detail.summary.fullOutputType),
    }).pipe(
      Effect.map(({ inputTypePreview, outputTypePreview, fullInputType, fullOutputType }) => ({
        ...detail.summary,
        ...(inputTypePreview ? { inputTypePreview } : {}),
        ...(outputTypePreview ? { outputTypePreview } : {}),
        ...(fullInputType ? { fullInputType } : {}),
        ...(fullOutputType ? { fullOutputType } : {}),
      })),
    );
    const detailFields = yield* Effect.all({
      definitionJson: formatOptionalJson(detail.definitionJson),
      documentationJson: formatOptionalJson(detail.documentationJson),
      nativeJson: formatOptionalJson(detail.nativeJson),
      callSchemaJson: formatOptionalJson(detail.callSchemaJson),
      resultSchemaJson: formatOptionalJson(detail.resultSchemaJson),
      exampleCallJson: formatOptionalJson(detail.exampleCallJson),
      exampleResultJson: formatOptionalJson(detail.exampleResultJson),
    });

    return {
      ...detail,
      summary,
      ...detailFields,
    } satisfies SourceInspectionToolDetail;
  });

const canInspectSourceWithoutCatalog = (source: Source): boolean =>
  source.status === "draft"
  || source.status === "probing"
  || source.status === "auth_required";

const loadSourceForMissingCatalog = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  cause: LocalSourceArtifactMissingError;
}) =>
  Effect.gen(function* () {
    const sourceStore = yield* RuntimeSourceStoreService;
    const source = yield* sourceStore.loadSourceById({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    if (!canInspectSourceWithoutCatalog(source)) {
      return yield* Effect.fail(input.cause);
    }

    return source;
  });

const loadSourceCatalogOrEmpty = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  loadSourceWithCatalog({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
  }).pipe(
    Effect.map((catalogEntry) => ({
      kind: "catalog" as const,
      catalogEntry,
    })),
    Effect.catchTag("LocalSourceArtifactMissingError", (cause) =>
      Effect.gen(function* () {
        const source = yield* loadSourceForMissingCatalog({
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          cause,
        });

        return {
          kind: "empty" as const,
          source,
        };
      })),
  );

const executableDetails = (tool: LoadedSourceCatalogTool) => {
  switch (tool.executable.protocol) {
    case "http":
      return {
        method: tool.executable.method,
        pathTemplate: tool.executable.pathTemplate,
        rawToolId: tool.path.split(".").at(-1) ?? null,
        operationId: null,
        group: null,
        leaf: tool.path.split(".").at(-1) ?? null,
        tags: tool.capability.surface.tags ?? [],
      };
    case "graphql":
      return {
        method: tool.executable.operationType,
        pathTemplate: tool.executable.rootField,
        rawToolId: tool.path.split(".").at(-1) ?? null,
        operationId: tool.executable.rootField,
        group: null,
        leaf: tool.executable.rootField,
        tags: tool.capability.surface.tags ?? [],
      };
    case "mcp":
      return {
        method: null,
        pathTemplate: null,
        rawToolId: tool.path.split(".").at(-1) ?? null,
        operationId: tool.executable.toolName,
        group: null,
        leaf: tool.executable.toolName,
        tags: tool.capability.surface.tags ?? [],
      };
  }
};

const inspectionToolListItemFromTool = (tool: LoadedSourceCatalogTool): SourceInspectionToolListItem => ({
  path: tool.path,
  method:
    tool.executable.protocol === "http"
      ? tool.executable.method
      : tool.executable.protocol === "graphql"
        ? tool.executable.operationType
        : null,
});

const persistedToolSummaryFromTool = (tool: LoadedSourceCatalogTool): SourceInspectionToolSummary => {
  const details = executableDetails(tool);

  return {
    path: tool.path,
    sourceKey: tool.source.id,
    ...(tool.capability.surface.title ? { title: tool.capability.surface.title } : {}),
    ...(tool.capability.surface.summary || tool.capability.surface.description
      ? { description: tool.capability.surface.summary ?? tool.capability.surface.description! }
      : {}),
    protocol: tool.executable.protocol,
    toolId: tool.path.split(".").at(-1) ?? tool.path,
    rawToolId: details.rawToolId,
    operationId: details.operationId,
    group: details.group,
    leaf: details.leaf,
    tags: [...details.tags],
    method: details.method,
    pathTemplate: details.pathTemplate,
    ...(tool.descriptor.inputTypePreview
      ? { inputTypePreview: tool.descriptor.inputTypePreview }
      : {}),
    ...(tool.descriptor.outputTypePreview
      ? { outputTypePreview: tool.descriptor.outputTypePreview }
      : {}),
  };
};

const inspectionToolDetailFromTool = (tool: LoadedSourceCatalogTool): SourceInspectionToolDetail => {
  const fullInputType = tool.typeProjector.renderSelfContainedShape(
    tool.projectedDescriptor.callShapeId,
    {
      aliasHint: joinTypeNameSegments(...tool.projectedDescriptor.toolPath, "call"),
    },
  );
  const fullOutputType = tool.projectedDescriptor.resultShapeId
    ? tool.typeProjector.renderSelfContainedShape(tool.projectedDescriptor.resultShapeId, {
        aliasHint: joinTypeNameSegments(...tool.projectedDescriptor.toolPath, "result"),
      })
    : undefined;

  return ({
    summary: {
      ...persistedToolSummaryFromTool(tool),
      ...(fullInputType ? { fullInputType } : {}),
      ...(fullOutputType ? { fullOutputType } : {}),
    },
    definitionJson: JSON.stringify({
      capability: tool.capability,
      executable: tool.executable,
    }),
    documentationJson: JSON.stringify({
      capabilityDocs: {
        summary: tool.capability.surface.summary,
        description: tool.capability.surface.description,
      },
    }),
    nativeJson: tool.executable.native?.[0]?.value
      ? JSON.stringify(tool.executable.native[0]!.value)
      : null,
    callSchemaJson: tool.descriptor.inputSchema
      ? JSON.stringify(tool.descriptor.inputSchema)
      : null,
    resultSchemaJson: tool.descriptor.outputSchema
      ? JSON.stringify(tool.descriptor.outputSchema)
      : null,
    exampleCallJson: null,
    exampleResultJson: null,
  });
};

const resolveSourceInspection = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  includeSchemas: boolean;
}) =>
  Effect.gen(function* () {
    const loaded = yield* loadSourceCatalogOrEmpty({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    if (loaded.kind === "empty") {
      return {
        source: loaded.source,
        namespace: loaded.source.namespace ?? "",
        pipelineKind: "ir" as const,
        tools: [],
      };
    }

    const tools = yield* expandCatalogTools({
      catalogs: [loaded.catalogEntry],
      includeSchemas: input.includeSchemas,
    });

    return {
      source: loaded.catalogEntry.source,
      namespace: loaded.catalogEntry.source.namespace ?? "",
      pipelineKind: "ir" as const,
      tools,
    };
  });

const resolveSourceInspectionTool = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  toolPath: string;
}) =>
  Effect.gen(function* () {
    const loaded = yield* loadSourceCatalogOrEmpty({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });

    if (loaded.kind === "empty") {
      return {
        source: loaded.source,
        namespace: loaded.source.namespace ?? "",
        pipelineKind: "ir" as const,
        tool: null,
      };
    }

    const tool = yield* expandCatalogToolByPath({
      catalogs: [loaded.catalogEntry],
      path: input.toolPath,
      includeSchemas: true,
    });

    return {
      source: loaded.catalogEntry.source,
      namespace: loaded.catalogEntry.source.namespace ?? "",
      pipelineKind: "ir" as const,
      tool,
    };
  });

const scoreTool = (input: {
  queryTokens: ReadonlyArray<string>;
  tool: LoadedSourceCatalogTool;
}): SourceInspectionDiscoverResultItem | null => {
  let score = 0;
  const reasons: Array<string> = [];
  const summary = persistedToolSummaryFromTool(input.tool);
  const pathTokens = tokenize(summary.path);
  const titleTokens = tokenize(summary.title ?? "");
  const descriptionTokens = tokenize(summary.description ?? "");
  const tagTokens = summary.tags.flatMap(tokenize);
  const methodPathTokens = tokenize(`${summary.method ?? ""} ${summary.pathTemplate ?? ""}`);

  for (const token of input.queryTokens) {
    if (pathTokens.includes(token)) {
      score += 12;
      reasons.push(`path matches ${token} (+12)`);
      continue;
    }
    if (tagTokens.includes(token)) {
      score += 10;
      reasons.push(`tag matches ${token} (+10)`);
      continue;
    }
    if (titleTokens.includes(token)) {
      score += 8;
      reasons.push(`title matches ${token} (+8)`);
      continue;
    }
    if (methodPathTokens.includes(token)) {
      score += 6;
      reasons.push(`method/path matches ${token} (+6)`);
      continue;
    }
    if (descriptionTokens.includes(token) || input.tool.searchText.includes(token)) {
      score += 2;
      reasons.push(`description/text matches ${token} (+2)`);
    }
  }

  if (score <= 0) {
    return null;
  }

  return {
    path: input.tool.path,
    score,
    ...(summary.description ? { description: summary.description } : {}),
    ...(summary.inputTypePreview ? { inputTypePreview: summary.inputTypePreview } : {}),
    ...(summary.outputTypePreview ? { outputTypePreview: summary.outputTypePreview } : {}),
    reasons,
  };
};

const mapInspectionError = (
  operation:
    | typeof sourceInspectOps.bundle
    | typeof sourceInspectOps.tool
    | typeof sourceInspectOps.discover,
  cause: unknown,
  details: string,
): ControlPlaneNotFoundError | ControlPlaneStorageError => {
  if (cause instanceof ControlPlaneNotFoundError) {
    return cause;
  }

  if (cause instanceof ControlPlaneStorageError) {
    return cause;
  }

  return operation.unknownStorage(cause, details);
};

export const getSourceInspection = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.gen(function* () {
    const inspection = yield* resolveSourceInspection({
      ...input,
      includeSchemas: false,
    });

    return {
      source: inspection.source,
      namespace: inspection.namespace,
      pipelineKind: inspection.pipelineKind,
      toolCount: inspection.tools.length,
      tools: inspection.tools.map((tool) => inspectionToolListItemFromTool(tool)),
    } satisfies SourceInspection;
  }).pipe(
    Effect.mapError((cause) =>
      mapInspectionError(
        sourceInspectOps.bundle,
        cause,
        "Failed building source inspection bundle",
      )),
  );

export const getSourceInspectionToolDetail = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  toolPath: string;
}) =>
  Effect.gen(function* () {
    const inspection = yield* resolveSourceInspectionTool({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      toolPath: input.toolPath,
    });
    const tool = inspection.tool;

    if (!tool) {
      return yield* Effect.fail(
        sourceInspectOps.tool.notFound(
          "Tool not found",
          `workspaceId=${input.workspaceId} sourceId=${input.sourceId} path=${input.toolPath}`,
        ),
      );
    }

    return yield* formatInspectionToolDetail(inspectionToolDetailFromTool(tool));
  }).pipe(
    Effect.mapError((cause) =>
      mapInspectionError(
        sourceInspectOps.tool,
        cause,
        "Failed building source inspection tool detail",
      )),
  );

export const discoverSourceInspectionTools = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  payload: SourceInspectionDiscoverPayload;
}) =>
  Effect.gen(function* () {
    const inspection = yield* resolveSourceInspection({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      includeSchemas: false,
    });
    const queryTokens = tokenize(input.payload.query);
    const results = inspection.tools
      .map((tool) =>
        scoreTool({
          queryTokens,
          tool,
        }),
      )
      .filter((value): value is SourceInspectionDiscoverResultItem => value !== null)
      .sort((left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
      )
      .slice(0, input.payload.limit ?? 12);

    return {
      query: input.payload.query,
      queryTokens,
      bestPath: results[0]?.path ?? null,
      total: results.length,
      results,
    } satisfies SourceInspectionDiscoverResult;
  }).pipe(
    Effect.mapError((cause) =>
      mapInspectionError(
        sourceInspectOps.discover,
        cause,
        "Failed building source inspection discovery",
      )),
  );

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
} from "../../api/errors";
import * as Effect from "effect/Effect";

import { LocalSourceArtifactMissingError } from "../local/errors";
import { operationErrors } from "../policy/operation-errors";
import {
  expandCatalogToolByPath,
  expandCatalogTools,
  loadSourceWithCatalog,
  type LoadedSourceCatalogTool,
} from "../catalog/source/runtime";
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
  const display = tool.executable.display ?? {};
  return {
    protocol: display.protocol ?? tool.executable.adapterKey,
    method: display.method ?? null,
    pathTemplate: display.pathTemplate ?? null,
    rawToolId: display.rawToolId ?? tool.path.split(".").at(-1) ?? null,
    operationId: display.operationId ?? null,
    group: display.group ?? null,
    leaf: display.leaf ?? tool.path.split(".").at(-1) ?? null,
    tags: tool.capability.surface.tags ?? [],
  };
};

const inspectionToolListItemFromTool = (tool: LoadedSourceCatalogTool): SourceInspectionToolListItem => ({
  path: tool.path,
  method: executableDetails(tool).method,
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
    protocol: details.protocol,
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

const nativeEncodingLanguage = (encoding: string | undefined): string =>
  encoding === "graphql" || encoding === "yaml" || encoding === "json" || encoding === "text"
    ? encoding
    : "json";

const jsonSection = (
  title: string,
  value: unknown | null | undefined,
): SourceInspectionToolDetail["sections"][number] | null =>
  value === null || value === undefined
    ? null
    : {
        kind: "code",
        title,
        language: "json",
        body: JSON.stringify(value, null, 2),
      };

export const inspectionToolDetailFromTool = (
  tool: LoadedSourceCatalogTool,
): SourceInspectionToolDetail => {
  const summary = persistedToolSummaryFromTool(tool);
  const details = executableDetails(tool);
  const overviewItems = [
    { label: "Protocol", value: details.protocol },
    ...(details.method ? [{ label: "Method", value: details.method, mono: true }] : []),
    ...(details.pathTemplate ? [{ label: "Target", value: details.pathTemplate, mono: true }] : []),
    ...(details.operationId ? [{ label: "Operation", value: details.operationId, mono: true }] : []),
    ...(details.group ? [{ label: "Group", value: details.group, mono: true }] : []),
    ...(details.leaf ? [{ label: "Leaf", value: details.leaf, mono: true }] : []),
    ...(details.rawToolId ? [{ label: "Raw tool", value: details.rawToolId, mono: true }] : []),
    { label: "Call shape", value: tool.projectedDescriptor.callShapeId, mono: true },
    ...(tool.projectedDescriptor.resultShapeId
      ? [{ label: "Result shape", value: tool.projectedDescriptor.resultShapeId, mono: true }]
      : []),
  ];
  const nativeSections = [
    ...(tool.capability.native ?? []).map((blob, index) => ({
      kind: "code" as const,
      title: `Capability native ${String(index + 1)}: ${blob.kind}`,
      language: nativeEncodingLanguage(blob.encoding),
      body:
        typeof blob.value === "string"
          ? blob.value
          : JSON.stringify(blob.value ?? null, null, 2),
    })),
    ...(tool.executable.native ?? []).map((blob, index) => ({
      kind: "code" as const,
      title: `Executable native ${String(index + 1)}: ${blob.kind}`,
      language: nativeEncodingLanguage(blob.encoding),
      body:
        typeof blob.value === "string"
          ? blob.value
          : JSON.stringify(blob.value ?? null, null, 2),
    })),
  ];
  const sections = [
    {
      kind: "facts" as const,
      title: "Overview",
      items: overviewItems,
    },
    ...(summary.description
      ? [{
          kind: "markdown" as const,
          title: "Description",
          body: summary.description,
        }]
      : []),
    ...([
      jsonSection("Input Schema", tool.descriptor.inputSchema),
      jsonSection("Output Schema", tool.descriptor.outputSchema),
      jsonSection("Capability", tool.capability),
      jsonSection("Executable", {
        id: tool.executable.id,
        adapterKey: tool.executable.adapterKey,
        bindingVersion: tool.executable.bindingVersion,
        binding: tool.executable.binding,
        projection: tool.executable.projection,
        display: tool.executable.display ?? null,
      }),
      jsonSection("Documentation", {
        summary: tool.capability.surface.summary,
        description: tool.capability.surface.description,
      }),
    ].filter((section) => section !== null) as Array<SourceInspectionToolDetail["sections"][number]>),
    ...nativeSections,
  ];

  return ({
    summary,
    sections,
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
      includeTypePreviews: input.includeSchemas,
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
      includeSchemas: false,
      includeTypePreviews: false,
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

    return inspectionToolDetailFromTool(tool);
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

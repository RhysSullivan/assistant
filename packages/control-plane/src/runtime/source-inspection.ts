import type {
  Source,
  SourceId,
  SourceInspection,
  SourceInspectionDiscoverPayload,
  SourceInspectionDiscoverResult,
  SourceInspectionDiscoverResultItem,
  SourceInspectionSchemaBundle,
  SourceInspectionToolListItem,
  SourceInspectionToolDetail,
  SourceInspectionToolSummary,
  StoredSourceRecipeOperationRecord,
  WorkspaceId,
} from "#schema";
import { SourceRecipeSchemaBundleIdSchema } from "#schema";
import {
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "#api";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { operationErrors } from "./operation-errors";
import { formatWithPrettier } from "./prettier-format";
import {
  getSourceAdapterForOperation,
} from "./source-adapters";
import {
  recipeToolMetadata,
  recipeToolPath,
} from "./source-recipes-runtime";
import type { SourceAdapterPersistedOperationMetadata } from "./source-adapters/types";
import { namespaceFromSourceName } from "./source-names";
import { loadSourceById } from "./source-store";
import { ControlPlaneStore } from "./store";

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

type InspectionToolRecord = {
  operation: StoredSourceRecipeOperationRecord;
  metadata: SourceAdapterPersistedOperationMetadata;
  listItem: SourceInspectionToolListItem;
  searchText: string;
};

type ResolvedSourceInspection = {
  source: Source;
  namespace: string;
  pipelineKind: SourceInspection["pipelineKind"];
  schemaBundleId: string | null;
  tools: ReadonlyArray<InspectionToolRecord>;
};

const formatOptionalJson = (value: string | null) =>
  value === null
    ? Effect.succeed<string | null>(null)
    : Effect.promise(() => formatWithPrettier(value, "json"));

const formatOptionalTypeScript = (value: string | undefined) =>
  value === undefined
    ? Effect.succeed<string | undefined>(undefined)
    : Effect.promise(() => formatWithPrettier(value, "typescript"));

const formatToolSummary = (summary: SourceInspectionToolSummary) =>
  Effect.all({
    inputType: formatOptionalTypeScript(summary.inputType),
    outputType: formatOptionalTypeScript(summary.outputType),
  }).pipe(
    Effect.map(({ inputType, outputType }) => ({
      ...summary,
      ...(inputType ? { inputType } : {}),
      ...(outputType ? { outputType } : {}),
    } satisfies SourceInspectionToolSummary)),
  );

const formatInspectionToolDetail = (detail: SourceInspectionToolDetail) =>
  Effect.gen(function* () {
    const summary = yield* formatToolSummary(detail.summary);
    const detailFields = yield* Effect.all({
      definitionJson: formatOptionalJson(detail.definitionJson),
      documentationJson: formatOptionalJson(detail.documentationJson),
      providerDataJson: formatOptionalJson(detail.providerDataJson),
      inputSchemaJson: formatOptionalJson(detail.inputSchemaJson),
      outputSchemaJson: formatOptionalJson(detail.outputSchemaJson),
      exampleInputJson: formatOptionalJson(detail.exampleInputJson),
      exampleOutputJson: formatOptionalJson(detail.exampleOutputJson),
    });

    return {
      ...detail,
      ...detailFields,
      summary,
    } satisfies SourceInspectionToolDetail;
  });

const loadSourceRecipeRecord = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const sourceRecord = yield* sourceInspectOps.bundle.child("record").mapStorage(
        store.sources.getByWorkspaceAndId(input.workspaceId, input.sourceId),
      );
      if (Option.isNone(sourceRecord)) {
        return yield* Effect.fail(
          sourceInspectOps.bundle.notFound(
            "Source not found",
            `workspaceId=${input.workspaceId} sourceId=${input.sourceId}`,
          ),
        );
      }

      const source = yield* loadSourceById(store, {
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
      }).pipe(
        Effect.mapError((cause) =>
          sourceInspectOps.bundle.unknownStorage(
            cause,
            "Failed loading source",
          ),
        ),
      );
      const operations = yield* sourceInspectOps.bundle.child("operations").mapStorage(
        store.sourceRecipeOperations.listByRevisionId(sourceRecord.value.recipeRevisionId),
      );
      const schemaBundles = yield* sourceInspectOps.bundle.child("schema_bundles").mapStorage(
        store.sourceRecipeSchemaBundles.listByRevisionId(sourceRecord.value.recipeRevisionId),
      );

      return {
        source,
        operations,
        schemaBundleId: schemaBundles.find((bundle) => bundle.bundleKind === "json_schema_ref_map")?.id
          ?? schemaBundles[0]?.id
          ?? null,
      };
    }),
  );

const inspectionToolListItemFromOperation = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
  metadata: SourceAdapterPersistedOperationMetadata;
}): SourceInspectionToolListItem => ({
  path: recipeToolPath({
    source: input.source,
    operation: input.operation,
  }),
  method: input.metadata.method,
});

const persistedToolSummaryFromRecipeOperation = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
  metadata: SourceAdapterPersistedOperationMetadata;
  includeTypes: boolean;
}): SourceInspectionToolSummary => {
  const path = inspectionToolListItemFromOperation(input).path;
  const descriptor = input.includeTypes
    ? getSourceAdapterForOperation(input.operation).createToolDescriptor({
        source: input.source,
        operation: input.operation,
        path,
        includeSchemas: false,
      })
    : null;

  return {
    path,
    sourceKey: input.source.id,
    ...(input.operation.title ? { title: input.operation.title } : {}),
    ...(input.operation.description ? { description: input.operation.description } : {}),
    providerKind: input.operation.providerKind,
    toolId: input.operation.toolId,
    rawToolId: input.metadata.rawToolId,
    operationId: input.metadata.operationId,
    group: input.metadata.group,
    leaf: input.metadata.leaf,
    tags: [...input.metadata.tags],
    method: input.metadata.method,
    pathTemplate: input.metadata.pathTemplate,
    ...(descriptor?.inputType ? { inputType: descriptor.inputType } : {}),
    ...(descriptor?.outputType ? { outputType: descriptor.outputType } : {}),
  };
};

const inspectionToolDetailFromOperation = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
  metadata: SourceAdapterPersistedOperationMetadata;
  schemaBundleId: string | null;
}): SourceInspectionToolDetail => {
  const summary = persistedToolSummaryFromRecipeOperation({
    source: input.source,
    operation: input.operation,
    metadata: input.metadata,
    includeTypes: true,
  });

  return {
    summary,
    definitionJson: null,
    documentationJson: null,
    providerDataJson: input.operation.providerDataJson,
    inputSchemaJson: input.operation.inputSchemaJson,
    outputSchemaJson: input.operation.outputSchemaJson,
    schemaBundleId: input.schemaBundleId,
    exampleInputJson: null,
    exampleOutputJson: null,
  } satisfies SourceInspectionToolDetail;
};

const resolveSourceInspection = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
}) =>
  Effect.gen(function* () {
    const { source, operations, schemaBundleId } = yield* loadSourceRecipeRecord(input);
    const namespace = source.namespace ?? namespaceFromSourceName(source.name);

    return {
      source,
      namespace,
      pipelineKind: "persisted",
      schemaBundleId,
      tools: yield* Effect.forEach(operations, (operation) =>
        Effect.gen(function* () {
          const path = recipeToolPath({
            source,
            operation,
          });
          const metadata = yield* recipeToolMetadata({
            source,
            operation,
            path,
          });
          const listItem = inspectionToolListItemFromOperation({
            source,
            operation,
            metadata,
          });

          return {
            operation,
            metadata,
            listItem,
            searchText: metadata.searchText,
          } satisfies InspectionToolRecord;
        })
      ),
    } satisfies ResolvedSourceInspection;
  });

const scoreTool = (input: {
  queryTokens: ReadonlyArray<string>;
  tool: InspectionToolRecord;
}): SourceInspectionDiscoverResultItem | null => {
  let score = 0;
  const reasons: Array<string> = [];
  const pathTokens = tokenize(input.tool.listItem.path);
  const titleTokens = tokenize(input.tool.operation.title ?? "");
  const descriptionTokens = tokenize(input.tool.operation.description ?? "");
  const tagTokens = input.tool.metadata.tags.flatMap(tokenize);
  const methodPathTokens = tokenize(
    `${input.tool.listItem.method ?? ""} ${input.tool.metadata.pathTemplate ?? ""}`,
  );

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
    path: input.tool.listItem.path,
    score,
    ...(input.tool.operation.description
      ? { description: input.tool.operation.description }
      : {}),
    reasons,
  } satisfies SourceInspectionDiscoverResultItem;
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
    const inspection = yield* resolveSourceInspection(input);

    return {
      source: inspection.source,
      namespace: inspection.namespace,
      pipelineKind: inspection.pipelineKind,
      toolCount: inspection.tools.length,
      tools: inspection.tools.map((tool) => tool.listItem),
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
    const inspection = yield* resolveSourceInspection({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    });
    const tool = inspection.tools.find((candidate) => candidate.listItem.path === input.toolPath);

    if (!tool) {
      return yield* Effect.fail(
        sourceInspectOps.tool.notFound(
          "Tool not found",
          `workspaceId=${input.workspaceId} sourceId=${input.sourceId} path=${input.toolPath}`,
        ),
      );
    }

    return yield* formatInspectionToolDetail(inspectionToolDetailFromOperation({
      source: inspection.source,
      operation: tool.operation,
      metadata: tool.metadata,
      schemaBundleId: inspection.schemaBundleId,
    }));
  }).pipe(
    Effect.mapError((cause) =>
      mapInspectionError(
        sourceInspectOps.tool,
        cause,
        "Failed building source inspection tool detail",
      )),
  );

export const getSourceInspectionSchemaBundle = (input: {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
  schemaBundleId: string;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const sourceRecord = yield* sourceInspectOps.tool.child("bundle_record").mapStorage(
        store.sources.getByWorkspaceAndId(input.workspaceId, input.sourceId),
      );
      if (Option.isNone(sourceRecord)) {
        return yield* Effect.fail(
          sourceInspectOps.tool.notFound(
            "Source not found",
            `workspaceId=${input.workspaceId} sourceId=${input.sourceId}`,
          ),
        );
      }

      const schemaBundle = yield* sourceInspectOps.tool.child("schema_bundle").mapStorage(
        store.sourceRecipeSchemaBundles.getById(
          SourceRecipeSchemaBundleIdSchema.make(input.schemaBundleId),
        ),
      );
      if (
        Option.isNone(schemaBundle)
        || schemaBundle.value.recipeRevisionId !== sourceRecord.value.recipeRevisionId
      ) {
        return yield* Effect.fail(
          sourceInspectOps.tool.notFound(
            "Schema bundle not found",
            `workspaceId=${input.workspaceId} sourceId=${input.sourceId} schemaBundleId=${input.schemaBundleId}`,
          ),
        );
      }

      return {
        id: schemaBundle.value.id,
        kind: schemaBundle.value.bundleKind,
        hash: schemaBundle.value.contentHash,
        refsJson: schemaBundle.value.refsJson,
      } satisfies SourceInspectionSchemaBundle;
    }),
  ).pipe(
    Effect.mapError((cause) =>
      mapInspectionError(
        sourceInspectOps.tool,
        cause,
        "Failed loading source inspection schema bundle",
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

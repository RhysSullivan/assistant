import { promises as fs } from "node:fs";
import { join } from "node:path";

import {
  SourceIdSchema,
  SourceRecipeIdSchema,
  StoredSourceRecipeDocumentRecordSchema,
  StoredSourceRecipeOperationRecordSchema,
  StoredSourceRecipeRevisionRecordSchema,
  StoredSourceRecipeSchemaBundleRecordSchema,
  TimestampMsSchema,
  type Source,
  type SourceRecipeId,
} from "#schema";
import * as Schema from "effect/Schema";

import type { ResolvedLocalWorkspaceContext } from "./local-config";
import {
  createSourceRecipeRevisionRecord,
  stableSourceRecipeId,
} from "./source-definitions";
import {
  contentHash,
  type SourceRecipeMaterialization,
} from "./source-recipe-support";

const LOCAL_SOURCE_ARTIFACT_VERSION = 1 as const;

export const LocalSourceArtifactSchema = Schema.Struct({
  version: Schema.Literal(LOCAL_SOURCE_ARTIFACT_VERSION),
  sourceId: SourceIdSchema,
  recipeId: SourceRecipeIdSchema,
  generatedAt: TimestampMsSchema,
  revision: StoredSourceRecipeRevisionRecordSchema,
  documents: Schema.Array(StoredSourceRecipeDocumentRecordSchema),
  schemaBundles: Schema.Array(StoredSourceRecipeSchemaBundleRecordSchema),
  operations: Schema.Array(StoredSourceRecipeOperationRecordSchema),
});

export type LocalSourceArtifact = typeof LocalSourceArtifactSchema.Type;

const decodeLocalSourceArtifact = Schema.decodeUnknownSync(LocalSourceArtifactSchema);

const localSourceArtifactPath = (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): string =>
  join(
    input.context.artifactsDirectory,
    "sources",
    `${input.sourceId}.json`,
  );

const canonicalMaterializationHash = (input: {
  materialization: SourceRecipeMaterialization;
}): string => {
  const documents = [...input.materialization.documents]
    .map((document) => ({
      documentKind: document.documentKind,
      documentKey: document.documentKey,
      contentHash: document.contentHash,
    }))
    .sort((left, right) =>
      left.documentKind.localeCompare(right.documentKind)
      || left.documentKey.localeCompare(right.documentKey)
      || left.contentHash.localeCompare(right.contentHash)
    );
  const schemaBundles = [...input.materialization.schemaBundles]
    .map((bundle) => ({
      bundleKind: bundle.bundleKind,
      contentHash: bundle.contentHash,
    }))
    .sort((left, right) =>
      left.bundleKind.localeCompare(right.bundleKind)
      || left.contentHash.localeCompare(right.contentHash)
    );
  const operations = [...input.materialization.operations]
    .map((operation) => ({
      operationKey: operation.operationKey,
      transportKind: operation.transportKind,
      toolId: operation.toolId,
      title: operation.title,
      description: operation.description,
      operationKind: operation.operationKind,
      searchText: operation.searchText,
      inputSchemaJson: operation.inputSchemaJson,
      outputSchemaJson: operation.outputSchemaJson,
      providerKind: operation.providerKind,
      providerDataJson: operation.providerDataJson,
    }))
    .sort((left, right) => left.operationKey.localeCompare(right.operationKey));

  return contentHash(JSON.stringify({
    schemaVersion: 1,
    manifestHash: input.materialization.manifestHash,
    manifestJson: input.materialization.manifestJson,
    documents,
    schemaBundles,
    operations,
  }));
};

const bindRevisionId = <T extends { recipeRevisionId: string }>(
  items: readonly T[],
  recipeRevisionId: string,
): T[] =>
  items.map((item) => ({
    ...item,
    recipeRevisionId,
  }));

export const buildLocalSourceArtifact = (input: {
  source: Source;
  materialization: SourceRecipeMaterialization;
}): LocalSourceArtifact => {
  const recipeId: SourceRecipeId = stableSourceRecipeId(input.source);
  const now = Date.now();
  const revision = createSourceRecipeRevisionRecord({
    source: input.source,
    recipeId,
    revisionNumber: 1,
    manifestJson: input.materialization.manifestJson,
    manifestHash: input.materialization.manifestHash,
    materializationHash: canonicalMaterializationHash({
      materialization: input.materialization,
    }),
  });

  return {
    version: LOCAL_SOURCE_ARTIFACT_VERSION,
    sourceId: input.source.id,
    recipeId,
    generatedAt: now,
    revision,
    documents: bindRevisionId(input.materialization.documents, revision.id),
    schemaBundles: bindRevisionId(input.materialization.schemaBundles, revision.id),
    operations: bindRevisionId(input.materialization.operations, revision.id),
  };
};

export const readLocalSourceArtifact = async (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): Promise<LocalSourceArtifact | null> => {
  const path = localSourceArtifactPath(input);

  try {
    const content = await fs.readFile(path, "utf8");
    return decodeLocalSourceArtifact(JSON.parse(content) as unknown);
  } catch (cause) {
    if (
      cause instanceof Error
      && ("code" in cause)
      && (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }

    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid local source artifact at ${path}: ${message}`);
  }
};

export const writeLocalSourceArtifact = async (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
  artifact: LocalSourceArtifact;
}): Promise<void> => {
  const path = localSourceArtifactPath(input);
  await fs.mkdir(join(input.context.artifactsDirectory, "sources"), {
    recursive: true,
  });
  await fs.writeFile(path, `${JSON.stringify(input.artifact, null, 2)}\n`, "utf8");
};

export const removeLocalSourceArtifact = async (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): Promise<void> => {
  const path = localSourceArtifactPath(input);

  try {
    await fs.unlink(path);
  } catch (cause) {
    if (
      cause instanceof Error
      && ("code" in cause)
      && (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }

    throw cause;
  }
};

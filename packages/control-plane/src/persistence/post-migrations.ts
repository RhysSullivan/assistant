import { randomUUID } from "node:crypto";

import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  extractOpenApiManifest,
} from "@executor/codemode-openapi";
import type {
  StoredSourceRecipeDocumentRecord,
  StoredSourceRecipeOperationRecord,
  StoredSourceRecipeRevisionRecord,
  StoredSourceRecord,
} from "#schema";
import * as Effect from "effect/Effect";

import {
  buildGraphqlToolPresentation,
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
} from "../runtime/graphql-tools";
import type { SqlControlPlaneRows } from "./index";

const normalizeSearchText = (...parts: ReadonlyArray<string | null | undefined>): string =>
  parts
    .flatMap((part) => (part ? [part.trim()] : []))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const toOpenApiRecipeOperationRecord = (input: {
  recipeRevisionId: StoredSourceRecipeRevisionRecord["id"];
  definition: ReturnType<typeof compileOpenApiToolDefinitions>[number];
  manifest: Parameters<typeof buildOpenApiToolPresentation>[0]["manifest"];
  now: number;
}): StoredSourceRecipeOperationRecord => {
  const presentation = buildOpenApiToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });
  const method = input.definition.method.toUpperCase();

  return {
    id: `src_recipe_op_${randomUUID()}`,
    recipeRevisionId: input.recipeRevisionId,
    operationKey: input.definition.toolId,
    transportKind: "http",
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    operationKind:
      method === "GET" || method === "HEAD"
        ? "read"
        : method === "DELETE"
          ? "delete"
          : "write",
    searchText: normalizeSearchText(
      input.definition.toolId,
      input.definition.name,
      input.definition.description,
      input.definition.rawToolId,
      input.definition.operationId ?? undefined,
      input.definition.method,
      input.definition.path,
      input.definition.group,
      input.definition.leaf,
      input.definition.tags.join(" "),
    ),
    inputSchemaJson: presentation.inputSchemaJson ?? null,
    outputSchemaJson: presentation.outputSchemaJson ?? null,
    providerKind: "openapi",
    providerDataJson: presentation.providerDataJson,
    mcpToolName: null,
    openApiMethod: input.definition.method,
    openApiPathTemplate: input.definition.path,
    openApiOperationHash: input.definition.operationHash,
    openApiRawToolId: input.definition.rawToolId,
    openApiOperationId: input.definition.operationId ?? null,
    openApiTagsJson: JSON.stringify(input.definition.tags),
    openApiRequestBodyRequired: input.definition.invocation.requestBody?.required ?? null,
    graphqlOperationType: null,
    graphqlOperationName: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
};

const toGraphqlRecipeOperationRecord = (input: {
  recipeRevisionId: StoredSourceRecipeRevisionRecord["id"];
  definition: ReturnType<typeof compileGraphqlToolDefinitions>[number];
  manifest: Parameters<typeof buildGraphqlToolPresentation>[0]["manifest"];
  now: number;
}): StoredSourceRecipeOperationRecord => {
  const presentation = buildGraphqlToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });

  return {
    id: `src_recipe_op_${randomUUID()}`,
    recipeRevisionId: input.recipeRevisionId,
    operationKey: input.definition.toolId,
    transportKind: "graphql",
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    operationKind:
      input.definition.operationType === "query"
        ? "read"
        : input.definition.operationType === "mutation"
          ? "write"
          : "unknown",
    searchText: normalizeSearchText(
      input.definition.toolId,
      input.definition.name,
      input.definition.description,
      input.definition.rawToolId,
      input.definition.group,
      input.definition.leaf,
      input.definition.fieldName,
      input.definition.operationType,
      input.definition.operationName,
      input.definition.searchTerms.join(" "),
    ),
    inputSchemaJson: presentation.inputSchemaJson ?? null,
    outputSchemaJson: presentation.outputSchemaJson ?? null,
    providerKind: "graphql",
    providerDataJson: presentation.providerDataJson,
    mcpToolName: null,
    openApiMethod: null,
    openApiPathTemplate: null,
    openApiOperationHash: null,
    openApiRawToolId: null,
    openApiOperationId: null,
    openApiTagsJson: null,
    openApiRequestBodyRequired: null,
    graphqlOperationType: input.definition.operationType,
    graphqlOperationName: input.definition.operationName,
    createdAt: input.now,
    updatedAt: input.now,
  };
};

const primaryRecipeDocument = (input: {
  sourceRecord: StoredSourceRecord;
  documents: readonly StoredSourceRecipeDocumentRecord[];
}): StoredSourceRecipeDocumentRecord | null => {
  const documentKind =
    input.sourceRecord.kind === "openapi"
      ? "openapi"
      : input.sourceRecord.kind === "graphql"
        ? "graphql_introspection"
        : null;

  if (documentKind === null) {
    return null;
  }

  return input.documents.find((document) => document.documentKind === documentKind) ?? null;
};

const repairOpenApiRecipeRevision = (input: {
  rows: SqlControlPlaneRows;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceRecipeRevisionRecord;
  document: StoredSourceRecipeDocumentRecord;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const manifest = yield* extractOpenApiManifest(
      input.sourceRecord.name,
      input.document.contentText,
    );
    const now = Math.max(input.revision.updatedAt, input.sourceRecord.updatedAt);
    const definitions = compileOpenApiToolDefinitions(manifest);

    yield* input.rows.sourceRecipeRevisions.update(input.revision.id, {
      manifestJson: JSON.stringify(manifest),
      manifestHash: manifest.sourceHash,
      updatedAt: now,
    });
    yield* input.rows.sourceRecipeOperations.replaceForRevision({
      recipeRevisionId: input.revision.id,
      operations: definitions.map((definition) =>
        toOpenApiRecipeOperationRecord({
          recipeRevisionId: input.revision.id,
          definition,
          manifest,
          now,
        })
      ),
    });

    if (input.sourceRecord.sourceHash !== manifest.sourceHash) {
      yield* input.rows.sources.update(
        input.sourceRecord.workspaceId,
        input.sourceRecord.id,
        {
          sourceHash: manifest.sourceHash,
          updatedAt: now,
        },
      );
    }
  });

const repairGraphqlRecipeRevision = (input: {
  rows: SqlControlPlaneRows;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceRecipeRevisionRecord;
  document: StoredSourceRecipeDocumentRecord;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const manifest = yield* extractGraphqlManifest(
      input.sourceRecord.name,
      input.document.contentText,
    );
    const now = Math.max(input.revision.updatedAt, input.sourceRecord.updatedAt);
    const definitions = compileGraphqlToolDefinitions(manifest);

    yield* input.rows.sourceRecipeRevisions.update(input.revision.id, {
      manifestJson: JSON.stringify(manifest),
      manifestHash: manifest.sourceHash,
      updatedAt: now,
    });
    yield* input.rows.sourceRecipeOperations.replaceForRevision({
      recipeRevisionId: input.revision.id,
      operations: definitions.map((definition) =>
        toGraphqlRecipeOperationRecord({
          recipeRevisionId: input.revision.id,
          definition,
          manifest,
          now,
        })
      ),
    });

    if (input.sourceRecord.sourceHash !== manifest.sourceHash) {
      yield* input.rows.sources.update(
        input.sourceRecord.workspaceId,
        input.sourceRecord.id,
        {
          sourceHash: manifest.sourceHash,
          updatedAt: now,
        },
      );
    }
  });

// Repair pre-recipe OpenAPI/GraphQL sources that were migrated with raw documents
// but without the canonical manifest/operation rows required by the new runtime.
export const runPostMigrationRepairs = (
  rows: SqlControlPlaneRows,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const sourceRecords = yield* rows.sources.listAll();
    if (sourceRecords.length === 0) {
      return;
    }

    const revisionIds = [...new Set(sourceRecords.map((sourceRecord) => sourceRecord.recipeRevisionId))];
    const revisions = yield* rows.sourceRecipeRevisions.listByIds(revisionIds);
    const documents = yield* rows.sourceRecipeDocuments.listByRevisionIds(revisionIds);
    const operations = yield* rows.sourceRecipeOperations.listByRevisionIds(revisionIds);

    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    const documentsByRevisionId = new Map<string, StoredSourceRecipeDocumentRecord[]>();
    for (const document of documents) {
      const existing = documentsByRevisionId.get(document.recipeRevisionId) ?? [];
      existing.push(document);
      documentsByRevisionId.set(document.recipeRevisionId, existing);
    }

    const operationCountsByRevisionId = new Map<string, number>();
    for (const operation of operations) {
      operationCountsByRevisionId.set(
        operation.recipeRevisionId,
        (operationCountsByRevisionId.get(operation.recipeRevisionId) ?? 0) + 1,
      );
    }

    yield* Effect.forEach(sourceRecords, (sourceRecord) =>
      Effect.gen(function* () {
        if (sourceRecord.kind !== "openapi" && sourceRecord.kind !== "graphql") {
          return;
        }

        const revision = revisionById.get(sourceRecord.recipeRevisionId);
        if (!revision) {
          return;
        }

        const existingOperationCount = operationCountsByRevisionId.get(revision.id) ?? 0;
        if (revision.manifestJson !== null && existingOperationCount > 0) {
          return;
        }

        const sourceDocuments = documentsByRevisionId.get(revision.id) ?? [];
        const document = primaryRecipeDocument({
          sourceRecord,
          documents: sourceDocuments,
        });
        if (!document) {
          return;
        }

        if (sourceRecord.kind === "openapi") {
          yield* repairOpenApiRecipeRevision({
            rows,
            sourceRecord,
            revision,
            document,
          });
          return;
        }

        yield* repairGraphqlRecipeRevision({
          rows,
          sourceRecord,
          revision,
          document,
        });
      }), { discard: true });
  });

import { v } from "convex/values";
import { internal } from "../_generated/api";

import { action, internalMutation, internalQuery } from "../_generated/server";

const defaultSearchLimit = 50;
const maxSearchLimit = 5_000;
const writeBatchSize = 500;
const runtimeInternal = internal as any;

const stripConvexSystemFields = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...rest } = value;
  return rest;
};

const normalizePathForLookup = (path: string): string =>
  path
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");

const normalizeLimit = (value: number | undefined): number => {
  if (!Number.isFinite(value)) {
    return defaultSearchLimit;
  }

  return Math.max(1, Math.min(maxSearchLimit, Math.floor(value ?? defaultSearchLimit)));
};

const artifactSchemaRefId = (artifactId: string, refKey: string): string =>
  `${artifactId}:ref:${encodeURIComponent(refKey)}`;

const normalizeNamespacePart = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

const sourceNamespace = (source: {
  id: string;
  name: string;
}): string => {
  const sourceIdSuffix = source.id.slice(-6).toLowerCase();
  return `${normalizeNamespacePart(source.name)}_${sourceIdSuffix}`;
};

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const metadataSearchTerms = (metadataJson: string | null | undefined): ReadonlyArray<string> => {
  if (!metadataJson) {
    return [];
  }

  const parsed = parseJsonObject(metadataJson);
  const keys = ["method", "path", "operationType", "fieldName", "toolName"] as const;
  const terms: Array<string> = [];

  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim().length > 0) {
      terms.push(value);
    }
  }

  return terms;
};

const normalizedSearchText = (...parts: ReadonlyArray<string | null | undefined>): string =>
  parts
    .map((part) => (typeof part === "string" ? part.trim().toLowerCase() : ""))
    .filter((part) => part.length > 0)
    .join(" ");

const methodFromCanonicalPath = (canonicalPath: string | null | undefined): string | null => {
  if (!canonicalPath) {
    return null;
  }

  const candidate = canonicalPath.trim().split(/\s+/)[0]?.toLowerCase() ?? null;
  if (
    candidate === "get" ||
    candidate === "post" ||
    candidate === "put" ||
    candidate === "patch" ||
    candidate === "delete" ||
    candidate === "head" ||
    candidate === "options" ||
    candidate === "trace"
  ) {
    return candidate;
  }

  return null;
};

const toWorkspaceToolMethod = (
  protocol: string | null | undefined,
  metadataJson: string | null | undefined,
  canonicalPath: string | null | undefined,
): string => {
  const canonicalMethod = methodFromCanonicalPath(canonicalPath);
  if (canonicalMethod) {
    return canonicalMethod;
  }

  const normalizedProtocol = (protocol ?? "").toLowerCase();
  if (normalizedProtocol !== "openapi") {
    return "post";
  }

  const metadata = parseJsonObject(metadataJson);
  const method = typeof metadata.method === "string" ? metadata.method.trim().toLowerCase() : "";

  if (
    method === "get" ||
    method === "post" ||
    method === "put" ||
    method === "patch" ||
    method === "delete" ||
    method === "head" ||
    method === "options" ||
    method === "trace"
  ) {
    return method;
  }

  return "get";
};

const scoreSearchRow = (row: Record<string, unknown>, queryLower: string): number => {
  const path = String(row.path ?? "").toLowerCase();
  const name = String(row.name ?? "").toLowerCase();
  const description = String(row.description ?? "").toLowerCase();
  const sourceName = String(row.sourceName ?? "").toLowerCase();
  const searchText = String(row.searchText ?? "").toLowerCase();

  if (path === queryLower) {
    return 100;
  }

  if (path.startsWith(queryLower)) {
    return 85;
  }

  if (name.includes(queryLower)) {
    return 75;
  }

  if (path.includes(queryLower)) {
    return 70;
  }

  if (sourceName.includes(queryLower)) {
    return 60;
  }

  if (description.includes(queryLower)) {
    return 50;
  }

  if (searchText.includes(queryLower)) {
    return 40;
  }

  return 0;
};

const chunkArray = <A>(values: ReadonlyArray<A>, size: number): Array<Array<A>> => {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: Array<Array<A>> = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
};

const buildWorkspaceToolRows = async (
  ctx: any,
  args: {
    workspaceId: string;
    sourceId?: string;
    namespace?: string;
    includeDisabled?: boolean;
  },
): Promise<Array<Record<string, unknown>>> => {
  const sourceRows = await ctx.db
    .query("sources")
    .withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", args.workspaceId))
    .collect();

  const bindingRows = await ctx.db
    .query("sourceArtifactBindings")
    .withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", args.workspaceId))
    .collect();

  const bindingBySourceId = new Map<string, Record<string, unknown>>();
  for (const row of bindingRows) {
    bindingBySourceId.set(String(row.sourceId), row as unknown as Record<string, unknown>);
  }

  const rows: Array<Record<string, unknown>> = [];

  for (const sourceRow of sourceRows) {
    const source = sourceRow as unknown as Record<string, unknown>;
    const sourceId = String(source.id ?? "");
    const sourceName = String(source.name ?? "");
    const sourceKind = String(source.kind ?? "");
    const sourceEnabled = source.enabled === true;

    if (args.sourceId && sourceId !== args.sourceId) {
      continue;
    }

    const status = sourceEnabled ? "active" : "disabled";
    if (args.includeDisabled !== true && status !== "active") {
      continue;
    }

    const binding = bindingBySourceId.get(sourceId);
    if (!binding) {
      continue;
    }

    const artifactId = String(binding.artifactId ?? "");
    if (artifactId.length === 0) {
      continue;
    }

    const namespace = sourceNamespace({ id: sourceId, name: sourceName });
    if (args.namespace && namespace !== args.namespace) {
      continue;
    }

    const artifactTools = await ctx.db
      .query("artifactTools")
      .withIndex("by_artifactId", (q: any) => q.eq("artifactId", artifactId))
      .collect();

    for (const artifactToolRow of artifactTools) {
      const artifactTool = artifactToolRow as unknown as Record<string, unknown>;
      const toolId = String(artifactTool.toolId ?? "");
      const protocol = String(artifactTool.protocol ?? "openapi");
      const canonicalPath =
        typeof artifactTool.canonicalPath === "string" && artifactTool.canonicalPath.trim().length > 0
          ? artifactTool.canonicalPath.trim()
          : null;
      const method = toWorkspaceToolMethod(
        protocol,
        typeof artifactTool.metadataJson === "string" ? artifactTool.metadataJson : null,
        canonicalPath,
      );
      const path = `${namespace}.${toolId}`;
      const description = typeof artifactTool.description === "string" ? artifactTool.description : null;
      const name = String(artifactTool.name ?? toolId);

      rows.push({
        id: `wti_${args.workspaceId}_${sourceId}_${toolId}`,
        workspaceId: args.workspaceId,
        sourceId,
        sourceName,
        sourceKind,
        artifactId,
        toolId,
        protocol,
        method,
        namespace,
        path,
        pathLower: path.toLowerCase(),
        normalizedPath: normalizePathForLookup(path),
        operationPath: canonicalPath,
        name,
        description,
        searchText: normalizedSearchText(
          sourceName,
          String(source.endpoint ?? ""),
          namespace,
          toolId,
          name,
          description,
          ...metadataSearchTerms(
            typeof artifactTool.metadataJson === "string" ? artifactTool.metadataJson : null,
          ),
        ),
        operationHash: String(artifactTool.operationHash ?? ""),
        approvalMode: "auto",
        status,
        refHintTableJson: null,
        updatedAt: Number(binding.updatedAt ?? Date.now()),
      });
    }
  }

  rows.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  return rows;
};

export const ingestOpenApiManifest = action({
  args: {
    token: v.string(),
    workspaceId: v.string(),
    sourceId: v.string(),
    sourceName: v.string(),
    sourceEndpoint: v.string(),
    sourceEnabled: v.boolean(),
    sourceHash: v.string(),
    toolCount: v.number(),
    refs: v.array(
      v.object({
        refKey: v.string(),
        schemaJson: v.string(),
      }),
    ),
    tools: v.array(
      v.object({
        toolId: v.string(),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        method: v.string(),
        path: v.string(),
        operationHash: v.string(),
        invocationJson: v.string(),
        inputSchemaJson: v.union(v.string(), v.null()),
        outputSchemaJson: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const expectedToken =
      process.env.OPENAPI_INGEST_SERVICE_TOKEN?.trim()
      || process.env.OPENAPI_PARSE_API_TOKEN?.trim()
      || "";
    if (expectedToken.length > 0 && args.token.trim() !== expectedToken) {
      throw new Error("Unauthorized OpenAPI ingest request");
    }

    const artifactMeta = await ctx.runMutation(
      runtimeInternal.control_plane.tool_registry.upsertArtifactMeta,
      {
        protocol: "openapi",
        contentHash: args.sourceHash,
        extractorVersion: "openapi_v2",
        toolCount: args.toolCount,
        refHintTableJson: null,
      },
    );

    if (args.refs.length > 0) {
      let shouldPersistRefs = artifactMeta.created;

      if (!shouldPersistRefs) {
        const existingRefCount = await ctx.runQuery(
          runtimeInternal.control_plane.tool_registry.countArtifactSchemaRefs,
          {
            artifactId: artifactMeta.artifactId,
          },
        );
        shouldPersistRefs = existingRefCount !== args.refs.length;
      }

      if (shouldPersistRefs) {
        await ctx.runMutation(
          runtimeInternal.control_plane.tool_registry.clearArtifactSchemaRefs,
          {
            artifactId: artifactMeta.artifactId,
          },
        );

        for (const batch of chunkArray(args.refs, writeBatchSize)) {
          await ctx.runMutation(
            runtimeInternal.control_plane.tool_registry.putArtifactSchemaRefsBatch,
            {
              artifactId: artifactMeta.artifactId,
              refs: batch,
            },
          );
        }
      }
    }

    if (artifactMeta.created && args.tools.length > 0) {
      const artifactRows = args.tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        canonicalPath: `${tool.method.toUpperCase()} ${tool.path}`,
        operationHash: tool.operationHash,
        invocationJson: tool.invocationJson,
        inputSchemaJson: tool.inputSchemaJson,
        outputSchemaJson: tool.outputSchemaJson,
        metadataJson: JSON.stringify({
          method: tool.method,
          path: tool.path,
        }),
      }));

      for (const batch of chunkArray(artifactRows, writeBatchSize)) {
        await ctx.runMutation(runtimeInternal.control_plane.tool_registry.putArtifactToolsBatch, {
          artifactId: artifactMeta.artifactId,
          protocol: "openapi",
          insertOnly: true,
          tools: batch,
        });
      }
    }

    await ctx.runMutation(runtimeInternal.control_plane.tool_registry.bindSourceToArtifact, {
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      artifactId: artifactMeta.artifactId,
    });

    return {
      artifactId: artifactMeta.artifactId,
      created: artifactMeta.created,
      sourceHash: args.sourceHash,
      toolCount: args.toolCount,
      sourceName: args.sourceName,
      sourceEndpoint: args.sourceEndpoint,
      sourceEnabled: args.sourceEnabled,
    };
  },
});

export const upsertArtifactMeta = internalMutation({
  args: {
    protocol: v.string(),
    contentHash: v.string(),
    extractorVersion: v.string(),
    toolCount: v.number(),
    refHintTableJson: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_protocol_contentHash_extractorVersion", (q) =>
        q
          .eq("protocol", args.protocol)
          .eq("contentHash", args.contentHash)
          .eq("extractorVersion", args.extractorVersion),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        toolCount: args.toolCount,
        refHintTableJson: args.refHintTableJson ?? null,
        updatedAt: now,
      });

      return {
        artifactId: existing.id,
        created: false,
      };
    }

    const artifactId = `art_${args.protocol}_${args.contentHash}_${args.extractorVersion}`;
    await ctx.db.insert("artifacts", {
      id: artifactId,
      protocol: args.protocol,
      contentHash: args.contentHash,
      extractorVersion: args.extractorVersion,
      toolCount: args.toolCount,
      refHintTableJson: args.refHintTableJson ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      artifactId,
      created: true,
    };
  },
});

export const clearArtifactSchemaRefs = internalMutation({
  args: {
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("artifactSchemaRefs")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    return { removedCount: existing.length };
  },
});

export const putArtifactSchemaRefsBatch = internalMutation({
  args: {
    artifactId: v.string(),
    refs: v.array(
      v.object({
        refKey: v.string(),
        schemaJson: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;

    for (const ref of args.refs) {
      await ctx.db.insert("artifactSchemaRefs", {
        id: artifactSchemaRefId(args.artifactId, ref.refKey),
        artifactId: args.artifactId,
        refKey: ref.refKey,
        schemaJson: ref.schemaJson,
        createdAt: now,
        updatedAt: now,
      });
      insertedCount += 1;
    }

    return { insertedCount };
  },
});

export const countArtifactSchemaRefs = internalQuery({
  args: {
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifactSchemaRefs")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    return rows.length;
  },
});

export const putArtifactToolsBatch = internalMutation({
  args: {
    artifactId: v.string(),
    protocol: v.string(),
    insertOnly: v.optional(v.boolean()),
    tools: v.array(
      v.object({
        toolId: v.string(),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        canonicalPath: v.string(),
        operationHash: v.string(),
        invocationJson: v.string(),
        inputSchemaJson: v.optional(v.union(v.string(), v.null())),
        outputSchemaJson: v.optional(v.union(v.string(), v.null())),
        metadataJson: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;

    if (args.insertOnly === true) {
      for (const tool of args.tools) {
        await ctx.db.insert("artifactTools", {
          id: `${args.artifactId}:${tool.toolId}`,
          artifactId: args.artifactId,
          protocol: args.protocol,
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          canonicalPath: tool.canonicalPath,
          operationHash: tool.operationHash,
          invocationJson: tool.invocationJson,
          inputSchemaJson: tool.inputSchemaJson ?? null,
          outputSchemaJson: tool.outputSchemaJson ?? null,
          metadataJson: tool.metadataJson ?? null,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
      }

      return { insertedCount };
    }

    for (const tool of args.tools) {
      const existing = await ctx.db
        .query("artifactTools")
        .withIndex("by_artifactId_toolId", (q) =>
          q.eq("artifactId", args.artifactId).eq("toolId", tool.toolId),
        )
        .unique();

      const row = {
        id: `${args.artifactId}:${tool.toolId}`,
        artifactId: args.artifactId,
        protocol: args.protocol,
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        canonicalPath: tool.canonicalPath,
        operationHash: tool.operationHash,
        invocationJson: tool.invocationJson,
        inputSchemaJson: tool.inputSchemaJson ?? null,
        outputSchemaJson: tool.outputSchemaJson ?? null,
        metadataJson: tool.metadataJson ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("artifactTools", row);
        insertedCount += 1;
      }
    }

    return { insertedCount };
  },
});

export const bindSourceToArtifact = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .unique();

    const row = {
      id: existing?.id ?? `sab_${args.workspaceId}_${args.sourceId}`,
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      artifactId: args.artifactId,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("sourceArtifactBindings", row);
    }

    return row;
  },
});

export const replaceSourceIngestArtifactBatches = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    artifactId: v.string(),
    protocol: v.string(),
    batches: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sourceIngestArtifactBatches")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    for (let batchIndex = 0; batchIndex < args.batches.length; batchIndex += 1) {
      await ctx.db.insert("sourceIngestArtifactBatches", {
        id: `siab_${args.workspaceId}_${args.sourceId}_${args.artifactId}_${batchIndex}`,
        workspaceId: args.workspaceId,
        sourceId: args.sourceId,
        artifactId: args.artifactId,
        protocol: args.protocol,
        batchIndex,
        toolsJson: args.batches[batchIndex] ?? "[]",
        updatedAt: now,
      });
    }

    return { batchCount: args.batches.length };
  },
});

export const clearSourceIngestArtifactBatches = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sourceIngestArtifactBatches")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    return { removedCount: existing.length };
  },
});

export const getSourceIngestArtifactBatch = internalQuery({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    artifactId: v.string(),
    batchIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sourceIngestArtifactBatches")
      .withIndex("by_workspaceId_sourceId_artifactId_batchIndex", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sourceId", args.sourceId)
          .eq("artifactId", args.artifactId)
          .eq("batchIndex", Math.max(0, Math.floor(args.batchIndex))),
      )
      .unique();

    return row ? stripConvexSystemFields(row as unknown as Record<string, unknown>) : null;
  },
});

export const replaceWorkspaceSourceToolIndex = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    sourceName: v.string(),
    sourceKind: v.string(),
    artifactId: v.string(),
    namespace: v.string(),
    refHintTableJson: v.optional(v.union(v.string(), v.null())),
    rows: v.array(
      v.object({
        toolId: v.string(),
        protocol: v.string(),
        method: v.string(),
        path: v.string(),
        operationPath: v.optional(v.union(v.string(), v.null())),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        searchText: v.string(),
        operationHash: v.string(),
        approvalMode: v.string(),
        status: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("workspaceToolIndex")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .collect();

    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    let insertedCount = 0;

    for (const row of args.rows) {
      await ctx.db.insert("workspaceToolIndex", {
        id: `wti_${args.workspaceId}_${args.sourceId}_${row.toolId}`,
        workspaceId: args.workspaceId,
        sourceId: args.sourceId,
        sourceName: args.sourceName,
        sourceKind: args.sourceKind,
        artifactId: args.artifactId,
        toolId: row.toolId,
        protocol: row.protocol,
        method: row.method,
        namespace: args.namespace,
        path: row.path,
        pathLower: row.path.toLowerCase(),
        normalizedPath: normalizePathForLookup(row.path),
        operationPath: row.operationPath ?? null,
        name: row.name,
        description: row.description,
        searchText: row.searchText,
        operationHash: row.operationHash,
        approvalMode: row.approvalMode,
        status: row.status,
        refHintTableJson: args.refHintTableJson ?? null,
        updatedAt: now,
      });
      insertedCount += 1;
    }

    return { insertedCount };
  },
});

export const clearWorkspaceSourceToolIndex = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("workspaceToolIndex")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .collect();

    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }

    return { removedCount: existingRows.length };
  },
});

export const appendWorkspaceSourceToolIndexChunk = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    sourceName: v.string(),
    sourceKind: v.string(),
    artifactId: v.string(),
    namespace: v.string(),
    refHintTableJson: v.optional(v.union(v.string(), v.null())),
    insertOnly: v.optional(v.boolean()),
    rows: v.array(
      v.object({
        toolId: v.string(),
        protocol: v.string(),
        method: v.string(),
        path: v.string(),
        operationPath: v.optional(v.union(v.string(), v.null())),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        searchText: v.string(),
        operationHash: v.string(),
        approvalMode: v.string(),
        status: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;
    let updatedCount = 0;

    if (args.insertOnly === true) {
      for (const row of args.rows) {
        const nextRow = {
          id: `wti_${args.workspaceId}_${args.sourceId}_${row.toolId}`,
          workspaceId: args.workspaceId,
          sourceId: args.sourceId,
          sourceName: args.sourceName,
          sourceKind: args.sourceKind,
          artifactId: args.artifactId,
          toolId: row.toolId,
          protocol: row.protocol,
          method: row.method,
          namespace: args.namespace,
          path: row.path,
          pathLower: row.path.toLowerCase(),
          normalizedPath: normalizePathForLookup(row.path),
          operationPath: row.operationPath ?? null,
          name: row.name,
          description: row.description,
          searchText: row.searchText,
          operationHash: row.operationHash,
          approvalMode: row.approvalMode,
          status: row.status,
          refHintTableJson: args.refHintTableJson ?? null,
          updatedAt: now,
        };

        await ctx.db.insert("workspaceToolIndex", nextRow);
        insertedCount += 1;
      }

      return { insertedCount, updatedCount };
    }

    for (const row of args.rows) {
      const id = `wti_${args.workspaceId}_${args.sourceId}_${row.toolId}`;
      const existing = await ctx.db
        .query("workspaceToolIndex")
        .withIndex("by_domainId", (q) => q.eq("id", id))
        .unique();

      const nextRow = {
        id,
        workspaceId: args.workspaceId,
        sourceId: args.sourceId,
        sourceName: args.sourceName,
        sourceKind: args.sourceKind,
        artifactId: args.artifactId,
        toolId: row.toolId,
        protocol: row.protocol,
        method: row.method,
        namespace: args.namespace,
        path: row.path,
        pathLower: row.path.toLowerCase(),
        normalizedPath: normalizePathForLookup(row.path),
        operationPath: row.operationPath ?? null,
        name: row.name,
        description: row.description,
        searchText: row.searchText,
        operationHash: row.operationHash,
        approvalMode: row.approvalMode,
        status: row.status,
        refHintTableJson: args.refHintTableJson ?? null,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, nextRow);
        updatedCount += 1;
      } else {
        await ctx.db.insert("workspaceToolIndex", nextRow);
        insertedCount += 1;
      }
    }

    return { insertedCount, updatedCount };
  },
});

export const removeSourceBindingsAndIndex = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("sourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .unique();

    if (binding) {
      await ctx.db.delete(binding._id);
    }

    const indexRows = await ctx.db
      .query("workspaceToolIndex")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .collect();

    for (const row of indexRows) {
      await ctx.db.delete(row._id);
    }

    return {
      removedBinding: Boolean(binding),
      removedIndexRows: indexRows.length,
    };
  },
});

export const getSourceArtifactBinding = internalQuery({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("sourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .unique();

    return binding ? stripConvexSystemFields(binding as unknown as Record<string, unknown>) : null;
  },
});

export const getArtifactById = internalQuery({
  args: {
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db
      .query("artifacts")
      .withIndex("by_domainId", (q) => q.eq("id", args.artifactId))
      .unique();

    return artifact ? stripConvexSystemFields(artifact as unknown as Record<string, unknown>) : null;
  },
});

export const listArtifactTools = internalQuery({
  args: {
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    return rows
      .map((row) => stripConvexSystemFields(row as unknown as Record<string, unknown>))
      .sort((left, right) => String(left.toolId).localeCompare(String(right.toolId)));
  },
});

export const listArtifactToolIndexSlice = internalQuery({
  args: {
    artifactId: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    const ordered = rows
      .map((row) => stripConvexSystemFields(row as unknown as Record<string, unknown>))
      .sort((left, right) => String(left.toolId).localeCompare(String(right.toolId)));

    const offset = Math.max(0, Math.floor(args.offset ?? 0));
    const limit = normalizeLimit(args.limit);

    return ordered.slice(offset, offset + limit).map((row) => ({
      toolId: String(row.toolId),
      protocol: String(row.protocol),
      name: String(row.name),
      description: typeof row.description === "string" ? row.description : null,
      canonicalPath: typeof row.canonicalPath === "string" ? row.canonicalPath : null,
      operationHash: String(row.operationHash),
      metadataJson: typeof row.metadataJson === "string" ? row.metadataJson : null,
    }));
  },
});

export const getArtifactTool = internalQuery({
  args: {
    artifactId: v.string(),
    toolId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("artifactTools")
      .withIndex("by_artifactId_toolId", (q) =>
        q.eq("artifactId", args.artifactId).eq("toolId", args.toolId),
      )
      .unique();

    return row ? stripConvexSystemFields(row as unknown as Record<string, unknown>) : null;
  },
});

export const searchWorkspaceTools = internalQuery({
  args: {
    workspaceId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
    sourceId: v.optional(v.string()),
    namespace: v.optional(v.string()),
    includeDisabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const trimmedQuery = args.query.trim();
    const limit = normalizeLimit(args.limit);
    if (trimmedQuery.length === 0) {
      return [];
    }

    const rows = await buildWorkspaceToolRows(ctx, {
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      namespace: args.namespace,
      includeDisabled: args.includeDisabled,
    });

    const queryLower = trimmedQuery.toLowerCase();
    const ranked = rows
      .map((row) => ({
        row,
        score: scoreSearchRow(row, queryLower),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return String(left.row.path).localeCompare(String(right.row.path));
      });

    return ranked.slice(0, limit).map((entry) => entry.row);
  },
});

export const listWorkspaceTools = internalQuery({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
    sourceId: v.optional(v.string()),
    namespace: v.optional(v.string()),
    includeDisabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await buildWorkspaceToolRows(ctx, {
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      namespace: args.namespace,
      includeDisabled: args.includeDisabled,
    });

    return rows.slice(0, normalizeLimit(args.limit));
  },
});

export const getWorkspaceToolByPath = internalQuery({
  args: {
    workspaceId: v.string(),
    pathLower: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await buildWorkspaceToolRows(ctx, {
      workspaceId: args.workspaceId,
      includeDisabled: true,
    });

    return rows.find((row) => String(row.pathLower) === args.pathLower) ?? null;
  },
});

export const listWorkspaceToolsByNormalizedPath = internalQuery({
  args: {
    workspaceId: v.string(),
    normalizedPath: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await buildWorkspaceToolRows(ctx, {
      workspaceId: args.workspaceId,
      includeDisabled: false,
    });

    return rows
      .filter((row) => String(row.normalizedPath) === args.normalizedPath)
      .slice(0, normalizeLimit(args.limit));
  },
});

export const listWorkspaceNamespaces = internalQuery({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await buildWorkspaceToolRows(ctx, {
      workspaceId: args.workspaceId,
      includeDisabled: false,
    });

    const grouped = new Map<
      string,
      {
        sourceName: string;
        sourceId: string;
        sourceKind: string;
        paths: Array<string>;
      }
    >();

    for (const row of rows) {
      const namespace = String(row.namespace);
      const existing = grouped.get(namespace);
      if (existing) {
        existing.paths.push(String(row.path));
        continue;
      }

      grouped.set(namespace, {
        sourceName: String(row.sourceName),
        sourceId: String(row.sourceId),
        sourceKind: String(row.sourceKind),
        paths: [String(row.path)],
      });
    }

    const namespaces = [...grouped.entries()]
      .map(([namespace, value]) => ({
        namespace,
        source: value.sourceName,
        sourceId: value.sourceId,
        sourceKind: value.sourceKind,
        toolCount: value.paths.length,
        samplePaths: value.paths.sort((left, right) => left.localeCompare(right)).slice(0, 3),
      }))
      .sort((left, right) => left.namespace.localeCompare(right.namespace));

    return namespaces.slice(0, normalizeLimit(args.limit));
  },
});

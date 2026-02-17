"use node";

import { z } from "zod";
import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel.d.ts";
import { buildWorkspaceTypeBundle } from "../../../core/src/tool-typing/typebundle";
import { jsonSchemaTypeHintFallback } from "../../../core/src/openapi/schema-hints";
import { buildPreviewKeys, extractTopLevelRequiredKeys } from "../../../core/src/tool-typing/schema-utils";
import {
  materializeCompiledToolSource,
  type CompiledToolSourceArtifact,
} from "../../../core/src/tool-sources";
import type { SerializedTool } from "../../../core/src/tool/source-serialization";
import type { ExternalToolSourceConfig } from "../../../core/src/tool/source-types";
import type {
  AccessPolicyRecord,
  JsonSchema,
  OpenApiSourceQuality,
  SourceAuthProfile,
  ToolDefinition,
  ToolDescriptor,
  ToolSourceRecord,
} from "../../../core/src/types";
import { listVisibleToolDescriptors } from "./tool_descriptors";
import { loadSourceArtifact, normalizeExternalToolSource } from "./tool_source_loading";
import { registrySignatureForWorkspace } from "./tool_registry_state";
import { normalizeToolPathForLookup } from "./tool_paths";
import { getDecisionForContext } from "./policy";

const baseTools = new Map<string, ToolDefinition>();

const adminAnnouncementInputSchema = z.object({
  channel: z.string().optional(),
  message: z.string().optional(),
});

const toolHintSchema = z.object({
  inputHint: z.string().optional(),
  outputHint: z.string().optional(),
  requiredInputKeys: z.array(z.string()).optional(),
  previewInputKeys: z.array(z.string()).optional(),
});

const payloadRecordSchema = z.record(z.unknown());

function toInputPayload(value: unknown): Record<string, unknown> {
  const parsed = payloadRecordSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return value === undefined ? {} : { value };
}

function toJsonSchema(value: unknown): JsonSchema {
  const parsed = payloadRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

async function listWorkspaceToolSources(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
): Promise<ToolSourceRecord[]> {
  const sources: ToolSourceRecord[] = await ctx.runQuery(internal.database.listToolSources, { workspaceId });
  return sources;
}

async function listWorkspaceAccessPolicies(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  accountId?: Id<"accounts">,
): Promise<AccessPolicyRecord[]> {
  const policies: AccessPolicyRecord[] = await ctx.runQuery(internal.database.listAccessPolicies, { workspaceId, accountId });
  return policies;
}

// Minimal built-in tools used by tests/demos.
// These are intentionally simple and are always approval-gated.
baseTools.set("admin.send_announcement", {
  path: "admin.send_announcement",
  source: "system",
  approval: "required",
  description: "Send an announcement message (demo tool; approval-gated).",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        message: { type: "string" },
      },
      required: ["channel", "message"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        channel: { type: "string" },
        message: { type: "string" },
      },
      required: ["ok", "channel", "message"],
      additionalProperties: false,
    },
  },
  run: async (input: unknown) => {
    const parsedInput = adminAnnouncementInputSchema.safeParse(toInputPayload(input));
    const channel = parsedInput.success ? (parsedInput.data.channel ?? "") : "";
    const message = parsedInput.success ? (parsedInput.data.message ?? "") : "";
    return { ok: true, channel, message };
  },
});

baseTools.set("admin.delete_data", {
  path: "admin.delete_data",
  source: "system",
  approval: "required",
  description: "Delete data (demo tool; approval-gated).",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
      additionalProperties: false,
    },
  },
  run: async () => {
    return { ok: true };
  },
});

// System tools (discover/catalog) are resolved server-side.
// Their execution is handled in the Convex tool invocation pipeline.
baseTools.set("discover", {
  path: "discover",
  source: "system",
  approval: "auto",
  description:
    "Search available tools by keyword. Returns preferred path aliases, signature hints, and ready-to-copy call examples. Compact mode is enabled by default.",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        depth: { type: "number" },
        limit: { type: "number" },
        compact: { type: "boolean" },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        bestPath: {},
        results: { type: "array" },
        total: { type: "number" },
      },
      required: ["bestPath", "results", "total"],
    },
  },
  run: async () => {
    throw new Error("discover is handled by the server tool invocation pipeline");
  },
});

baseTools.set("catalog.namespaces", {
  path: "catalog.namespaces",
  source: "system",
  approval: "auto",
  description: "List available tool namespaces with counts and sample callable paths.",
  typing: {
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        namespaces: { type: "array" },
        total: { type: "number" },
      },
      required: ["namespaces", "total"],
    },
  },
  run: async () => {
    throw new Error("catalog.namespaces is handled by the server tool invocation pipeline");
  },
});

baseTools.set("catalog.tools", {
  path: "catalog.tools",
  source: "system",
  approval: "auto",
  description: "List tools with typed signatures. Supports namespace and query filters in one call.",
  typing: {
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        query: { type: "string" },
        depth: { type: "number" },
        limit: { type: "number" },
        compact: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        results: { type: "array" },
        total: { type: "number" },
      },
      required: ["results", "total"],
    },
  },
  run: async () => {
    throw new Error("catalog.tools is handled by the server tool invocation pipeline");
  },
});

interface WorkspaceToolsResult {
  tools: Map<string, ToolDefinition>;
  warnings: string[];
  typesStorageId?: Id<"_storage">;
  debug: WorkspaceToolsDebug;
}

export interface WorkspaceToolsDebug {
  mode: "cache-fresh" | "cache-stale" | "rebuild" | "registry";
  includeDts: boolean;
  sourceTimeoutMs: number | null;
  skipCacheRead: boolean;
  sourceCount: number;
  normalizedSourceCount: number;
  cacheHit: boolean;
  cacheFresh: boolean | null;
  timedOutSources: string[];
  durationMs: number;
  trace: string[];
}

interface GetWorkspaceToolsOptions {
  sourceTimeoutMs?: number;
  allowStaleOnMismatch?: boolean;
  skipCacheRead?: boolean;
  accountId?: Id<"accounts">;
}

interface WorkspaceToolInventory {
  tools: ToolDescriptor[];
  warnings: string[];
  typesUrl?: string;
  sourceQuality: Record<string, OpenApiSourceQuality>;
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  debug: WorkspaceToolsDebug;
}

const MAX_TOOLS_IN_ACTION_RESULT = 8_000;

function truncateToolsForActionResult(
  tools: ToolDescriptor[],
  warnings: string[],
): { tools: ToolDescriptor[]; warnings: string[] } {
  if (tools.length <= MAX_TOOLS_IN_ACTION_RESULT) {
    return { tools, warnings };
  }

  return {
    tools: tools.slice(0, MAX_TOOLS_IN_ACTION_RESULT),
    warnings: [
      ...warnings,
      `Tool inventory truncated to ${MAX_TOOLS_IN_ACTION_RESULT} of ${tools.length} tools (Convex array limit). Use source filters or targeted lookups to narrow results.`,
    ],
  };
}

interface RegistryToolEntry {
  path: string;
  preferredPath: string;
  aliases: string[];
  description: string;
  approval: "auto" | "required";
  source?: string;
  displayInput?: string;
  displayOutput?: string;
  requiredInputKeys?: string[];
  previewInputKeys?: string[];
  typedRef?: {
    kind: "openapi_operation";
    sourceKey: string;
    operationId: string;
  };
}

function toSourceName(source?: string): string | null {
  if (!source) return null;
  const index = source.indexOf(":");
  if (index < 0) return source;
  const name = source.slice(index + 1).trim();
  return name.length > 0 ? name : null;
}

function toDescriptorFromRegistryEntry(
  entry: RegistryToolEntry,
  options: { includeDetails?: boolean } = {},
): ToolDescriptor {
  const includeDetails = options.includeDetails ?? true;

  return {
    path: entry.path,
    description: includeDetails ? entry.description : "",
    approval: entry.approval,
    source: entry.source,
    ...(includeDetails
      ? {
          typing: {
            requiredInputKeys: entry.requiredInputKeys,
            previewInputKeys: entry.previewInputKeys,
            typedRef: entry.typedRef,
          },
          display: {
            input: entry.displayInput,
            output: entry.displayOutput,
          },
        }
      : {}),
  };
}

function listVisibleRegistryToolDescriptors(
  entries: RegistryToolEntry[],
  context: { workspaceId: string; accountId?: string; clientId?: string },
  policies: AccessPolicyRecord[],
  options: { includeDetails?: boolean; toolPaths?: string[] } = {},
): ToolDescriptor[] {
  const requestedPaths = options.toolPaths ?? [];
  const includeDetails = options.includeDetails ?? true;

  let candidates = entries;
  if (requestedPaths.length > 0) {
    const requestedSet = new Set(requestedPaths);
    candidates = entries.filter((entry) => requestedSet.has(entry.path));
  }

  return candidates
    .filter((entry) => {
      const decision = getDecisionForContext(entry, context, policies);
      return decision !== "deny";
    })
    .map((entry) => {
      const decision = getDecisionForContext(entry, context, policies);
      return toDescriptorFromRegistryEntry(
        {
          ...entry,
          approval: decision === "require_approval" ? "required" : "auto",
        },
        { includeDetails },
      );
    });
}

function computeOpenApiSourceQualityFromDescriptors(
  tools: ToolDescriptor[],
): Record<string, OpenApiSourceQuality> {
  const grouped = new Map<string, ToolDescriptor[]>();

  for (const tool of tools) {
    const sourceKey = tool.source;
    if (!sourceKey || !sourceKey.startsWith("openapi:")) continue;
    const list = grouped.get(sourceKey) ?? [];
    list.push(tool);
    grouped.set(sourceKey, list);
  }

  const qualityBySource: Record<string, OpenApiSourceQuality> = {};
  for (const [sourceKey, sourceTools] of grouped.entries()) {
    const toolCount = sourceTools.length;
    let unknownArgsCount = 0;
    let unknownReturnsCount = 0;
    let partialUnknownArgsCount = 0;
    let partialUnknownReturnsCount = 0;

    for (const tool of sourceTools) {
      const input = tool.display?.input?.toLowerCase() ?? "";
      const output = tool.display?.output?.toLowerCase() ?? "";

      if (input.length === 0 || input === "{}" || input === "unknown") unknownArgsCount += 1;
      if (output.length === 0 || output === "unknown") unknownReturnsCount += 1;
      if (input.includes("unknown")) partialUnknownArgsCount += 1;
      if (output.includes("unknown")) partialUnknownReturnsCount += 1;
    }

    const argsQuality = toolCount > 0 ? (toolCount - unknownArgsCount) / toolCount : 1;
    const returnsQuality = toolCount > 0 ? (toolCount - unknownReturnsCount) / toolCount : 1;
    qualityBySource[sourceKey] = {
      sourceKey,
      toolCount,
      unknownArgsCount,
      unknownReturnsCount,
      partialUnknownArgsCount,
      partialUnknownReturnsCount,
      argsQuality,
      returnsQuality,
      overallQuality: (argsQuality + returnsQuality) / 2,
    };
  }

  return qualityBySource;
}

function computeSourceAuthProfilesFromSources(sources: ToolSourceRecord[]): Record<string, SourceAuthProfile> {
  const profiles: Record<string, SourceAuthProfile> = {};

  for (const source of sources) {
    const sourceKey = `source:${source.id}`;
    const auth = source.config.auth as Record<string, unknown> | undefined;
    const rawType = typeof auth?.type === "string" ? auth.type : "none";
    const type = rawType === "bearer"
      || rawType === "apiKey"
      || rawType === "basic"
      || rawType === "mixed"
      ? rawType
      : "none";
    const mode = auth?.mode === "workspace" || auth?.mode === "organization" || auth?.mode === "account"
      ? auth.mode
      : undefined;
    const header = typeof auth?.header === "string" && auth.header.trim().length > 0
      ? auth.header.trim()
      : undefined;

    profiles[sourceKey] = {
      type,
      ...(mode ? { mode } : {}),
      ...(header ? { header } : {}),
      inferred: false,
    };
  }

  return profiles;
}

function mergeTools(externalTools: Iterable<ToolDefinition>): Map<string, ToolDefinition> {
  const merged = new Map<string, ToolDefinition>();

  for (const tool of baseTools.values()) {
    merged.set(tool.path, tool);
  }

  for (const tool of externalTools) {
    merged.set(tool.path, tool);
  }
  return merged;
}

function tokenizePathSegment(value: string): string[] {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

const GENERIC_NAMESPACE_SUFFIXES = new Set([
  "api",
  "apis",
  "openapi",
  "sdk",
  "service",
  "services",
]);

function simplifyNamespaceSegment(segment: string): string {
  const tokens = tokenizePathSegment(segment);
  if (tokens.length === 0) return segment;

  const collapsed: string[] = [];
  for (const token of tokens) {
    if (collapsed[collapsed.length - 1] === token) continue;
    collapsed.push(token);
  }

  while (collapsed.length > 1) {
    const last = collapsed[collapsed.length - 1];
    if (!last || !GENERIC_NAMESPACE_SUFFIXES.has(last)) break;
    collapsed.pop();
  }

  return collapsed.join("_");
}

function preferredToolPath(path: string): string {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return path;

  const simplifiedNamespace = simplifyNamespaceSegment(segments[0]!);
  if (!simplifiedNamespace || simplifiedNamespace === segments[0]) {
    return path;
  }

  return [simplifiedNamespace, ...segments.slice(1)].join(".");
}

function toCamelSegment(segment: string): string {
  return segment.replace(/_+([a-z0-9])/g, (_m, char: string) => char.toUpperCase());
}

function getPathAliases(path: string): string[] {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return [];

  const canonicalPath = path;
  const publicPath = preferredToolPath(path);

  const aliases = new Set<string>();
  const publicSegments = publicPath.split(".").filter(Boolean);
  const camelPath = publicSegments.map(toCamelSegment).join(".");
  const compactPath = publicSegments.map((segment) => segment.replace(/[_-]/g, "")).join(".");
  const lowerPath = publicPath.toLowerCase();

  if (publicPath !== canonicalPath) aliases.add(publicPath);
  if (camelPath !== publicPath) aliases.add(camelPath);
  if (compactPath !== publicPath) aliases.add(compactPath);
  if (lowerPath !== publicPath) aliases.add(lowerPath);

  return [...aliases].slice(0, 4);
}


function normalizeHint(type?: string): string {
  return type && type.trim().length > 0 ? type : "unknown";
}

async function buildWorkspaceToolRegistry(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    registrySignature: string;
    serializedTools: SerializedTool[];
  },
): Promise<{ buildId: string }> {
  const buildId = `toolreg_${crypto.randomUUID()}`;
  await ctx.runMutation(internal.toolRegistry.beginBuild, {
    workspaceId: args.workspaceId,
    signature: args.registrySignature,
    buildId,
  });

  try {
    const entries = args.serializedTools.map((st) => {
      if (st.path === "discover" || st.path.startsWith("catalog.")) {
        return null;
      }
      const preferredPath = preferredToolPath(st.path);
      const aliases = getPathAliases(st.path);
      const namespace = (preferredPath.split(".")[0] ?? "default").toLowerCase();
      const normalizedPath = normalizeToolPathForLookup(st.path);
      const searchText = `${st.path} ${preferredPath} ${aliases.join(" ")} ${st.description} ${st.source ?? ""}`.toLowerCase();

      const inputSchema = toJsonSchema(st.typing?.inputSchema);
      const outputSchema = toJsonSchema(st.typing?.outputSchema);
      const parsedTyping = toolHintSchema.safeParse(st.typing);
      const typing = parsedTyping.success ? parsedTyping.data : {};

      const requiredInputKeys = typing.requiredInputKeys ?? extractTopLevelRequiredKeys(inputSchema);
      const previewInputKeys = typing.previewInputKeys ?? buildPreviewKeys(inputSchema);
      const inputHint = typing.inputHint?.trim();
      const outputHint = typing.outputHint?.trim();

      const displayInput = inputHint && inputHint.length > 0
        ? inputHint
        : (Object.keys(inputSchema).length === 0
          ? "{}"
          : normalizeHint(jsonSchemaTypeHintFallback(inputSchema)));

      const displayOutput = outputHint && outputHint.length > 0
        ? outputHint
        : (Object.keys(outputSchema).length === 0
          ? "unknown"
          : normalizeHint(jsonSchemaTypeHintFallback(outputSchema)));

      const typedRef = st.typing?.typedRef && st.typing.typedRef.kind === "openapi_operation"
        ? {
            kind: "openapi_operation" as const,
            sourceKey: st.typing.typedRef.sourceKey,
            operationId: st.typing.typedRef.operationId,
          }
        : undefined;

      return {
        path: st.path,
        preferredPath,
        namespace,
        normalizedPath,
        aliases,
        description: st.description,
        approval: st.approval,
        source: st.source,
        searchText,
        displayInput,
        displayOutput,
        requiredInputKeys,
        previewInputKeys,
        typedRef,
        serializedToolJson: JSON.stringify(st),
      };
    });

    const filteredEntries = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const namespaceMap = new Map<string, { toolCount: number; samplePaths: string[] }>();
    for (const entry of filteredEntries) {
      const current = namespaceMap.get(entry.namespace) ?? { toolCount: 0, samplePaths: [] };
      current.toolCount += 1;
      if (current.samplePaths.length < 6) {
        current.samplePaths.push(entry.preferredPath);
      }
      namespaceMap.set(entry.namespace, current);
    }

    const namespaces = [...namespaceMap.entries()]
      .map(([namespace, meta]) => ({
        namespace,
        toolCount: meta.toolCount,
        samplePaths: [...meta.samplePaths].sort((a, b) => a.localeCompare(b)).slice(0, 3),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));

    const TOOL_BATCH = 100;
    for (let i = 0; i < filteredEntries.length; i += TOOL_BATCH) {
      await ctx.runMutation(internal.toolRegistry.putToolsBatch, {
        workspaceId: args.workspaceId,
        buildId,
        tools: filteredEntries.slice(i, i + TOOL_BATCH),
      });
    }

    const NS_BATCH = 100;
    for (let i = 0; i < namespaces.length; i += NS_BATCH) {
      await ctx.runMutation(internal.toolRegistry.putNamespacesBatch, {
        workspaceId: args.workspaceId,
        buildId,
        namespaces: namespaces.slice(i, i + NS_BATCH),
      });
    }

    await ctx.runMutation(internal.toolRegistry.finishBuild, {
      workspaceId: args.workspaceId,
      buildId,
      signature: args.registrySignature,
    });

    await ctx.runAction(internal.toolRegistry.pruneBuilds, {
      workspaceId: args.workspaceId,
      maxRetainedBuilds: 2,
    });

    return { buildId };
  } catch (error) {
    await ctx.runMutation(internal.toolRegistry.failBuild, {
      workspaceId: args.workspaceId,
      buildId,
    });
    throw error;
  }
}

// No implicit "ensure"/backfill on reads: the registry is built on writes.

export async function getWorkspaceTools(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  options: GetWorkspaceToolsOptions = {},
): Promise<WorkspaceToolsResult> {
  const startedAt = Date.now();
  const trace: string[] = [];
  const traceStep = (label: string, stepStartedAt: number) => {
    trace.push(`${label}=${Date.now() - stepStartedAt}ms`);
  };

  const listSourcesStartedAt = Date.now();
  const includeDts = true;
  const sourceTimeoutMs = options.sourceTimeoutMs;
  const accountId = options.accountId;
  const sources = (await listWorkspaceToolSources(ctx, workspaceId))
    .filter((source) => source.enabled);
  const skipCacheRead = options.skipCacheRead ?? false;
  traceStep("listToolSources", listSourcesStartedAt);
  const registrySignature = registrySignatureForWorkspace(workspaceId, sources);
  const debugBase: Omit<WorkspaceToolsDebug, "mode" | "normalizedSourceCount" | "cacheHit" | "cacheFresh" | "timedOutSources" | "durationMs" | "trace"> = {
      includeDts,
      sourceTimeoutMs: sourceTimeoutMs ?? null,
      skipCacheRead,
    sourceCount: sources.length,
  };

  if (skipCacheRead) {
    trace.push("cacheEntryLookup=skipped");
  }

  const configs: ExternalToolSourceConfig[] = [];
  const warnings: string[] = [];
  const normalizeSourcesStartedAt = Date.now();
  for (const source of sources) {
    const normalizedResult = normalizeExternalToolSource(source);
    if (normalizedResult.isErr()) {
      warnings.push(`Source '${source.name}': ${normalizedResult.error.message}`);
      continue;
    }
    configs.push(normalizedResult.value);
  }
  traceStep("normalizeSources", normalizeSourcesStartedAt);

  const loadSourcesStartedAt = Date.now();
  const loadedSources = await Promise.all(configs.map(async (config) => {
    if (!sourceTimeoutMs || sourceTimeoutMs <= 0) {
      return {
        ...(await loadSourceArtifact(ctx, config, { includeDts, workspaceId, accountId })),
        timedOut: false,
        sourceName: config.name,
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<{
      artifact?: CompiledToolSourceArtifact;
      warnings: string[];
      timedOut: boolean;
      sourceName: string;
      openApiDts?: string;
      openApiSourceKey?: string;
    }>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          artifact: undefined,
          warnings: [`Source '${config.name}' is still loading; showing partial results.`],
          timedOut: true,
          sourceName: config.name,
          openApiDts: undefined,
          openApiSourceKey: config.type === "openapi" ? (config.sourceKey ?? `openapi:${config.name}`) : undefined,
        });
      }, sourceTimeoutMs);
    });

    const loadResult = loadSourceArtifact(ctx, config, { includeDts, workspaceId, accountId })
      .then((result) => ({ ...result, timedOut: false, sourceName: config.name }));

    const result = await Promise.race([loadResult, timeoutResult]);
    if (timer && !result.timedOut) {
      clearTimeout(timer);
    }
    return result;
  }));
  traceStep("loadSources", loadSourcesStartedAt);
  const externalArtifacts = loadedSources
    .map((loaded) => loaded.artifact)
    .filter((artifact): artifact is CompiledToolSourceArtifact => Boolean(artifact));
  const externalTools = externalArtifacts.flatMap((artifact) => materializeCompiledToolSource(artifact));
  warnings.push(...loadedSources.flatMap((loaded) => loaded.warnings));
  const hasTimedOutSource = loadedSources.some((loaded) => loaded.timedOut);
  const timedOutSources = loadedSources
    .filter((loaded) => loaded.timedOut)
    .map((loaded) => loaded.sourceName);
  const merged = mergeTools(externalTools);

  let typesStorageId: Id<"_storage"> | undefined;
  try {
    if (hasTimedOutSource) {
      return {
        tools: merged,
        warnings,
        typesStorageId,
        debug: {
          ...debugBase,
          mode: "rebuild",
          normalizedSourceCount: configs.length,
          cacheHit: false,
          cacheFresh: null,
          timedOutSources,
          durationMs: Date.now() - startedAt,
          trace,
        },
      };
    }

    const allTools = [...merged.values()];

    // Build a per-tool registry for fast discover + invocation.
    const registryStartedAt = Date.now();
    const { buildId } = await buildWorkspaceToolRegistry(ctx, {
      workspaceId,
      registrySignature,
      serializedTools: externalArtifacts.flatMap((artifact) => artifact.tools),
    });
    traceStep("toolRegistryWrite", registryStartedAt);

    // Build and store a workspace-wide Monaco type bundle.
    const openApiDtsBySource: Record<string, string> = {};
    for (const loaded of loadedSources) {
      if (loaded.openApiDts && loaded.openApiDts.trim().length > 0) {
        const sourceKey = loaded.openApiSourceKey ?? `openapi:${loaded.sourceName}`;
        openApiDtsBySource[sourceKey] = loaded.openApiDts;
      }
    }
    const typeBundle = buildWorkspaceTypeBundle({
      tools: allTools,
      openApiDtsBySource,
    });
    const typesBlob = new Blob([typeBundle], { type: "text/plain" });
    typesStorageId = await ctx.storage.store(typesBlob);

    await ctx.runMutation(internal.toolRegistry.updateBuildMetadata, {
      workspaceId,
      buildId,
      typesStorageId,
      warnings,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[executor] workspace tool registry metadata write failed for '${workspaceId}': ${msg}`);
  }

  return {
    tools: merged,
    warnings,
    typesStorageId,
    debug: {
      ...debugBase,
      mode: "rebuild",
      normalizedSourceCount: configs.length,
      cacheHit: false,
      cacheFresh: null,
      timedOutSources,
      durationMs: Date.now() - startedAt,
      trace,
    },
  };
}

interface WorkspaceRegistryReadResult {
  sources: ToolSourceRecord[];
  registryTools: RegistryToolEntry[];
  warnings: string[];
  typesStorageId?: Id<"_storage">;
  debug: WorkspaceToolsDebug;
}

async function getWorkspaceToolsFromRegistry(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  options: { toolPaths?: string[] } = {},
): Promise<WorkspaceRegistryReadResult> {
  const startedAt = Date.now();
  const trace: string[] = [];
  const traceStep = (label: string, stepStartedAt: number) => {
    trace.push(`${label}=${Date.now() - stepStartedAt}ms`);
  };

  const sourcesStartedAt = Date.now();
  const includeDts = true;
  const sources = (await listWorkspaceToolSources(ctx, workspaceId))
    .filter((source) => source.enabled);
  traceStep("listToolSources", sourcesStartedAt);

  const expectedRegistrySignature = registrySignatureForWorkspace(workspaceId, sources);

  const debugBase: Omit<WorkspaceToolsDebug, "mode" | "normalizedSourceCount" | "cacheHit" | "cacheFresh" | "timedOutSources" | "durationMs" | "trace"> = {
    includeDts,
    sourceTimeoutMs: null,
    skipCacheRead: false,
    sourceCount: sources.length,
  };

  const stateLookupStartedAt = Date.now();
  const registryState: {
    signature?: string;
    readyBuildId?: string;
    buildingBuildId?: string;
    typesStorageId?: Id<"_storage">;
    warnings?: string[];
  } | null = await ctx.runQuery(internal.toolRegistry.getState, {
    workspaceId,
  });
  traceStep("registryStateLookup", stateLookupStartedAt);

  const readyBuildId = registryState?.readyBuildId;
  const building = Boolean(registryState?.buildingBuildId);
  const isFresh = Boolean(registryState?.signature && registryState.signature === expectedRegistrySignature && !building);
  const warnings: string[] = [...(registryState?.warnings ?? [])];
  const loadingSources: string[] = [];
  const sourceNames = sources.map((source) => source.name);

  if (!readyBuildId) {
    if (sourceNames.length > 0) {
      warnings.push("Tool inventory is still loading; showing partial results.");
      loadingSources.push(...sourceNames);
    }

    return {
      sources,
      registryTools: [],
      warnings,
      typesStorageId: registryState?.typesStorageId,
      debug: {
        ...debugBase,
        mode: "registry",
        normalizedSourceCount: sources.length,
        cacheHit: false,
        cacheFresh: isFresh,
        timedOutSources: loadingSources,
        durationMs: Date.now() - startedAt,
        trace,
      },
    };
  }

  const registryTools: RegistryToolEntry[] = [];
  const requestedPaths = [...new Set((options.toolPaths ?? []).map((path) => path.trim()).filter((path) => path.length > 0))];

  if (requestedPaths.length > 0) {
    const readStartedAt = Date.now();
    const entries = await Promise.all(requestedPaths.map(async (path) => {
      const entry = await ctx.runQuery(internal.toolRegistry.getToolByPath, {
        workspaceId,
        buildId: readyBuildId,
        path,
      });
      if (!entry) return null;
      return {
        path: entry.path,
        preferredPath: entry.preferredPath,
        aliases: entry.aliases,
        description: entry.description,
        approval: entry.approval,
        source: entry.source,
        displayInput: entry.displayInput,
        displayOutput: entry.displayOutput,
        requiredInputKeys: entry.requiredInputKeys,
        previewInputKeys: entry.previewInputKeys,
        typedRef: entry.typedRef,
      } as RegistryToolEntry;
    }));
    registryTools.push(...entries.filter((entry): entry is RegistryToolEntry => Boolean(entry)));
    traceStep("registryToolsByPath", readStartedAt);
  } else {
    const namespacesStartedAt = Date.now();
    const namespaces: Array<{ namespace: string; toolCount: number }> = await ctx.runQuery(internal.toolRegistry.listNamespaces, {
      workspaceId,
      buildId: readyBuildId,
      limit: 2_000,
    });
    traceStep("registryNamespaces", namespacesStartedAt);

    const toolsByNamespaceStartedAt = Date.now();
    const pages = await Promise.all(namespaces.map(async (namespace) => {
      return await ctx.runQuery(internal.toolRegistry.listToolsByNamespace, {
        workspaceId,
        buildId: readyBuildId,
        namespace: namespace.namespace,
        limit: Math.max(1, namespace.toolCount + 5),
      });
    }));
    for (const page of pages) {
      for (const entry of page) {
        registryTools.push({
          path: entry.path,
          preferredPath: entry.preferredPath,
          aliases: entry.aliases,
          description: entry.description,
          approval: entry.approval,
          source: entry.source,
          displayInput: entry.displayInput,
          displayOutput: entry.displayOutput,
          requiredInputKeys: entry.requiredInputKeys,
          previewInputKeys: entry.previewInputKeys,
          typedRef: entry.typedRef,
        });
      }
    }
    traceStep("registryToolsRead", toolsByNamespaceStartedAt);
  }

  const sourceNamesWithTools = new Set(
    registryTools
      .map((tool) => toSourceName(tool.source))
      .filter((sourceName): sourceName is string => Boolean(sourceName)),
  );
  const missingSourceNames = sourceNames.filter((sourceName) => !sourceNamesWithTools.has(sourceName));

  if (!isFresh) {
    warnings.push("Tool sources changed; showing previous results while refreshing.");
  }

  if (building || !isFresh) {
    for (const sourceName of missingSourceNames) {
      warnings.push(`Source '${sourceName}' is still loading; showing partial results.`);
      loadingSources.push(sourceName);
    }
  }

  return {
    sources,
    registryTools,
    warnings,
    typesStorageId: registryState?.typesStorageId,
    debug: {
      ...debugBase,
      mode: "registry",
      normalizedSourceCount: sources.length,
      cacheHit: true,
      cacheFresh: isFresh,
      timedOutSources: loadingSources,
      durationMs: Date.now() - startedAt,
      trace,
    },
  };
}

async function loadWorkspaceToolInventoryForContext(
  ctx: ActionCtx,
  context: { workspaceId: Id<"workspaces">; accountId?: Id<"accounts">; clientId?: string },
  options: {
    includeDetails?: boolean;
    includeSourceMeta?: boolean;
    toolPaths?: string[];
    sourceTimeoutMs?: number;
    allowStaleOnMismatch?: boolean;
    skipCacheRead?: boolean;
  } = {},
): Promise<WorkspaceToolInventory> {
  const includeDetails = options.includeDetails ?? true;
  const includeSourceMeta = options.includeSourceMeta ?? true;
  const [result, policies] = await Promise.all([
    getWorkspaceToolsFromRegistry(ctx, context.workspaceId, { toolPaths: options.toolPaths }),
    listWorkspaceAccessPolicies(ctx, context.workspaceId, context.accountId),
  ]);
  const descriptorStartedAt = Date.now();
  const baseDescriptors = listVisibleToolDescriptors(baseTools, context, policies, {
    includeDetails,
    toolPaths: options.toolPaths,
  });
  const registryDescriptors = listVisibleRegistryToolDescriptors(result.registryTools, context, policies, {
    includeDetails,
    toolPaths: options.toolPaths,
  });
  const toolsByPath = new Map<string, ToolDescriptor>();
  for (const tool of baseDescriptors) toolsByPath.set(tool.path, tool);
  for (const tool of registryDescriptors) toolsByPath.set(tool.path, tool);
  const tools = [...toolsByPath.values()];
  const descriptorsMs = Date.now() - descriptorStartedAt;

  let sourceQuality: Record<string, OpenApiSourceQuality> = {};
  let sourceAuthProfiles: Record<string, SourceAuthProfile> = {};
  let qualityMs = 0;
  let authProfilesMs = 0;

  if (includeSourceMeta) {
    const qualityStartedAt = Date.now();
    sourceQuality = computeOpenApiSourceQualityFromDescriptors(
      result.registryTools.map((entry) => toDescriptorFromRegistryEntry(entry, { includeDetails: true })),
    );
    qualityMs = Date.now() - qualityStartedAt;
    const authProfilesStartedAt = Date.now();
    sourceAuthProfiles = computeSourceAuthProfilesFromSources(result.sources);
    authProfilesMs = Date.now() - authProfilesStartedAt;
  }

  const sourceMetaTrace = includeSourceMeta
    ? [
        `computeOpenApiSourceQuality=${qualityMs}ms`,
        `computeSourceAuthProfiles=${authProfilesMs}ms`,
      ]
    : ["sourceMeta=skipped"];

  let typesUrl: string | undefined;
  if (result.typesStorageId) {
    try {
      typesUrl = await ctx.storage.getUrl(result.typesStorageId) ?? undefined;
    } catch {
      typesUrl = undefined;
    }
  }

  const { tools: boundedTools, warnings: boundedWarnings } = truncateToolsForActionResult(
    tools,
    result.warnings,
  );

  return {
    tools: boundedTools,
    warnings: boundedWarnings,
    typesUrl,
    sourceQuality,
    sourceAuthProfiles,
    debug: {
      ...result.debug,
      trace: [
        ...result.debug.trace,
        `listVisibleToolDescriptors=${descriptorsMs}ms`,
        ...sourceMetaTrace,
      ],
    },
  };
}

export async function listToolsForContext(
  ctx: ActionCtx,
  context: { workspaceId: Id<"workspaces">; accountId?: Id<"accounts">; clientId?: string },
  options: {
    includeDetails?: boolean;
    includeSourceMeta?: boolean;
    toolPaths?: string[];
    sourceTimeoutMs?: number;
    allowStaleOnMismatch?: boolean;
    skipCacheRead?: boolean;
  } = {},
): Promise<ToolDescriptor[]> {
  const inventory = await loadWorkspaceToolInventoryForContext(ctx, context, {
    ...options,
    includeSourceMeta: options.includeSourceMeta ?? false,
  });
  return inventory.tools;
}

export async function rebuildWorkspaceToolInventoryForContext(
  ctx: ActionCtx,
  context: { workspaceId: Id<"workspaces">; accountId?: Id<"accounts">; clientId?: string },
): Promise<WorkspaceToolsResult> {
  return await getWorkspaceTools(ctx, context.workspaceId, {
    accountId: context.accountId,
    sourceTimeoutMs: 20_000,
    allowStaleOnMismatch: false,
    skipCacheRead: false,
  });
}

export async function listToolsWithWarningsForContext(
  ctx: ActionCtx,
  context: { workspaceId: Id<"workspaces">; accountId?: Id<"accounts">; clientId?: string },
  options: {
    includeDetails?: boolean;
    includeSourceMeta?: boolean;
    toolPaths?: string[];
    sourceTimeoutMs?: number;
    allowStaleOnMismatch?: boolean;
    skipCacheRead?: boolean;
  } = {},
): Promise<{
  tools: ToolDescriptor[];
  warnings: string[];
  typesUrl?: string;
  sourceQuality: Record<string, OpenApiSourceQuality>;
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  debug: WorkspaceToolsDebug;
}> {
  const inventory = await loadWorkspaceToolInventoryForContext(ctx, context, options);
  return {
    tools: inventory.tools,
    warnings: inventory.warnings,
    typesUrl: inventory.typesUrl,
    sourceQuality: inventory.sourceQuality,
    sourceAuthProfiles: inventory.sourceAuthProfiles,
    debug: inventory.debug,
  };
}

export { baseTools };

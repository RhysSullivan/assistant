import {
  type SourceStore,
  type SourceStoreError,
  type ToolArtifactStore,
  type ToolArtifactStoreError,
} from "@executor-v2/persistence-ports";
import {
  OpenApiToolManifestSchema,
  type CanonicalToolDescriptor,
  type DiscoveryTypingPayload,
  type Source,
  type WorkspaceId,
} from "@executor-v2/schema";
import type { RuntimeToolCallResult } from "@executor-v2/sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { openApiToolDescriptorsFromManifest } from "./openapi-provider";
import {
  RuntimeAdapterError,
  type RuntimeAdapterKind,
} from "./runtime-adapters";
import type {
  ToolProviderError,
  ToolProviderRegistry,
  ToolProviderRegistryError,
} from "./tool-providers";
import type {
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalRequest,
  ToolRegistry,
  ToolRegistryCatalogNamespacesInput,
  ToolRegistryCatalogNamespacesOutput,
  ToolRegistryCatalogToolsInput,
  ToolRegistryCatalogToolsOutput,
  ToolRegistryCallInput,
  ToolRegistryDiscoverInput,
  ToolRegistryDiscoverOutput,
  ToolRegistryToolSummary,
} from "./tool-registry";

const sourceToolRegistryRuntimeKind: RuntimeAdapterKind = "source-tool-registry";

type SourceToolRegistryOptions = {
  workspaceId: string;
  sourceStore: SourceStore;
  toolArtifactStore: ToolArtifactStore;
  toolProviderRegistry: ToolProviderRegistry;
  approvalPolicy?: ToolApprovalPolicy;
};

type SourceToolEntry = {
  path: string;
  namespace: string;
  source: Source;
  descriptor: CanonicalToolDescriptor;
  typing?: DiscoveryTypingPayload;
};

type SourceToolSnapshot = {
  entries: ReadonlyArray<SourceToolEntry>;
  refHintTable: Record<string, string>;
};

const decodeOpenApiManifestJson = Schema.decodeUnknown(
  Schema.parseJson(OpenApiToolManifestSchema),
);

const toRuntimeAdapterError = (
  operation: string,
  message: string,
  details: string | null,
): RuntimeAdapterError =>
  new RuntimeAdapterError({
    operation,
    runtimeKind: sourceToolRegistryRuntimeKind,
    message,
    details,
  });

const defaultPendingRetryAfterMs = 1_000;
const maxCatalogNamespacesLimit = 5_000;
const maxCatalogToolsLimit = 50_000;
const maxUnknownToolSuggestions = 3;

const normalizePendingRetryAfterMs = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return defaultPendingRetryAfterMs;
  }

  return Math.round(value);
};

const normalizeDeniedError = (value: string | undefined, toolPath: string): string => {
  const normalized = value?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return `Tool call denied: ${toolPath}`;
};

const evaluateToolApproval = (
  request: ToolApprovalRequest,
  policy: ToolApprovalPolicy | undefined,
): Effect.Effect<ToolApprovalDecision, RuntimeAdapterError> => {
  if (!policy) {
    return Effect.succeed({ kind: "approved" });
  }

  return Effect.tryPromise({
    try: () => Promise.resolve(policy.evaluate(request)),
    catch: (cause) =>
      toRuntimeAdapterError(
        "evaluate_approval",
        `Tool approval evaluation failed: ${request.toolPath}`,
        String(cause),
      ),
  });
};

const toToolCallResultFromDecision = (
  decision: ToolApprovalDecision,
  request: ToolApprovalRequest,
): RuntimeToolCallResult => {
  if (decision.kind === "approved") {
    return {
      ok: true,
      value: undefined,
    };
  }

  if (decision.kind === "pending") {
    return {
      ok: false,
      kind: "pending",
      approvalId: decision.approvalId,
      retryAfterMs: normalizePendingRetryAfterMs(decision.retryAfterMs),
      error: decision.error,
    };
  }

  return {
    ok: false,
    kind: "denied",
    error: normalizeDeniedError(decision.error, request.toolPath),
  };
};

const sourceStoreErrorToRuntimeAdapterError = (
  operation: string,
  cause: SourceStoreError,
): RuntimeAdapterError =>
  toRuntimeAdapterError(
    operation,
    cause.message,
    cause.details ?? cause.reason ?? cause.location,
  );

const toolArtifactStoreErrorToRuntimeAdapterError = (
  operation: string,
  cause: ToolArtifactStoreError,
): RuntimeAdapterError =>
  toRuntimeAdapterError(
    operation,
    cause.message,
    cause.details ?? cause.reason ?? cause.location,
  );

const toolProviderErrorToRuntimeAdapterError = (
  operation: string,
  cause: ToolProviderError,
): RuntimeAdapterError =>
  toRuntimeAdapterError(operation, cause.message, cause.details ?? null);

const toolProviderRegistryErrorToRuntimeAdapterError = (
  operation: string,
  cause: ToolProviderRegistryError,
): RuntimeAdapterError =>
  toRuntimeAdapterError(operation, cause.message, null);

const normalizeNamespacePart = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

const sourceNamespace = (source: Source): string => {
  const sourceIdSuffix = source.id.slice(-6).toLowerCase();
  return `${normalizeNamespacePart(source.name)}_${sourceIdSuffix}`;
};

const sourceToolPath = (
  source: Source,
  descriptor: CanonicalToolDescriptor,
): string => `${sourceNamespace(source)}.${descriptor.toolId}`;

const describeSource = (source: Source): string => {
  const kind = source.kind.toUpperCase();
  return `${kind} source at ${source.endpoint}`;
};

const normalizeToolPathForLookup = (path: string): string =>
  path
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length] ?? right.length;
};

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const deriveHintFromSchemaJson = (
  schemaJson: string | undefined,
  fallback: string,
): string => {
  if (!schemaJson) {
    return fallback;
  }

  const schema = parseJson(schemaJson);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return fallback;
  }

  const schemaRecord = schema as Record<string, unknown>;
  const title = schemaRecord.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }

  const type = schemaRecord.type;
  if (type === "object") {
    const properties = schemaRecord.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      const keys = Object.keys(properties);
      if (keys.length > 0) {
        const shown = keys.slice(0, 3).join(", ");
        return keys.length <= 3
          ? `object { ${shown} }`
          : `object { ${shown}, ... }`;
      }
    }

    return "object";
  }

  if (type === "array") {
    return "array";
  }

  if (typeof type === "string") {
    return type;
  }

  return fallback;
};

const scoreSummary = (
  summary: ToolRegistryToolSummary,
  query: string,
): number => {
  if (query.length === 0) {
    return 1;
  }

  const lowerQuery = query.toLowerCase();
  const lowerPath = summary.path.toLowerCase();
  const lowerSource = (summary.source ?? "").toLowerCase();
  const lowerDescription = (summary.description ?? "").toLowerCase();
  const lowerInputHint = (summary.inputHint ?? "").toLowerCase();
  const lowerOutputHint = (summary.outputHint ?? "").toLowerCase();

  if (lowerPath === lowerQuery) {
    return 100;
  }

  if (lowerPath.startsWith(lowerQuery)) {
    return 80;
  }

  if (lowerPath.includes(lowerQuery)) {
    return 60;
  }

  if (lowerSource.includes(lowerQuery)) {
    return 40;
  }

  if (lowerDescription.includes(lowerQuery)) {
    return 30;
  }

  if (lowerInputHint.includes(lowerQuery) || lowerOutputHint.includes(lowerQuery)) {
    return 20;
  }

  return 0;
};

const summarizeEntry = (
  entry: SourceToolEntry,
  includeSchemas: boolean,
  compact: boolean,
): ToolRegistryToolSummary => ({
  path: entry.path,
  source: entry.source.name,
  approval: "auto",
  description: compact ? undefined : entry.descriptor.description ?? undefined,
  inputHint: compact
    ? undefined
    : deriveHintFromSchemaJson(entry.typing?.inputSchemaJson, "input"),
  outputHint: compact
    ? undefined
    : deriveHintFromSchemaJson(entry.typing?.outputSchemaJson, "output"),
  typing: includeSchemas ? entry.typing : undefined,
});

const collectRequestedRefKeys = (
  results: ReadonlyArray<ToolRegistryToolSummary>,
): Array<string> => {
  const keys = new Set<string>();

  for (const result of results) {
    for (const key of result.typing?.refHintKeys ?? []) {
      keys.add(key);
    }
  }

  return [...keys].sort();
};

const pickRefHintTable = (
  snapshot: SourceToolSnapshot,
  results: ReadonlyArray<ToolRegistryToolSummary>,
  includeSchemas: boolean,
): Record<string, string> | undefined => {
  if (!includeSchemas) {
    return undefined;
  }

  const requestedKeys = collectRequestedRefKeys(results);
  if (requestedKeys.length === 0) {
    return undefined;
  }

  const selected: Record<string, string> = {};

  for (const key of requestedKeys) {
    const value = snapshot.refHintTable[key];
    if (value !== undefined) {
      selected[key] = value;
    }
  }

  return Object.keys(selected).length > 0 ? selected : undefined;
};

const normalizeToolCallInput = (
  input: unknown,
): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as Record<string, unknown>;
};

const describeOutput = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

type SourceToolResolution = {
  entry: SourceToolEntry | null;
  suggestions: Array<string>;
};

const uniquePaths = (paths: ReadonlyArray<string>): Array<string> => {
  const seen = new Set<string>();
  const ordered: Array<string> = [];

  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }

    if (ordered.length >= maxUnknownToolSuggestions) {
      break;
    }
  }

  return ordered;
};

const suggestSourceToolPaths = (
  entries: ReadonlyArray<SourceToolEntry>,
  requestedPath: string,
): Array<string> => {
  const lowerRequested = requestedPath.toLowerCase();
  const normalizedRequested = normalizeToolPathForLookup(requestedPath);

  const directMatches = entries
    .map((entry) => entry.path)
    .filter((path) => {
      const lowerPath = path.toLowerCase();
      if (lowerPath.startsWith(lowerRequested) || lowerPath.includes(lowerRequested)) {
        return true;
      }

      const normalizedPath = normalizeToolPathForLookup(path);
      return (
        normalizedPath.startsWith(normalizedRequested) ||
        normalizedPath.includes(normalizedRequested)
      );
    })
    .sort((left, right) => left.localeCompare(right));

  if (directMatches.length > 0) {
    return uniquePaths(directMatches);
  }

  const distanceCandidates = entries
    .map((entry) => ({
      path: entry.path,
      distance: levenshteinDistance(entry.path.toLowerCase(), lowerRequested),
    }))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.path.localeCompare(right.path);
    })
    .slice(0, maxUnknownToolSuggestions)
    .map((candidate) => candidate.path);

  return uniquePaths(distanceCandidates);
};

const resolveSourceToolPath = (
  snapshot: SourceToolSnapshot,
  requestedPath: string,
): SourceToolResolution => {
  const trimmedPath = requestedPath.trim();
  if (trimmedPath.length === 0) {
    return {
      entry: null,
      suggestions: [],
    };
  }

  const exact = snapshot.entries.find((entry) => entry.path === trimmedPath);
  if (exact) {
    return {
      entry: exact,
      suggestions: [],
    };
  }

  const lowerRequested = trimmedPath.toLowerCase();
  const lowerMatch = snapshot.entries.find(
    (entry) => entry.path.toLowerCase() === lowerRequested,
  );
  if (lowerMatch) {
    return {
      entry: lowerMatch,
      suggestions: [],
    };
  }

  const normalizedRequested = normalizeToolPathForLookup(trimmedPath);
  const normalizedMatches = snapshot.entries.filter(
    (entry) => normalizeToolPathForLookup(entry.path) === normalizedRequested,
  );
  if (normalizedMatches.length === 1) {
    return {
      entry: normalizedMatches[0] ?? null,
      suggestions: [],
    };
  }

  if (normalizedMatches.length > 1) {
    const preferred = [...normalizedMatches].sort((left, right) => {
      if (left.path.length !== right.path.length) {
        return left.path.length - right.path.length;
      }

      return left.path.localeCompare(right.path);
    })[0];

    return {
      entry: preferred ?? null,
      suggestions: [],
    };
  }

  const closest = snapshot.entries
    .map((entry) => ({
      entry,
      distance: levenshteinDistance(entry.path.toLowerCase(), lowerRequested),
    }))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.entry.path.localeCompare(right.entry.path);
    })[0];

  const maxDistance = Math.max(2, Math.floor(trimmedPath.length * 0.2));
  if (closest && closest.distance <= maxDistance) {
    return {
      entry: closest.entry,
      suggestions: [],
    };
  }

  return {
    entry: null,
    suggestions: suggestSourceToolPaths(snapshot.entries, trimmedPath),
  };
};

const unknownToolPathErrorMessage = (
  requestedPath: string,
  suggestions: ReadonlyArray<string>,
): string => {
  const hintQuery = requestedPath.trim().length > 0 ? requestedPath.trim() : "tool";
  const suggestionText =
    suggestions.length > 0
      ? ` Did you mean: ${suggestions.join(", ")}.`
      : "";

  return `Unknown tool path: ${requestedPath}.${suggestionText} Use tools.discover({ query: ${JSON.stringify(
    hintQuery,
  )} }) or tools.catalog.tools({ query: ${JSON.stringify(hintQuery)} }) to find available tool paths.`;
};

const loadSourceEntries = (
  options: SourceToolRegistryOptions,
): Effect.Effect<SourceToolSnapshot, RuntimeAdapterError> =>
  Effect.gen(function* () {
    const workspaceSources = yield* options.sourceStore
      .listByWorkspace(options.workspaceId as WorkspaceId)
      .pipe(
        Effect.mapError((cause) =>
          sourceStoreErrorToRuntimeAdapterError("list_sources", cause),
        ),
      );

    const enabledSources = workspaceSources.filter((source) => source.enabled);

    const loadedPerSource = yield* Effect.forEach(enabledSources, (source) =>
      Effect.gen(function* () {
        const namespace = sourceNamespace(source);

        if (source.kind === "openapi") {
          const providerDiscovered = yield* options.toolProviderRegistry
            .discoverFromSource(source)
            .pipe(Effect.either);

          if (providerDiscovered._tag === "Right") {
            return {
              entries: providerDiscovered.right.tools.map((descriptor) => ({
                path: sourceToolPath(source, descriptor),
                namespace,
                source,
                descriptor,
              })),
              refHintTable: {},
            };
          }

          const artifactOption = yield* options.toolArtifactStore
            .getBySource(source.workspaceId, source.id)
            .pipe(
              Effect.mapError((cause) =>
                toolArtifactStoreErrorToRuntimeAdapterError(
                  "get_source_artifact",
                  cause,
                ),
              ),
            );

          if (Option.isNone(artifactOption)) {
            return {
              entries: [] as Array<SourceToolEntry>,
              refHintTable: {} as Record<string, string>,
            };
          }

          const artifact = artifactOption.value;
          const manifest = yield* decodeOpenApiManifestJson(artifact.manifestJson).pipe(
            Effect.mapError((cause) =>
              toRuntimeAdapterError(
                "decode_source_manifest",
                "Failed to decode OpenAPI manifest JSON",
                String(cause),
              ),
            ),
          );

          const descriptors = yield* openApiToolDescriptorsFromManifest(
            source,
            artifact.manifestJson,
          ).pipe(
            Effect.mapError((cause) =>
              toolProviderErrorToRuntimeAdapterError("decode_source_manifest", cause),
            ),
          );

          const toolTypingById = new Map(
            manifest.tools.map((tool) => [tool.toolId, tool.typing] as const),
          );

          return {
            entries: descriptors.map((descriptor) => ({
              path: sourceToolPath(source, descriptor),
              namespace,
              source,
              descriptor,
              typing: toolTypingById.get(descriptor.toolId),
            })),
            refHintTable: manifest.refHintTable ?? {},
          };
        }

        const discovered = yield* options.toolProviderRegistry
          .discoverFromSource(source)
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "ToolProviderError"
                ? toolProviderErrorToRuntimeAdapterError(
                    "discover_source_tools",
                    cause,
                  )
                : toolProviderRegistryErrorToRuntimeAdapterError(
                    "discover_source_tools",
                    cause,
                  ),
            ),
            Effect.either,
          );

        if (discovered._tag === "Left") {
          return {
            entries: [] as Array<SourceToolEntry>,
            refHintTable: {} as Record<string, string>,
          };
        }

        return {
          entries: discovered.right.tools.map((descriptor) => ({
            path: sourceToolPath(source, descriptor),
            namespace,
            source,
            descriptor,
          })),
          refHintTable: {} as Record<string, string>,
        };
      }),
    );

    const entries = loadedPerSource.flatMap((entry) => entry.entries);
    const refHintTable: Record<string, string> = {};

    for (const entry of loadedPerSource) {
      Object.assign(refHintTable, entry.refHintTable);
    }

    return {
      entries,
      refHintTable,
    };
  });

const discoverTools = (
  snapshot: SourceToolSnapshot,
  input: ToolRegistryDiscoverInput,
): ToolRegistryDiscoverOutput => {
  const limit = Math.max(1, Math.min(50, input.limit ?? 8));
  const query = (input.query ?? "").trim().toLowerCase();
  const includeSchemas = input.includeSchemas === true;
  const compact = input.compact === true;

  const ranked = snapshot.entries
    .map((entry) => summarizeEntry(entry, includeSchemas, compact))
    .map((summary) => ({
      summary,
      score: scoreSummary(summary, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.summary);

  return {
    bestPath: ranked[0]?.path ?? null,
    results: ranked,
    total: ranked.length,
    refHintTable: pickRefHintTable(snapshot, ranked, includeSchemas),
  };
};

const catalogNamespaces = (
  snapshot: SourceToolSnapshot,
  input: ToolRegistryCatalogNamespacesInput,
): ToolRegistryCatalogNamespacesOutput => {
  const limit = Math.max(1, Math.min(maxCatalogNamespacesLimit, input.limit ?? 50));
  const grouped = new Map<
    string,
    {
      paths: Array<string>;
      source: Source;
    }
  >();

  for (const entry of snapshot.entries) {
    const existing = grouped.get(entry.namespace);
    if (existing) {
      existing.paths.push(entry.path);
      continue;
    }

    grouped.set(entry.namespace, {
      paths: [entry.path],
      source: entry.source,
    });
  }

  const namespaces = [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([namespace, value]) => ({
      namespace,
      toolCount: value.paths.length,
      samplePaths: [...value.paths]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 3),
      source: value.source.name,
      sourceKey: value.source.id,
      description: describeSource(value.source),
    }));

  return {
    namespaces: namespaces.slice(0, limit),
    total: namespaces.length,
  };
};

const catalogTools = (
  snapshot: SourceToolSnapshot,
  input: ToolRegistryCatalogToolsInput,
): ToolRegistryCatalogToolsOutput => {
  const limit = Math.max(1, Math.min(maxCatalogToolsLimit, input.limit ?? 50));
  const query = (input.query ?? "").trim().toLowerCase();
  const namespace = (input.namespace ?? "").trim().toLowerCase();
  const includeSchemas = input.includeSchemas === true;
  const compact = input.compact === true;

  const filtered = snapshot.entries
    .filter((entry) =>
      namespace.length === 0 ? true : entry.namespace.toLowerCase() === namespace,
    )
    .map((entry) => summarizeEntry(entry, includeSchemas, compact))
    .filter((summary) => scoreSummary(summary, query) > 0)
    .slice(0, limit);

  return {
    results: filtered,
    total: filtered.length,
    refHintTable: pickRefHintTable(snapshot, filtered, includeSchemas),
  };
};

export const createSourceToolRegistry = (
  options: SourceToolRegistryOptions,
): ToolRegistry => ({
  callTool: (input: ToolRegistryCallInput) =>
    Effect.gen(function* () {
      const snapshot = yield* loadSourceEntries(options);
      const resolved = resolveSourceToolPath(snapshot, input.toolPath);
      const entry = resolved.entry;

      if (!entry) {
        return {
          ok: false,
          kind: "failed",
          error: unknownToolPathErrorMessage(input.toolPath, resolved.suggestions),
        } satisfies RuntimeToolCallResult;
      }

      const approvalRequest: ToolApprovalRequest = {
        runId: input.runId,
        callId: input.callId,
        toolPath: entry.path,
        input: normalizeToolCallInput(input.input),
        workspaceId: options.workspaceId,
        source: entry.source.name,
        defaultMode: "auto",
      };

      const approvalDecision = yield* evaluateToolApproval(
        approvalRequest,
        options.approvalPolicy,
      );

      if (approvalDecision.kind !== "approved") {
        return toToolCallResultFromDecision(approvalDecision, approvalRequest);
      }

      const invocation = yield* options.toolProviderRegistry
        .invoke({
          source: entry.source,
          tool: entry.descriptor,
          args: approvalRequest.input ?? {},
        })
        .pipe(
          Effect.mapError((cause) =>
            cause._tag === "ToolProviderError"
              ? toolProviderErrorToRuntimeAdapterError("invoke_tool", cause)
              : toolProviderRegistryErrorToRuntimeAdapterError("invoke_tool", cause),
          ),
        );

      if (invocation.isError) {
        return {
          ok: false,
          kind: "failed",
          error: describeOutput(invocation.output),
        } satisfies RuntimeToolCallResult;
      }

      return {
        ok: true,
        value: invocation.output,
      } satisfies RuntimeToolCallResult;
    }),

  discover: (input: ToolRegistryDiscoverInput) =>
    loadSourceEntries(options).pipe(
      Effect.map((snapshot) => discoverTools(snapshot, input)),
    ),

  catalogNamespaces: (input: ToolRegistryCatalogNamespacesInput) =>
    loadSourceEntries(options).pipe(
      Effect.map((snapshot) => catalogNamespaces(snapshot, input)),
    ),

  catalogTools: (input: ToolRegistryCatalogToolsInput) =>
    loadSourceEntries(options).pipe(
      Effect.map((snapshot) => catalogTools(snapshot, input)),
    ),
});

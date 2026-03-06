import {
  type ToolMap,
  createToolCatalogFromTools,
  createSystemToolMap,
  makeToolInvokerFromTools,
  mergeToolMaps,
} from "@executor-v3/codemode-core";
import {
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
} from "@executor-v3/codemode-mcp";
import {
  createOpenApiToolsFromSpec,
  fetchOpenApiDocument,
} from "@executor-v3/codemode-openapi";
import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";
import { type SqlControlPlaneRows } from "#persistence";
import type {
  Source,
} from "#schema";
import * as Effect from "effect/Effect";

import type {
  ExecutionEnvironment,
  ResolveExecutionEnvironment,
} from "./execution-state";
import { createExecutorToolMap } from "./executor-tools";
import { projectSourcesFromStorage } from "./source-definitions";
import {
  createDbBackedSecretMaterialResolver,
  type ResolveSecretMaterial,
  type RuntimeSourceAuthService,
} from "./source-auth-service";

export type ResolvedSourceAuthMaterial = {
  headers: Readonly<Record<string, string>>;
};

const namespaceFromSourceName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

export const createEnvSecretMaterialResolver = (): ResolveSecretMaterial =>
  (ref) =>
    Effect.gen(function* () {
      if (ref.providerId !== "env") {
        return yield* Effect.fail(
          new Error(`Unsupported secret provider ${ref.providerId}`),
        );
      }

      const value = process.env[ref.handle]?.trim();
      if (!value) {
        return yield* Effect.fail(
          new Error(`Environment variable ${ref.handle} is not set`),
        );
      }

      return value;
    });

export const resolveSourceAuthMaterial = (input: {
  source: Source;
  resolveSecretMaterial: ResolveSecretMaterial;
}): Effect.Effect<ResolvedSourceAuthMaterial, Error, never> =>
  Effect.gen(function* () {
    if (input.source.auth.kind === "none") {
      return { headers: {} } satisfies ResolvedSourceAuthMaterial;
    }

    const tokenRef =
      input.source.auth.kind === "bearer"
        ? input.source.auth.token
        : input.source.auth.accessToken;

    const token = yield* input.resolveSecretMaterial(tokenRef);

    return {
      headers: {
        [input.source.auth.headerName]: `${input.source.auth.prefix}${token}`,
      },
    } satisfies ResolvedSourceAuthMaterial;
  });

const loadMcpSourceTools = (input: {
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<ToolMap, Error, never> =>
  Effect.gen(function* () {
    if (input.source.kind !== "mcp") {
      return yield* Effect.fail(new Error(`Expected MCP source, received ${input.source.kind}`));
    }

    const connector = yield* Effect.try({
      try: () =>
        createSdkMcpConnector({
          endpoint: input.source.endpoint,
          transport: input.source.transport ?? undefined,
          queryParams: input.source.queryParams ?? undefined,
          headers: {
            ...(input.source.headers ?? {}),
            ...input.auth.headers,
          },
        }),
      catch: (cause) =>
        cause instanceof Error
          ? new Error(
              `Failed creating MCP connector for ${input.source.id}: ${cause.message}`,
            )
          : new Error(`Failed creating MCP connector for ${input.source.id}: ${String(cause)}`),
    });

    const discovered = yield* discoverMcpToolsFromConnector({
      connect: connector,
      namespace: input.source.namespace ?? namespaceFromSourceName(input.source.name),
      sourceKey: input.source.id,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new Error(
            `Failed discovering MCP tools for ${input.source.id}: ${cause.message}`,
          ),
      ),
    );

    return discovered.tools;
  });

const loadOpenApiSourceTools = (input: {
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<ToolMap, Error, never> =>
  Effect.gen(function* () {
    if (input.source.kind !== "openapi") {
      return yield* Effect.fail(
        new Error(`Expected OpenAPI source, received ${input.source.kind}`),
      );
    }

    if (!input.source.specUrl) {
      return yield* Effect.fail(
        new Error(`Missing OpenAPI specUrl for source ${input.source.id}`),
      );
    }

    const openApiDocument = yield* Effect.tryPromise({
      try: () => fetchOpenApiDocument(input.source.specUrl!),
      catch: (cause) =>
        cause instanceof Error
          ? new Error(
              `Failed fetching OpenAPI spec for ${input.source.id}: ${cause.message}`,
            )
          : new Error(`Failed fetching OpenAPI spec for ${input.source.id}: ${String(cause)}`),
    });

    const extracted = yield* createOpenApiToolsFromSpec({
      sourceName: input.source.name,
      openApiSpec: openApiDocument,
      baseUrl: input.source.endpoint,
      namespace: input.source.namespace ?? namespaceFromSourceName(input.source.name),
      sourceKey: input.source.id,
      defaultHeaders: input.source.defaultHeaders ?? {},
      credentialHeaders: input.auth.headers,
    }).pipe(
      Effect.mapError(
        (cause: unknown) =>
          new Error(
            `Failed loading OpenAPI tools for ${input.source.id}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          ),
      ),
    );

    return extracted.tools;
  });

const loadSourceTools = (input: {
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<ToolMap, Error, never> => {
  if (input.source.kind === "mcp") {
    return loadMcpSourceTools({
      source: input.source,
      auth: input.auth,
    });
  }

  if (input.source.kind === "openapi") {
    return loadOpenApiSourceTools({
      source: input.source,
      auth: input.auth,
    });
  }

  return Effect.succeed({});
};

export const createWorkspaceExecutionEnvironmentResolver = (input: {
  rows: SqlControlPlaneRows;
  resolveSecretMaterial?: ResolveSecretMaterial;
  sourceAuthService: RuntimeSourceAuthService;
}): ResolveExecutionEnvironment => {
  const resolveSecretMaterial =
    input.resolveSecretMaterial
    ?? createDbBackedSecretMaterialResolver({
      rows: input.rows,
      fallback: createEnvSecretMaterialResolver(),
    });

  return ({ workspaceId, onElicitation }) =>
    Effect.gen(function* () {
      const sourceRecords = yield* input.rows.sources.listByWorkspaceId(workspaceId).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
      const credentialBindings = yield* input.rows.sourceCredentialBindings
        .listByWorkspaceId(workspaceId)
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        );

      const sources = yield* projectSourcesFromStorage({
        sourceRecords,
        credentialBindings,
      });
      const enabledSources = sources.filter(
        (source) => source.enabled && source.status === "connected",
      );

      const discoveredToolMaps = yield* Effect.forEach(
        enabledSources,
        (source) =>
          Effect.gen(function* () {
            const auth = yield* resolveSourceAuthMaterial({
              source,
              resolveSecretMaterial,
            });
            return yield* loadSourceTools({
              source,
              auth,
            });
          }),
        { concurrency: "unbounded" },
      );

      const executorTools = createExecutorToolMap({
        workspaceId,
        sourceAuthService: input.sourceAuthService,
      });

      const sourceTools = yield* Effect.try({
        try: () =>
          mergeToolMaps([...discoveredToolMaps, executorTools], {
            conflictMode: "throw",
          }),
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Failed merging discovered source tools: ${cause.message}`)
            : new Error(`Failed merging discovered source tools: ${String(cause)}`),
      });
      const catalog = yield* Effect.try({
        try: () => createToolCatalogFromTools({ tools: sourceTools }),
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Failed creating tool catalog from source tools: ${cause.message}`)
            : new Error(`Failed creating tool catalog from source tools: ${String(cause)}`),
      });
      const allTools = yield* Effect.try({
        try: () => mergeToolMaps([sourceTools, createSystemToolMap({ catalog })]),
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Failed creating source execution tool map: ${cause.message}`)
            : new Error(`Failed creating source execution tool map: ${String(cause)}`),
      });

      return {
        executor: makeInProcessExecutor(),
        toolInvoker: makeToolInvokerFromTools({
          tools: allTools,
          onElicitation,
        }),
        catalog,
      } satisfies ExecutionEnvironment;
    });
};

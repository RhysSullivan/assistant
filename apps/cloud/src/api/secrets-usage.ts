import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { addGroup, capture, InternalError } from "@executor/api";
import { ExecutorService } from "@executor/api/server";
import { SecretsUsageApi, type SecretUsage } from "@executor/react/api/secrets-usage";
import { OpenApiExtensionService } from "@executor/plugin-openapi/api";
import { McpExtensionService } from "@executor/plugin-mcp/api";
import { GraphqlExtensionService } from "@executor/plugin-graphql/api";
import {
  collectOpenApiSecretIds,
  type OpenApiPluginExtension,
} from "@executor/plugin-openapi";
import { collectMcpSecretIds, type McpPluginExtension } from "@executor/plugin-mcp";
import {
  collectGraphqlSecretIds,
  type GraphqlPluginExtension,
} from "@executor/plugin-graphql";

type UsageSource = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly pluginId: string;
};

const sortUsage = (usedBy: readonly SecretUsage[]): readonly SecretUsage[] =>
  [...usedBy].sort((left, right) => left.sourceName.localeCompare(right.sourceName));

const addUsage = (
  usageIndex: Map<string, Map<string, SecretUsage>>,
  secretId: string,
  usage: SecretUsage,
) => {
  const entries = usageIndex.get(secretId) ?? new Map<string, SecretUsage>();
  entries.set(usage.sourceId, usage);
  usageIndex.set(secretId, entries);
};

const resolveSecretIdsForSource = (
  source: UsageSource,
  scopeIds: readonly string[],
  deps: {
    readonly openapi: OpenApiPluginExtension;
    readonly mcp: McpPluginExtension;
    readonly graphql: GraphqlPluginExtension;
  },
): Effect.Effect<readonly string[], unknown> => {
  const resolveAcrossScopes = <A, E>(
    load: (scopeId: string) => Effect.Effect<A | null, E>,
    collect: (stored: A) => readonly string[],
  ): Effect.Effect<readonly string[], E> =>
    Effect.gen(function* () {
      for (const scopeId of scopeIds) {
        const stored = yield* load(scopeId);
        if (stored) return collect(stored);
      }
      return [] as readonly string[];
    });

  switch (source.pluginId) {
    case "openapi":
      return resolveAcrossScopes(
        (scopeId) => deps.openapi.getSource(source.id, scopeId),
        collectOpenApiSecretIds,
      );
    case "mcp":
      return resolveAcrossScopes(
        (scopeId) => deps.mcp.getSource(source.id, scopeId),
        collectMcpSecretIds,
      );
    case "graphql":
      return resolveAcrossScopes(
        (scopeId) => deps.graphql.getSource(source.id, scopeId),
        collectGraphqlSecretIds,
      );
    default:
      return Effect.succeed([] as readonly string[]);
  }
};

const CloudApiWithSecretsUsage = addGroup(SecretsUsageApi).addError(InternalError);

export const SecretsUsageHandlers = HttpApiBuilder.group(
  CloudApiWithSecretsUsage,
  "secretsUsage",
  (handlers) =>
  handlers.handle("list", ({ path }) =>
    capture(Effect.gen(function* () {
      const executor = yield* ExecutorService;
      const openapi = yield* OpenApiExtensionService;
      const mcp = yield* McpExtensionService;
      const graphql = yield* GraphqlExtensionService;

      const sources = (yield* executor.sources.list().pipe(
        Effect.catchAll(() => Effect.succeed([])),
      )) as readonly UsageSource[];
      const scopeIds = executor.scopes.map((scope) => scope.id);
      const usageIndex = new Map<string, Map<string, SecretUsage>>();

      for (const source of sources) {
        const secretIds = yield* resolveSecretIdsForSource(source, scopeIds, {
          openapi,
          mcp,
          graphql,
        }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly string[])));

        for (const secretId of secretIds) {
          addUsage(usageIndex, secretId, {
            sourceId: source.id,
            sourceName: source.name,
            sourceKind: source.kind,
          });
        }
      }

      return [...usageIndex.entries()]
        .map(([secretId, usedBy]) => ({
          secretId,
          usedBy: sortUsage([...usedBy.values()]),
        }))
        .sort((left, right) => left.secretId.localeCompare(right.secretId));
    })),
  ),
);

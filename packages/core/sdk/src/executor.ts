import { Context, Effect } from "effect";

import type { ToolId, SecretId, PolicyId } from "@executor/storage";
import type { SecretProvider, SecretRef, SetSecretInput } from "@executor/storage";
import { SecretManager } from "@executor/storage";
import type {
  ToolMetadata,
  ToolSchema,
  ToolInvocationResult,
  ToolListFilter,
  InvokeOptions,
} from "@executor/storage";
import { ToolRegistry } from "@executor/storage";
import type { Source, SourceDetectionResult } from "@executor/storage";
import { SourceRegistry, makeInMemorySourceRegistry } from "@executor/storage";
import type { Policy } from "@executor/storage";
import { PolicyEngine } from "@executor/storage";
import type { Scope } from "@executor/storage";
import type { ExecutorPlugin, PluginExtensions, PluginHandle } from "./plugin";
import type {
  ToolNotFoundError,
  ToolInvocationError,
  SecretNotFoundError,
  SecretResolutionError,
  PolicyDeniedError,
} from "@executor/storage";
import {
  FormElicitation,
  ElicitationDeclinedError,
  ElicitationResponse,
  type ElicitationHandler,
} from "@executor/storage";
import type { ScopedKv } from "@executor/storage";

const resolveElicitationHandler = (options: InvokeOptions): ElicitationHandler =>
  options.onElicitation === "accept-all"
    ? () => Effect.succeed(new ElicitationResponse({ action: "accept" }))
    : options.onElicitation;

// ---------------------------------------------------------------------------
// Executor — the main public API, expands with plugins
// ---------------------------------------------------------------------------

export type Executor<TPlugins extends readonly ExecutorPlugin<string, object>[] = []> = {
  readonly scope: Scope;

  readonly tools: {
    readonly list: (filter?: ToolListFilter) => Effect.Effect<readonly ToolMetadata[]>;
    readonly schema: (toolId: string) => Effect.Effect<ToolSchema, ToolNotFoundError>;
    /** Shared schema definitions across all tools */
    readonly definitions: () => Effect.Effect<Record<string, unknown>>;
    readonly invoke: (
      toolId: string,
      args: unknown,
      options: InvokeOptions,
    ) => Effect.Effect<
      ToolInvocationResult,
      ToolNotFoundError | ToolInvocationError | PolicyDeniedError | ElicitationDeclinedError
    >;
  };

  readonly sources: {
    readonly list: () => Effect.Effect<readonly Source[]>;
    readonly remove: (sourceId: string) => Effect.Effect<void>;
    readonly refresh: (sourceId: string) => Effect.Effect<void>;
    readonly detect: (url: string) => Effect.Effect<readonly SourceDetectionResult[]>;
  };

  readonly policies: {
    readonly list: () => Effect.Effect<readonly Policy[]>;
    readonly add: (policy: Omit<Policy, "id" | "createdAt">) => Effect.Effect<Policy>;
    readonly remove: (policyId: string) => Effect.Effect<boolean>;
  };

  readonly secrets: {
    readonly list: () => Effect.Effect<readonly SecretRef[]>;
    /** Resolve a secret value by id */
    readonly resolve: (
      secretId: SecretId,
    ) => Effect.Effect<string, SecretNotFoundError | SecretResolutionError>;
    /** Check if a secret can be resolved */
    readonly status: (secretId: SecretId) => Effect.Effect<"resolved" | "missing">;
    /** Store a secret value (creates ref + writes to provider) */
    readonly set: (
      input: Omit<SetSecretInput, "scopeId">,
    ) => Effect.Effect<SecretRef, SecretResolutionError>;
    readonly remove: (secretId: SecretId) => Effect.Effect<boolean, SecretNotFoundError>;
    /** Register a secret provider */
    readonly addProvider: (provider: SecretProvider) => Effect.Effect<void>;
    /** List registered provider keys */
    readonly providers: () => Effect.Effect<readonly string[]>;
  };

  readonly close: () => Effect.Effect<void>;
} & PluginExtensions<TPlugins>;

// ---------------------------------------------------------------------------
// Auth provider port — compose-friendly schema contributor
// ---------------------------------------------------------------------------

export interface ExecutorAuthProvider {
  readonly key: string;
}

// ---------------------------------------------------------------------------
// ExecutorConfig — flat-spread shape callers pass to createExecutor
// ---------------------------------------------------------------------------

export interface ExecutorConfig<TPlugins extends readonly ExecutorPlugin<string, object>[] = []> {
  readonly scope: Scope;
  readonly tools: Context.Tag.Service<typeof ToolRegistry>;
  readonly sources?: Context.Tag.Service<typeof SourceRegistry>;
  readonly secrets: Context.Tag.Service<typeof SecretManager>;
  readonly policies: Context.Tag.Service<typeof PolicyEngine>;
  readonly pluginKv: (namespace: string) => ScopedKv;
  readonly plugins?: TPlugins;
  readonly auth?: ExecutorAuthProvider;
}

// ---------------------------------------------------------------------------
// createExecutor — builds an Executor from services, initializes plugins
// ---------------------------------------------------------------------------

export const createExecutor = <
  const TPlugins extends readonly ExecutorPlugin<string, object>[] = [],
>(
  config: ExecutorConfig<TPlugins>,
): Effect.Effect<Executor<TPlugins>, Error> =>
  Effect.gen(function* () {
    const {
      scope,
      tools,
      secrets,
      policies,
      pluginKv,
      plugins = [] as unknown as TPlugins,
    } = config;

    const sources = config.sources ?? makeInMemorySourceRegistry();

    const handles = new Map<string, PluginHandle<object>>();
    const extensions: Record<string, object> = {};

    for (const plugin of plugins) {
      const handle = yield* plugin.init({
        scope,
        tools,
        sources,
        secrets,
        policies,
        pluginKv,
      });
      handles.set(plugin.key, handle);
      extensions[plugin.key] = handle.extension;
    }

    const base = {
      scope,

      tools: {
        list: (filter?: ToolListFilter) => tools.list(filter),
        schema: (toolId: string) => tools.schema(toolId as ToolId),
        definitions: () => tools.definitions(),
        invoke: (toolId: string, args: unknown, options: InvokeOptions) => {
          const tid = toolId as ToolId;
          return Effect.gen(function* () {
            yield* policies.check({ scopeId: scope.id, toolId: tid });

            // Dynamically resolve annotations from the plugin
            const annotations = yield* tools.resolveAnnotations(tid);
            if (annotations?.requiresApproval) {
              const handler = resolveElicitationHandler(options);
              const response = yield* handler({
                toolId: tid,
                args,
                request: new FormElicitation({
                  message: annotations.approvalDescription ?? `Approve ${toolId}?`,
                  requestedSchema: {},
                }),
              });
              if (response.action !== "accept") {
                return yield* new ElicitationDeclinedError({
                  toolId: tid,
                  action: response.action,
                });
              }
            }

            return yield* tools.invoke(tid, args, options);
          });
        },
      },

      sources: {
        list: () => sources.list(),
        remove: (sourceId: string) => sources.remove(sourceId),
        refresh: (sourceId: string) => sources.refresh(sourceId),
        detect: (url: string) => sources.detect(url),
      },

      policies: {
        list: () => policies.list(scope.id),
        add: (policy: Omit<Policy, "id" | "createdAt">) =>
          policies.add({ ...policy, scopeId: scope.id }),
        remove: (policyId: string) => policies.remove(policyId as PolicyId),
      },

      secrets: {
        list: () => secrets.list(scope.id),
        resolve: (secretId: SecretId) => secrets.resolve(secretId, scope.id),
        status: (secretId: SecretId) => secrets.status(secretId, scope.id),
        set: (input: Omit<SetSecretInput, "scopeId">) =>
          secrets.set({ ...input, scopeId: scope.id }),
        remove: (secretId: SecretId) => secrets.remove(secretId),
        addProvider: (provider: SecretProvider) => secrets.addProvider(provider),
        providers: () => secrets.providers(),
      },

      close: () =>
        Effect.gen(function* () {
          for (const handle of handles.values()) {
            if (handle.close) yield* handle.close();
          }
        }),
    };

    return Object.assign(base, extensions) as Executor<TPlugins>;
  });

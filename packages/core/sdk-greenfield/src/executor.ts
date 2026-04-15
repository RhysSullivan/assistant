import { Effect } from "effect";
import type { DBAdapter, DBSchema } from "@executor/storage-core";

import { scopeBlobStore, type BlobStore } from "./blob";
import {
  coreSchema,
  type SourceInput,
  type SourceRow,
  type ToolRow,
} from "./core-schema";
import {
  NoHandlerError,
  PluginNotLoadedError,
  SourceRemovalNotAllowedError,
  ToolInvocationError,
  ToolNotFoundError,
  type ExecutorError,
} from "./errors";
import type {
  AnyPlugin,
  PluginCtx,
  PluginExtensions,
  StorageDeps,
} from "./plugin";
import type {
  Scope,
  SecretProvider,
  SecretRef,
  Source,
  Tool,
} from "./types";

// ---------------------------------------------------------------------------
// Executor — the public API. Expanded with PluginExtensions.
// ---------------------------------------------------------------------------

export type Executor<
  TPlugins extends readonly AnyPlugin[] = [],
> = {
  readonly scope: Scope;

  readonly tools: {
    readonly list: () => Effect.Effect<readonly Tool[], Error>;
    readonly invoke: (
      toolId: string,
      args: unknown,
    ) => Effect.Effect<
      unknown,
      | ToolNotFoundError
      | PluginNotLoadedError
      | NoHandlerError
      | ToolInvocationError
      | Error
    >;
  };

  readonly sources: {
    readonly list: () => Effect.Effect<readonly Source[], Error>;
    readonly remove: (
      sourceId: string,
    ) => Effect.Effect<void, SourceRemovalNotAllowedError | Error>;
    readonly refresh: (sourceId: string) => Effect.Effect<void, Error>;
  };

  readonly secrets: {
    readonly get: (id: string) => Effect.Effect<string | null, Error>;
    readonly set: (
      id: string,
      value: string,
      provider?: string,
    ) => Effect.Effect<void, Error>;
    readonly remove: (id: string) => Effect.Effect<void, Error>;
    readonly list: () => Effect.Effect<readonly SecretRef[], Error>;
    readonly providers: () => Effect.Effect<readonly string[]>;
  };

  readonly close: () => Effect.Effect<void, Error>;
} & PluginExtensions<TPlugins>;

export interface ExecutorConfig<
  TPlugins extends readonly AnyPlugin[] = [],
> {
  readonly scope: Scope;
  readonly adapter: DBAdapter;
  readonly blobs: BlobStore;
  readonly plugins?: TPlugins;
}

/**
 * Merge the core schema with every plugin's declared schema. Hosts call
 * this and pass the result to the migration runner before constructing
 * the executor.
 */
export const collectSchemas = (
  plugins: readonly AnyPlugin[],
): DBSchema => {
  const merged: Record<string, DBSchema[string]> = { ...coreSchema };
  for (const plugin of plugins) {
    if (!plugin.schema) continue;
    for (const [modelKey, model] of Object.entries(plugin.schema)) {
      if (merged[modelKey]) {
        throw new Error(
          `Duplicate model "${modelKey}" contributed by plugin "${plugin.id}"` +
            ` (reserved by core or another plugin)`,
        );
      }
      merged[modelKey] = model;
    }
  }
  return merged;
};

// ---------------------------------------------------------------------------
// Row → domain conversions
// ---------------------------------------------------------------------------

const rowToSource = (row: SourceRow): Source => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  url: row.url ?? undefined,
  // SQLite stores booleans as 0/1; coerce back to JS boolean.
  canRemove: Boolean(row.can_remove),
  canRefresh: Boolean(row.can_refresh),
});

/**
 * JSON columns are stored as TEXT in SQLite and come back as strings.
 * Parse them back into structured values. `null` is preserved.
 */
const decodeJsonColumn = (value: unknown): unknown => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const rowToTool = (row: ToolRow): Tool => ({
  id: row.id,
  sourceId: row.source_id,
  name: row.name,
  description: row.description,
  inputSchema: decodeJsonColumn(row.input_schema),
  outputSchema: decodeJsonColumn(row.output_schema),
});

// ---------------------------------------------------------------------------
// Core-table writes — used by both static-source upsert at startup and
// `ctx.core.sources.register(...)` at runtime. Parameterized on the
// plugin_id the calling plugin is authoritative for.
// ---------------------------------------------------------------------------

const writeSourceInput = (
  adapter: DBAdapter,
  pluginId: string,
  input: SourceInput,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const now = new Date();
    yield* adapter.create({
      model: "source",
      data: {
        id: input.id,
        plugin_id: pluginId,
        kind: input.kind,
        name: input.name,
        url: input.url ?? null,
        can_remove: input.canRemove ?? true,
        can_refresh: input.canRefresh ?? false,
        created_at: now,
        updated_at: now,
      },
      forceAllowId: true,
    });
    for (const tool of input.tools) {
      yield* adapter.create({
        model: "tool",
        data: {
          id: `${input.id}.${tool.name}`,
          source_id: input.id,
          plugin_id: pluginId,
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema ?? null,
          output_schema: tool.outputSchema ?? null,
          created_at: now,
          updated_at: now,
        },
        forceAllowId: true,
      });
    }
  });

const deleteSourceById = (
  adapter: DBAdapter,
  sourceId: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* adapter.deleteMany({
      model: "tool",
      where: [{ field: "source_id", value: sourceId }],
    });
    yield* adapter.delete({
      model: "source",
      where: [{ field: "id", value: sourceId }],
    });
  });

// ---------------------------------------------------------------------------
// createExecutor — runs all plugin wiring, writes static sources into
// core, builds each plugin's PluginCtx, returns the assembled executor.
// No plugin reads the adapter at wiring time.
// ---------------------------------------------------------------------------

export const createExecutor = <
  const TPlugins extends readonly AnyPlugin[] = [],
>(
  config: ExecutorConfig<TPlugins>,
): Effect.Effect<Executor<TPlugins>, Error> =>
  Effect.gen(function* () {
    const {
      scope,
      adapter,
      blobs,
      plugins = [] as unknown as TPlugins,
    } = config;

    type StaticHandler = (input: {
      ctx: PluginCtx<unknown>;
      args: unknown;
    }) => Effect.Effect<unknown, Error>;

    interface PluginRuntime {
      readonly plugin: AnyPlugin;
      readonly storage: unknown;
      readonly ctx: PluginCtx<unknown>;
      /** Static tool handlers keyed by fully-qualified tool id
       *  (`${source.id}.${tool.name}`). Looked up first on invocation;
       *  if miss, falls through to plugin.invokeTool. Each handler is
       *  a closure captured at plugin-definition time; shared logic
       *  with the extension lives in closure-scoped helpers the
       *  plugin author writes in the definePlugin factory body. */
      readonly staticHandlers: Map<string, StaticHandler>;
    }

    const runtimes = new Map<string, PluginRuntime>();
    const secretProviders = new Map<string, SecretProvider>();
    const extensions: Record<string, object> = {};

    // -----------------------------------------------------------------
    // Secrets — facade over registered providers.
    // -----------------------------------------------------------------
    const secretsGet = (id: string) =>
      Effect.gen(function* () {
        for (const provider of secretProviders.values()) {
          const value = yield* provider.get(id);
          if (value !== null) return value;
        }
        return null;
      });

    const secretsSet = (id: string, value: string, provider?: string) =>
      Effect.gen(function* () {
        const key =
          provider ?? secretProviders.keys().next().value ?? undefined;
        if (!key) {
          return yield* Effect.fail(new Error("No secret providers registered"));
        }
        const p = secretProviders.get(key);
        if (!p) {
          return yield* Effect.fail(
            new Error(`Unknown secret provider: ${key}`),
          );
        }
        yield* p.set(id, value);
      });

    const secretsRemove = (id: string) =>
      Effect.gen(function* () {
        for (const provider of secretProviders.values()) {
          yield* provider.remove(id);
        }
      });

    const secretsList = () =>
      Effect.gen(function* () {
        const all: SecretRef[] = [];
        for (const [kind, provider] of secretProviders.entries()) {
          const ids = yield* provider.list();
          for (const id of ids) all.push({ id, provider: kind });
        }
        return all as readonly SecretRef[];
      });

    const secretsApi = {
      get: secretsGet,
      set: secretsSet,
      remove: secretsRemove,
      list: secretsList,
    };

    // -----------------------------------------------------------------
    // Plugin wiring — per plugin: build storage, build ctx, upsert
    // static sources, build extension, register secret providers.
    //
    // NO PLUGIN READS THE ADAPTER HERE. Static-source writes are
    // bounded by the plugin's declaration, not by persisted data.
    // -----------------------------------------------------------------
    for (const plugin of plugins) {
      if (runtimes.has(plugin.id)) {
        return yield* Effect.fail(
          new Error(`Duplicate plugin id: ${plugin.id}`),
        );
      }

      const storageDeps: StorageDeps = {
        scope,
        adapter,
        blobs: scopeBlobStore(blobs, plugin.id),
      };
      const storage = plugin.storage(storageDeps);

      // Build this plugin's ctx. `core.sources.register/unregister`
      // close over `plugin.id` — writes are authoritatively tagged
      // with the calling plugin. `transaction` is a thin wrapper over
      // the adapter's transaction support, exposed so plugin authors
      // can wrap extension method bodies in a single atomic unit.
      const ctx: PluginCtx<unknown> = {
        scope,
        storage,
        core: {
          sources: {
            register: (input: SourceInput) =>
              adapter.transaction(() =>
                writeSourceInput(adapter, plugin.id, input),
              ),
            unregister: (sourceId: string) =>
              adapter.transaction(() => deleteSourceById(adapter, sourceId)),
          },
        },
        secrets: secretsApi,
        transaction: <A, E>(effect: Effect.Effect<A, E>) =>
          adapter.transaction(() => effect),
      };

      // Build the extension FIRST so we can pass it as `self` to
      // staticSources below. Plugins without an extension get an empty
      // object as self.
      const extension: object = plugin.extension
        ? plugin.extension(ctx)
        : {};
      if (plugin.extension) {
        extensions[plugin.id] = extension;
      }

      // Register static sources + their inline handlers.
      //   - Core metadata (source row + tool rows) goes into the core
      //     tables via the same writeSourceInput path dynamic sources use.
      //   - Handlers are stored in an in-memory map keyed by
      //     `${source.id}.${tool.name}` and looked up on invocation.
      // Both operations are per-plugin bounded by declared static
      // sources — cold-start work is O(declared static tools), not
      // O(persisted rows).
      //
      // `plugin.staticSources` is a function of the plugin's built
      // extension. The plugin author's handlers close over `self`, so
      // `self.addSpec(args)` inside a static handler just works.
      const staticHandlers = new Map<string, StaticHandler>();
      const staticSourceDecls = plugin.staticSources
        ? plugin.staticSources(extension)
        : [];
      if (staticSourceDecls.length > 0) {
        for (const source of staticSourceDecls) {
          // Build the core SourceInput from the static decl — same
          // shape, minus the handler field.
          const sourceInput: SourceInput = {
            id: source.id,
            kind: source.kind,
            name: source.name,
            url: source.url,
            canRemove: source.canRemove,
            canRefresh: source.canRefresh,
            tools: source.tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              outputSchema: t.outputSchema,
            })),
          };

          yield* adapter.transaction(() =>
            Effect.gen(function* () {
              yield* deleteSourceById(adapter, source.id);
              yield* writeSourceInput(adapter, plugin.id, sourceInput);
            }),
          );

          for (const tool of source.tools) {
            const toolId = `${source.id}.${tool.name}`;
            if (staticHandlers.has(toolId)) {
              return yield* Effect.fail(
                new Error(
                  `Duplicate static tool id: ${toolId} (plugin ${plugin.id})`,
                ),
              );
            }
            staticHandlers.set(
              toolId,
              tool.handler as StaticHandler,
            );
          }
        }
      }

      runtimes.set(plugin.id, {
        plugin,
        storage,
        ctx,
        staticHandlers,
      });

      if (plugin.secretProviders) {
        for (const provider of plugin.secretProviders) {
          if (secretProviders.has(provider.kind)) {
            return yield* Effect.fail(
              new Error(
                `Duplicate secret provider kind: ${provider.kind} (from plugin ${plugin.id})`,
              ),
            );
          }
          secretProviders.set(provider.kind, provider);
        }
      }
    }

    // -----------------------------------------------------------------
    // Executor surface — every list/invoke is a direct core-table
    // query. No in-memory source map. No rehydration. No per-plugin
    // scan.
    // -----------------------------------------------------------------
    const listSources = () =>
      adapter
        .findMany<SourceRow>({ model: "source" })
        .pipe(Effect.map((rows) => rows.map(rowToSource)));

    const listTools = () =>
      adapter
        .findMany<ToolRow>({ model: "tool" })
        .pipe(Effect.map((rows) => rows.map(rowToTool)));

    const invokeTool = (toolId: string, args: unknown) =>
      Effect.gen(function* () {
        const row = yield* adapter.findOne<ToolRow>({
          model: "tool",
          where: [{ field: "id", value: toolId }],
        });
        if (!row) {
          return yield* new ToolNotFoundError({ toolId });
        }
        const runtime = runtimes.get(row.plugin_id);
        if (!runtime) {
          return yield* new PluginNotLoadedError({
            pluginId: row.plugin_id,
            toolId,
          });
        }

        const wrapInvocationError = <A, E>(
          effect: Effect.Effect<A, E>,
        ): Effect.Effect<A, ToolInvocationError> =>
          effect.pipe(
            Effect.mapError(
              (cause) =>
                new ToolInvocationError({
                  toolId,
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            ),
          );

        // Static path: handler is already in the plugin's map,
        // declared inline at plugin-definition time.
        const staticHandler = runtime.staticHandlers.get(toolId);
        if (staticHandler) {
          return yield* wrapInvocationError(
            staticHandler({ ctx: runtime.ctx, args }),
          );
        }

        // Dynamic path: delegate to the plugin's invokeTool. Plugin
        // receives the already-loaded toolRow so there's no string
        // parsing — it has source_id and name directly.
        if (!runtime.plugin.invokeTool) {
          return yield* new NoHandlerError({
            toolId,
            pluginId: row.plugin_id,
          });
        }
        return yield* wrapInvocationError(
          runtime.plugin.invokeTool({
            ctx: runtime.ctx,
            toolRow: row,
            args,
          }),
        );
      });

    const removeSource = (sourceId: string) =>
      Effect.gen(function* () {
        const sourceRow = yield* adapter.findOne<SourceRow>({
          model: "source",
          where: [{ field: "id", value: sourceId }],
        });
        if (!sourceRow) return;
        // Reject attempts to remove static / protected sources. This
        // is the structural backstop for `canRemove: false` — e.g.
        // control sources declared by a plugin at startup.
        if (!sourceRow.can_remove) {
          return yield* new SourceRemovalNotAllowedError({ sourceId });
        }
        const runtime = runtimes.get(sourceRow.plugin_id);
        yield* adapter.transaction(() =>
          Effect.gen(function* () {
            if (runtime?.plugin.removeSource) {
              yield* runtime.plugin.removeSource({
                ctx: runtime.ctx,
                sourceId,
              });
            }
            yield* deleteSourceById(adapter, sourceId);
          }),
        );
      });

    const refreshSource = (sourceId: string) =>
      Effect.gen(function* () {
        const sourceRow = yield* adapter.findOne<SourceRow>({
          model: "source",
          where: [{ field: "id", value: sourceId }],
        });
        if (!sourceRow) return;
        const runtime = runtimes.get(sourceRow.plugin_id);
        if (runtime?.plugin.refreshSource) {
          yield* runtime.plugin.refreshSource({
            ctx: runtime.ctx,
            sourceId,
          });
        }
      });

    const close = () =>
      Effect.gen(function* () {
        for (const runtime of runtimes.values()) {
          if (runtime.plugin.close) {
            yield* runtime.plugin.close();
          }
        }
      });

    const base = {
      scope,
      tools: { list: listTools, invoke: invokeTool },
      sources: {
        list: listSources,
        remove: removeSource,
        refresh: refreshSource,
      },
      secrets: {
        get: secretsGet,
        set: secretsSet,
        remove: secretsRemove,
        list: secretsList,
        providers: () =>
          Effect.sync(
            () => Array.from(secretProviders.keys()) as readonly string[],
          ),
      },
      close,
    };

    return Object.assign(base, extensions) as Executor<TPlugins>;
  });

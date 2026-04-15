import type { Effect } from "effect";
import type { DBAdapter, DBSchema } from "@executor/storage-core";

import type { ScopedBlobStore } from "./blob";
import type { SourceInput, ToolRow } from "./core-schema";
import type { Scope, SecretProvider, SecretRef } from "./types";

// ---------------------------------------------------------------------------
// StorageDeps — raw backing passed to a plugin's storage factory. The
// only place raw adapter/blobs are visible; PluginCtx never carries
// them.
// ---------------------------------------------------------------------------

export interface StorageDeps {
  readonly scope: Scope;
  readonly adapter: DBAdapter;
  readonly blobs: ScopedBlobStore;
}

// ---------------------------------------------------------------------------
// PluginCtx — what's passed to the plugin's `extension` factory and
// threaded into tool invocations. No raw adapter, no raw blobs.
// Plugin-specific persistence goes through `storage`; core data model
// writes go through `core.sources`.
// ---------------------------------------------------------------------------

export interface PluginCtx<TStore = unknown> {
  readonly scope: Scope;
  readonly storage: TStore;
  readonly core: {
    readonly sources: {
      readonly register: (input: SourceInput) => Effect.Effect<void, Error>;
      readonly unregister: (sourceId: string) => Effect.Effect<void, Error>;
    };
  };
  readonly secrets: {
    readonly get: (id: string) => Effect.Effect<string | null, Error>;
    readonly set: (
      id: string,
      value: string,
      provider?: string,
    ) => Effect.Effect<void, Error>;
    readonly list: () => Effect.Effect<readonly SecretRef[], Error>;
    readonly remove: (id: string) => Effect.Effect<void, Error>;
  };
  /**
   * Run `effect` inside a database transaction. Wraps the underlying
   * adapter's `transaction` method. Use this in extension methods that
   * need atomicity across plugin storage writes AND core source/tool
   * registration — e.g. `addSpec` writes plugin enrichment via
   * `ctx.storage.upsertSpec` AND writes core metadata via
   * `ctx.core.sources.register`, and both should succeed or fail as a
   * single unit. Nested transactions compose via savepoints.
   */
  readonly transaction: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | Error>;
}

// ---------------------------------------------------------------------------
// Static tool / source declarations. These are pure data + handlers
// declared at plugin-definition time.
//
// Crucially, the `handler` type does NOT reference TExtension. This
// sidesteps the inference ambiguity that would otherwise happen if
// TExtension appeared both on the handler's `self` parameter (three
// levels deep in nested arrays) and on the `extension` factory's
// return type — TS would fall back to the `object` constraint. Instead
// we attach `self` at the `staticSources` callback level (one level
// deep), see PluginSpec below.
// ---------------------------------------------------------------------------

export interface StaticToolHandlerInput<TStore = unknown> {
  readonly ctx: PluginCtx<TStore>;
  readonly args: unknown;
}

export interface StaticToolDecl<TStore = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly handler: (
    input: StaticToolHandlerInput<TStore>,
  ) => Effect.Effect<unknown, Error>;
}

export interface StaticSourceDecl<TStore = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly url?: string;
  readonly canRemove?: boolean;
  readonly canRefresh?: boolean;
  readonly tools: readonly StaticToolDecl<TStore>[];
}

// ---------------------------------------------------------------------------
// Input shapes for dynamic-tool invocation and source lifecycle hooks.
// All plugin-author-facing callbacks take a single object parameter so the
// plugin author can destructure only the fields they care about.
// ---------------------------------------------------------------------------

export interface InvokeToolInput<TStore = unknown> {
  readonly ctx: PluginCtx<TStore>;
  readonly toolRow: ToolRow;
  readonly args: unknown;
}

export interface SourceLifecycleInput<TStore = unknown> {
  readonly ctx: PluginCtx<TStore>;
  readonly sourceId: string;
}

// ---------------------------------------------------------------------------
// PluginSpec — what the author returns from a definePlugin factory.
//
// Static tools (staticSources) have inline handlers. Dynamic tools go
// through `invokeTool`, which the executor calls with the already-loaded
// core ToolRow so the plugin doesn't parse toolId strings.
// ---------------------------------------------------------------------------

export interface PluginSpec<
  TId extends string = string,
  TExtension extends object = Record<string, never>,
  TStore = unknown,
> {
  readonly id: TId;
  readonly schema?: DBSchema;
  readonly storage: (deps: StorageDeps) => TStore;

  /**
   * Static sources contributed by this plugin with inline tool
   * handlers. Called at executor startup with the plugin's own
   * just-built extension as `self` — static handlers close over it
   * via the plugin author's closure, so a control tool that delegates
   * to the extension is a one-liner: `(ctx, args) => self.addSpec(args)`.
   *
   * The `NoInfer<TExtension>` wrapper is load-bearing: without it,
   * TypeScript treats this parameter as an inference source for
   * TExtension, competing with the `extension` factory's return type
   * and falling back to the `object` constraint. `NoInfer` tells TS
   * to infer TExtension ONLY from `extension` and then type-check
   * `self` against the inferred result.
   *
   * Upserted into the core source/tool tables at executor startup
   * (bounded writes, no reads). Handlers are registered in an
   * in-memory map keyed by `${source.id}.${tool.name}` and looked up
   * on invocation.
   */
  readonly staticSources?: (
    self: NoInfer<TExtension>,
  ) => readonly StaticSourceDecl<TStore>[];

  /**
   * Invoke a dynamic tool owned by this plugin. Called when the
   * executor's static-handler map doesn't have the toolId. The plugin
   * reads its own enrichment via ctx.storage and returns the result.
   * Optional — plugins with only static tools can omit it.
   */
  readonly invokeTool?: (
    input: InvokeToolInput<TStore>,
  ) => Effect.Effect<unknown, Error>;

  /**
   * Called when executor.sources.remove() targets a source owned by
   * this plugin. Plugin-side cleanup only; the executor deletes the
   * core source/tool rows after the callback completes, all inside a
   * single transaction.
   */
  readonly removeSource?: (
    input: SourceLifecycleInput<TStore>,
  ) => Effect.Effect<void, Error>;

  readonly refreshSource?: (
    input: SourceLifecycleInput<TStore>,
  ) => Effect.Effect<void, Error>;

  /**
   * Build the plugin's extension API. Called ONCE at executor creation.
   * The returned object becomes `executor[plugin.id]` and is also the
   * `self` passed to static tool handlers.
   */
  readonly extension?: (ctx: PluginCtx<TStore>) => TExtension;

  readonly secretProviders?: readonly SecretProvider[];

  readonly close?: () => Effect.Effect<void, Error>;
}

export interface Plugin<
  TId extends string = string,
  TExtension extends object = Record<string, never>,
  TStore = unknown,
> extends PluginSpec<TId, TExtension, TStore> {}

// ---------------------------------------------------------------------------
// definePlugin — type-level injection point for the `storage` override.
// ---------------------------------------------------------------------------

export type ConfiguredPlugin<
  TId extends string,
  TExtension extends object,
  TStore,
  TOptions extends object,
> = (
  options?: TOptions & {
    readonly storage?: (deps: StorageDeps) => TStore;
  },
) => Plugin<TId, TExtension, TStore>;

// Everything is inferred from the author factory's return type — no
// explicit generic specification at call sites. TId from the `id`
// field, TStore from the `storage` factory's return, TExtension from
// the `extension` factory's return. Plugins without an extension get
// TExtension = Record<string, never> via the default.
//
// eslint-disable-next-line @typescript-eslint/ban-types -- `{}` default
// for TOptions: `{} & { storage?: ... }` collapses to just the storage
// override for plugins with no author options.
export function definePlugin<
  TId extends string,
  TExtension extends object,
  TStore,
  TOptions extends object = {},
>(
  authorFactory: (options?: TOptions) => PluginSpec<TId, TExtension, TStore>,
): ConfiguredPlugin<TId, TExtension, TStore, TOptions> {
  return (options) => {
    const {
      storage: storageOverride,
      ...rest
    }: {
      storage?: (deps: StorageDeps) => TStore;
      [key: string]: unknown;
    } = options ?? {};

    const hasAuthorOptions = Object.keys(rest).length > 0;
    const spec = authorFactory(
      hasAuthorOptions ? (rest as unknown as TOptions) : undefined,
    );

    return {
      ...spec,
      storage: storageOverride ?? spec.storage,
    };
  };
}

// ---------------------------------------------------------------------------
// AnyPlugin — heterogeneous-array container. `any` in TStore and
// TExtension slots because both appear in contravariant positions
// (ctx / self parameters of static handlers and invokeTool).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPlugin = Plugin<string, any, any>;

// ---------------------------------------------------------------------------
// PluginExtensions — type-level projection: tuple of plugins →
// `{ [id]: extension }`. Plugins without an extension land as
// Record<string, never> which is a harmless empty object on the
// executor surface.
// ---------------------------------------------------------------------------

export type PluginExtensions<TPlugins extends readonly AnyPlugin[]> = {
  readonly [P in TPlugins[number] as P["id"]]: P extends Plugin<
    string,
    infer TExt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >
    ? TExt
    : never;
};

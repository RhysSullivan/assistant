import type { Context, Effect } from "effect";

import type { ToolRegistry } from "@executor/storage";
import type { SecretManager } from "@executor/storage";
import type { PolicyEngine } from "@executor/storage";
import type { SourceRegistry } from "@executor/storage";
import type { Scope } from "@executor/storage";
import type { ScopedKv } from "@executor/storage";

// ---------------------------------------------------------------------------
// Plugin context — what the SDK gives a plugin when it starts
// ---------------------------------------------------------------------------

export interface PluginContext {
  readonly scope: Scope;
  readonly tools: Context.Tag.Service<typeof ToolRegistry>;
  readonly sources: Context.Tag.Service<typeof SourceRegistry>;
  readonly secrets: Context.Tag.Service<typeof SecretManager>;
  readonly policies: Context.Tag.Service<typeof PolicyEngine>;
  /** Opaque-state escape hatch bound to the plugin's namespace */
  readonly pluginKv: (namespace: string) => ScopedKv;
}

// ---------------------------------------------------------------------------
// Plugin definition — what a plugin provides to the SDK
// ---------------------------------------------------------------------------

export interface ExecutorPlugin<TKey extends string = string, TExtension extends object = object> {
  /** Unique plugin key — becomes a property on the Executor type */
  readonly key: TKey;

  /**
   * Called when the executor starts. The plugin should register its tools
   * and return any cleanup logic + its public extension API.
   */
  readonly init: (ctx: PluginContext) => Effect.Effect<PluginHandle<TExtension>, Error>;
}

export interface PluginHandle<TExtension extends object = object> {
  /** Plugin's public API — exposed on the executor as `executor[plugin.key]` */
  readonly extension: TExtension;
  /** Called when the executor shuts down */
  readonly close?: () => Effect.Effect<void>;
}

// ---------------------------------------------------------------------------
// Type-level helpers — expand the Executor type based on plugins
// ---------------------------------------------------------------------------

/** Maps a tuple of plugins to their extensions keyed by plugin key */
export type PluginExtensions<TPlugins extends readonly ExecutorPlugin<string, object>[]> = {
  readonly [P in TPlugins[number] as P["key"]]: P extends ExecutorPlugin<string, infer TExt>
    ? TExt
    : never;
};

// ---------------------------------------------------------------------------
// definePlugin — helper for type inference
// ---------------------------------------------------------------------------

export const definePlugin = <const TKey extends string, TExtension extends object>(
  plugin: ExecutorPlugin<TKey, TExtension>,
): ExecutorPlugin<TKey, TExtension> => plugin;

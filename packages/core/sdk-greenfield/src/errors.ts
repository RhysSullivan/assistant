// ---------------------------------------------------------------------------
// Tagged errors for the executor surface.
//
// Plugins internally can still fail with arbitrary errors; the executor
// catches those and wraps them in `ToolInvocationError` so the public
// surface has a stable, discriminated error channel that consumers can
// pattern-match on via the `_tag` field.
// ---------------------------------------------------------------------------

import { Schema } from "effect";

export class ToolNotFoundError extends Schema.TaggedError<ToolNotFoundError>()(
  "ToolNotFoundError",
  {
    toolId: Schema.String,
  },
) {}

export class SourceNotFoundError extends Schema.TaggedError<SourceNotFoundError>()(
  "SourceNotFoundError",
  {
    sourceId: Schema.String,
  },
) {}

/**
 * The core `source`/`tool` table row references a `plugin_id` that isn't
 * in the currently-loaded plugin list. Usually means a plugin was removed
 * from the host's plugin tuple but its persisted data is still around.
 */
export class PluginNotLoadedError extends Schema.TaggedError<PluginNotLoadedError>()(
  "PluginNotLoadedError",
  {
    pluginId: Schema.String,
    toolId: Schema.optional(Schema.String),
    sourceId: Schema.optional(Schema.String),
  },
) {}

/**
 * Wraps any error raised by a plugin's tool handler (static or dynamic).
 * `cause` carries the original error; `message` is its stringified form
 * for quick display.
 */
export class ToolInvocationError extends Schema.TaggedError<ToolInvocationError>()(
  "ToolInvocationError",
  {
    toolId: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/**
 * A caller tried to remove a source whose core row has `can_remove: false`
 * — typically a static control source declared by a plugin.
 */
export class SourceRemovalNotAllowedError extends Schema.TaggedError<SourceRemovalNotAllowedError>()(
  "SourceRemovalNotAllowedError",
  {
    sourceId: Schema.String,
  },
) {}

/**
 * A plugin registered no static handler and no `invokeTool` for a tool id
 * that otherwise exists in the core `tool` table. Usually a plugin-author
 * bug — they declared the tool via `ctx.core.sources.register` but didn't
 * provide a way to execute it.
 */
export class NoHandlerError extends Schema.TaggedError<NoHandlerError>()(
  "NoHandlerError",
  {
    toolId: Schema.String,
    pluginId: Schema.String,
  },
) {}

export type ExecutorError =
  | ToolNotFoundError
  | SourceNotFoundError
  | PluginNotLoadedError
  | ToolInvocationError
  | SourceRemovalNotAllowedError
  | NoHandlerError;

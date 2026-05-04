import { Data, Schema } from "effect";

import { ConnectionId, ToolId, SecretId } from "./ids";

// ---------------------------------------------------------------------------
// Tool lifecycle
// ---------------------------------------------------------------------------

export class ToolNotFoundError extends Schema.TaggedErrorClass<ToolNotFoundError>()(
  "ToolNotFoundError",
  { toolId: ToolId },
) {}

export class ToolInvocationError extends Data.TaggedError("ToolInvocationError")<{
  readonly toolId: ToolId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Tool row exists in the DB but its owning plugin isn't loaded. Means
 *  the tool was registered by a plugin that's no longer present in the
 *  current executor config — usually a stale row from an older session. */
export class PluginNotLoadedError extends Schema.TaggedErrorClass<PluginNotLoadedError>()(
  "PluginNotLoadedError",
  {
    pluginId: Schema.String,
    toolId: ToolId,
  },
) {}

/** Tool was found but its owning plugin has no `invokeTool` handler —
 *  the plugin only declares static tools and this one's id matched
 *  dynamically somehow. Shouldn't happen in practice; guards against
 *  programmer error. */
export class NoHandlerError extends Schema.TaggedErrorClass<NoHandlerError>()(
  "NoHandlerError",
  {
    toolId: ToolId,
    pluginId: Schema.String,
  },
) {}

/** Tool invocation was rejected because a workspace `tool_policy` rule
 *  with `action: "block"` matched. `pattern` is the matched policy
 *  pattern so callers / agents can render a useful "this is blocked
 *  by your `vercel.dns.*` rule" message. */
export class ToolBlockedError extends Schema.TaggedErrorClass<ToolBlockedError>()(
  "ToolBlockedError",
  {
    toolId: ToolId,
    pattern: Schema.String,
  },
) {}

// ---------------------------------------------------------------------------
// Source lifecycle
// ---------------------------------------------------------------------------

export class SourceNotFoundError extends Schema.TaggedErrorClass<SourceNotFoundError>()(
  "SourceNotFoundError",
  { sourceId: Schema.String },
) {}

/** `executor.sources.remove(id)` was called on a source with
 *  `canRemove: false` — typically a static source declared by a plugin
 *  at startup. Removing static sources is a bug in the caller. */
export class SourceRemovalNotAllowedError extends Schema.TaggedErrorClass<SourceRemovalNotAllowedError>()(
  "SourceRemovalNotAllowedError",
  { sourceId: Schema.String },
) {}

/** Raised when a source-definition write targets a personal scope
 *  (`user_org_*` or `user_workspace_*`). Personal source definitions are
 *  out of scope for cloud v1 — sources can only be defined at `org` or
 *  `workspace` scopes. The UI exposes only those targets in the add-source
 *  selectors; this error guards the contract on the server side. Callers
 *  whose deployment doesn't use the cloud's `user_*` prefix convention
 *  pass a plain scope id (no `user_*` prefix) and never trip this.
 *
 *  HTTP 422: the request was syntactically valid but targeted an illegal
 *  scope. The plugin API surfaces it via `.annotate({ httpApiStatus: 422 })`
 *  in the relevant group's error union (see e.g.
 *  `packages/plugins/openapi/src/api/group.ts`). */
export class InvalidSourceWriteTargetError extends Schema.TaggedErrorClass<InvalidSourceWriteTargetError>()(
  "InvalidSourceWriteTargetError",
  {
    scopeId: Schema.String,
    reason: Schema.String,
  },
) {
  static annotations = { httpApiStatus: 422 };
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export class SecretNotFoundError extends Schema.TaggedErrorClass<SecretNotFoundError>()(
  "SecretNotFoundError",
  { secretId: SecretId },
) {}

export class SecretResolutionError extends Schema.TaggedErrorClass<SecretResolutionError>()(
  "SecretResolutionError",
  {
    secretId: SecretId,
    message: Schema.String,
  },
) {}

/** Raised when `secrets.remove(id)` is called on a secret whose row has
 *  `owned_by_connection_id` set. The connection owns the lifecycle —
 *  callers must go through `connections.remove(connectionId)` to
 *  delete it along with its siblings. */
export class SecretOwnedByConnectionError extends Schema.TaggedErrorClass<SecretOwnedByConnectionError>()(
  "SecretOwnedByConnectionError",
  {
    secretId: SecretId,
    connectionId: ConnectionId,
  },
) {}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export class ConnectionNotFoundError extends Schema.TaggedErrorClass<ConnectionNotFoundError>()(
  "ConnectionNotFoundError",
  { connectionId: ConnectionId },
) {}

export class ConnectionProviderNotRegisteredError extends Schema.TaggedErrorClass<ConnectionProviderNotRegisteredError>()(
  "ConnectionProviderNotRegisteredError",
  {
    provider: Schema.String,
    connectionId: Schema.optional(ConnectionId),
  },
) {}

export class ConnectionRefreshNotSupportedError extends Schema.TaggedErrorClass<ConnectionRefreshNotSupportedError>()(
  "ConnectionRefreshNotSupportedError",
  {
    connectionId: ConnectionId,
    provider: Schema.String,
  },
) {}

/**
 * Raised by `connections.accessToken(id)` when the provider's refresh
 * handler reported that the stored refresh token is permanently
 * invalid (RFC 6749 §5.2 `invalid_grant` and friends). The caller —
 * typically a tool invocation — surfaces this so the UI can prompt the
 * user to sign in again. Distinct from `ConnectionRefreshError` so
 * "the network flaked, retry later" and "the grant is dead, re-auth"
 * don't collapse into one error tag at the plugin boundary.
 */
export class ConnectionReauthRequiredError extends Schema.TaggedErrorClass<ConnectionReauthRequiredError>()(
  "ConnectionReauthRequiredError",
  {
    connectionId: ConnectionId,
    provider: Schema.String,
    message: Schema.String,
  },
) {}

// ---------------------------------------------------------------------------
// Union type for convenience in signatures.
// ---------------------------------------------------------------------------

export type ExecutorError =
  | ToolNotFoundError
  | ToolInvocationError
  | PluginNotLoadedError
  | NoHandlerError
  | ToolBlockedError
  | SourceNotFoundError
  | SourceRemovalNotAllowedError
  | InvalidSourceWriteTargetError
  | SecretNotFoundError
  | SecretResolutionError
  | SecretOwnedByConnectionError
  | ConnectionNotFoundError
  | ConnectionProviderNotRegisteredError
  | ConnectionRefreshNotSupportedError
  | ConnectionReauthRequiredError;

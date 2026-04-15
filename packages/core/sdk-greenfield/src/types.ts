import type { Effect } from "effect";

// ---------------------------------------------------------------------------
// Scope — the isolation boundary. Single-scope for now; multi-scope /
// scope merging is a future concern.
// ---------------------------------------------------------------------------

export interface Scope {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Tool — the public projection of a row in the core `tool` table. No
// handler — handlers live inside plugins and are invoked via
// `executor.tools.invoke(...)`. Schemas are parsed from their json
// columns on read.
// ---------------------------------------------------------------------------

export interface Tool {
  /** Fully-qualified id: `${sourceId}.${tool.name}` */
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
}

// ---------------------------------------------------------------------------
// Source — the public projection of a row in the core `source` table.
// Tools belonging to a source are NOT inlined here: they live in the
// core `tool` table and are queried independently via
// `executor.tools.list()` (or filtered by sourceId). Keeping them
// separate avoids leaking plugin-internal handler closures across the
// executor boundary.
// ---------------------------------------------------------------------------

export interface Source {
  readonly id: string;
  /** Plugin kind that manages this source — "openapi", "mcp", etc. */
  readonly kind: string;
  readonly name: string;
  /** Upstream URL, if any — used for favicons in the UI. */
  readonly url?: string;
  readonly canRemove?: boolean;
  readonly canRefresh?: boolean;
}

// ---------------------------------------------------------------------------
// Secrets — a provider contributes a backend (keychain, 1password, vault).
// Metadata (which provider owns which secret id) lives in the main adapter
// via a plugin-declared schema, not in core.
// ---------------------------------------------------------------------------

export interface SecretRef {
  readonly id: string;
  readonly provider: string;
  readonly description?: string;
}

export interface SecretProvider {
  /** Unique provider kind: "keychain", "1password", "vault", ... */
  readonly kind: string;
  readonly get: (id: string) => Effect.Effect<string | null, Error>;
  readonly set: (id: string, value: string) => Effect.Effect<void, Error>;
  readonly remove: (id: string) => Effect.Effect<void, Error>;
  readonly list: () => Effect.Effect<readonly string[], Error>;
}

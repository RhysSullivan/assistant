import type { Effect } from "effect";
import type { ToolId } from "@executor/sdk";

import type { OperationBinding, InvocationConfig } from "./types";

// ---------------------------------------------------------------------------
// Operation store — plugin's own storage for invocation data
// ---------------------------------------------------------------------------

export interface SourceMeta {
  readonly namespace: string;
  readonly name: string;
}

export interface OpenApiOperationStore {
  readonly get: (
    toolId: ToolId,
  ) => Effect.Effect<{ binding: OperationBinding; config: InvocationConfig } | null>;

  readonly put: (
    toolId: ToolId,
    namespace: string,
    binding: OperationBinding,
    config: InvocationConfig,
  ) => Effect.Effect<void>;

  readonly remove: (toolId: ToolId) => Effect.Effect<void>;

  readonly listByNamespace: (namespace: string) => Effect.Effect<readonly ToolId[]>;

  readonly removeByNamespace: (namespace: string) => Effect.Effect<readonly ToolId[]>;

  readonly putSourceMeta: (meta: SourceMeta) => Effect.Effect<void>;

  readonly removeSourceMeta: (namespace: string) => Effect.Effect<void>;

  readonly listSourceMeta: () => Effect.Effect<readonly SourceMeta[]>;
}

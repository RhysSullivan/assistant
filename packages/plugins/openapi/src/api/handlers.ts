import { HttpApiBuilder } from "@effect/platform";
import { Context, Effect } from "effect";

import { addGroup, capture } from "@executor/api";
import type {
  OpenApiPluginExtension,
  HeaderValue,
  OpenApiUpdateSourceInput,
} from "../sdk/plugin";
import { OpenApiGroup } from "./group";

// ---------------------------------------------------------------------------
// Service tag
//
// Holds the `Captured` shape — every method's `StorageFailure`
// channel has been swapped for `InternalError({ traceId })`. The cloud
// app provides an already-wrapped extension via
// `Layer.succeed(OpenApiExtensionService, withCapture(executor.openapi))`.
// Handlers see `InternalError` in the error union, which matches
// `.addError(InternalError)` on the group — no per-handler translation.
// ---------------------------------------------------------------------------

export class OpenApiExtensionService extends Context.Tag("OpenApiExtensionService")<
  OpenApiExtensionService,
  OpenApiPluginExtension
>() {}

// ---------------------------------------------------------------------------
// Composed API — core + openapi group
// ---------------------------------------------------------------------------

const ExecutorApiWithOpenApi = addGroup(OpenApiGroup);

// ---------------------------------------------------------------------------
// Handlers
//
// Each handler is exactly: yield the extension service, call the method,
// return. Plugin SDK errors flow through the typed channel and are
// schema-encoded to 4xx by HttpApi (see group.ts `.addError(...)` calls).
// Defects bubble up and are captured + downgraded to `InternalError(traceId)`
// by the API-level observability middleware.
//
// OAuth start/complete/callback live on the shared `/scopes/:scopeId/oauth/*`
// group in `@executor/api` now — the plugin has no OAuth-specific handlers.
// ---------------------------------------------------------------------------

export const OpenApiHandlers = HttpApiBuilder.group(ExecutorApiWithOpenApi, "openapi", (handlers) =>
  handlers
    .handle("previewSpec", ({ payload }) =>
      capture(Effect.gen(function* () {
        const ext = yield* OpenApiExtensionService;
        return yield* ext.previewSpec(payload.spec);
      })),
    )
    .handle("addSpec", ({ path, payload }) =>
      capture(Effect.gen(function* () {
        const ext = yield* OpenApiExtensionService;
        const result = yield* ext.addSpec({
          spec: payload.spec,
          scope: path.scopeId,
          name: payload.name,
          baseUrl: payload.baseUrl,
          namespace: payload.namespace,
          headers: payload.headers as Record<string, HeaderValue> | undefined,
          oauth2: payload.oauth2,
        });
        return {
          toolCount: result.toolCount,
          namespace: result.sourceId,
        };
      })),
    )
    .handle("getSource", ({ path }) =>
      capture(Effect.gen(function* () {
        const ext = yield* OpenApiExtensionService;
        return yield* ext.getSource(path.namespace, path.scopeId);
      })),
    )
    .handle("updateSource", ({ path, payload }) =>
      capture(Effect.gen(function* () {
        const ext = yield* OpenApiExtensionService;
        yield* ext.updateSource(path.namespace, path.scopeId, {
          name: payload.name,
          baseUrl: payload.baseUrl,
          headers: payload.headers as Record<string, HeaderValue> | undefined,
          oauth2: payload.oauth2,
        } as OpenApiUpdateSourceInput);
        return { updated: true };
      })),
    ),
);

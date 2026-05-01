import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Context, Effect } from "effect";

import { addGroup, capture } from "@executor-js/api";
import type {
  ConfiguredHeaderValue,
  OpenApiPluginExtension,
  HeaderValue,
  OpenApiSpecFetchCredentials,
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

export class OpenApiExtensionService extends Context.Service<OpenApiExtensionService, OpenApiPluginExtension
>()("OpenApiExtensionService") {}

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
// ---------------------------------------------------------------------------

export const OpenApiHandlers = HttpApiBuilder.group(ExecutorApiWithOpenApi, "openapi", (handlers) =>
  handlers
    .handle("previewSpec", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          return yield* ext.previewSpec({
            spec: payload.spec,
            specFetchCredentials: payload.specFetchCredentials as
              | OpenApiSpecFetchCredentials
              | undefined,
          });
        }),
      ),
    )
    .handle("addSpec", ({ params: path, payload }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          const result = yield* ext.addSpec({
            spec: payload.spec,
            specFetchCredentials: payload.specFetchCredentials as
              | OpenApiSpecFetchCredentials
              | undefined,
            scope: path.scopeId,
            name: payload.name,
            baseUrl: payload.baseUrl,
            namespace: payload.namespace,
            headers: payload.headers as
              | Record<string, HeaderValue | ConfiguredHeaderValue>
              | undefined,
            queryParams: payload.queryParams as Record<string, HeaderValue> | undefined,
            oauth2: payload.oauth2,
          });
          return {
            toolCount: result.toolCount,
            namespace: result.sourceId,
          };
        }),
      ),
    )
    .handle("getSource", ({ params: path }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          return yield* ext.getSource(path.namespace, path.scopeId);
        }),
      ),
    )
    .handle("updateSource", ({ params: path, payload }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          yield* ext.updateSource(path.namespace, path.scopeId, {
            name: payload.name,
            baseUrl: payload.baseUrl,
            headers: payload.headers as
              | Record<string, HeaderValue | ConfiguredHeaderValue>
              | undefined,
            queryParams: payload.queryParams as Record<string, HeaderValue> | undefined,
            oauth2: payload.oauth2,
          } as OpenApiUpdateSourceInput);
          return { updated: true };
        }),
      ),
    )
    .handle("listSourceBindings", ({ params: path }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          return yield* ext.listSourceBindings(path.namespace, path.sourceScopeId);
        }),
      ),
    )
    .handle("setSourceBinding", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          return yield* ext.setSourceBinding(payload);
        }),
      ),
    )
    .handle("removeSourceBinding", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const ext = yield* OpenApiExtensionService;
          yield* ext.removeSourceBinding(
            payload.sourceId,
            payload.sourceScope,
            payload.slot,
            payload.scope,
          );
          return { removed: true };
        }),
      ),
    ),
);

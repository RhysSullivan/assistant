import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { Effect, Layer } from "effect";

import { OrgAuthLive, SessionAuthLive } from "../auth/middleware-live";
import { UserStoreService } from "../auth/context";
import {
  CloudAuthPublicHandlers,
  CloudSessionAuthHandlers,
  NonProtectedApi,
} from "../auth/handlers";
import { DbService } from "../services/db";
import { TelemetryLive } from "../services/telemetry";
import { OrgHttpApi } from "../org/compose";
import { OrgHandlers } from "../org/handlers";
import { WorkspacesHandlers } from "../workspaces/handlers";

import { CoreSharedServices } from "./core-shared-services";
import { ProtectedCloudApi, RouterConfig } from "./protected-layers";
import { requestScopedMiddleware } from "./request-scoped";

export {
  CoreSharedServices,
  ProtectedCloudApi,
  RouterConfig,
};

const DbLive = DbService.Live;
const UserStoreLive = UserStoreService.Live.pipe(Layer.provide(DbLive));

// Per-request layer. Anything that opens an I/O object (postgres.js socket,
// fetch stream readers, anything backed by a `Writable`) MUST live here —
// `provideRequestScoped` rebuilds it per request so Cloudflare Workers'
// I/O isolation is satisfied. See `api.request-scope.test.ts`.
export const RequestScopedServicesLive = Layer.mergeAll(DbLive, UserStoreLive);

// Boot-scoped layer. Built once at worker boot, reused across requests.
// Safe for config, in-memory caches, the global tracer provider, and
// stateless service shells.
export const BootSharedServices = Layer.mergeAll(
  CoreSharedServices,
  HttpServer.layerServices,
  TelemetryLive,
);

// Routes that don't require an authenticated org session — login,
// callbacks, etc. Mounts at the paths declared inside `NonProtectedApi`.
//
// `rsLive` is the per-request DB layer. It's passed in as a parameter so
// tests can substitute a counting fake for `DbService.Live` and assert
// per-request semantics. Handlers here yield `UserStoreService` directly;
// without per-request scoping the postgres.js socket pins to the worker's
// boot scope and Cloudflare Workers' I/O isolation kills the second
// request.
export const makeNonProtectedApiLive = (
  rsLive: Layer.Layer<DbService | UserStoreService>,
) =>
  HttpApiBuilder.layer(NonProtectedApi).pipe(
    Layer.provide(Layer.mergeAll(CloudAuthPublicHandlers, CloudSessionAuthHandlers)),
    Layer.provide(requestScopedMiddleware(rsLive).layer),
    Layer.provideMerge(SessionAuthLive),
  );

// Routes scoped to a specific org (membership management, switching, etc.).
// Auth is enforced by `OrgAuth` middleware declared on `OrgHttpApi`.
//
// OrgHttpApi mounts under `/api/:org/...` AND `/api/:org/:workspace/...` so
// the same org-level endpoints (workspaces list/create, members, etc.) stay
// reachable from either context — the URL-context fetch wrapper in the
// react package always prefixes outgoing `/api/...` requests with the
// page's URL handle pair. `start.ts` strips the leading `/api` before
// forwarding, so the prefixes here omit it.
//
// Each mount needs its own `HttpApiBuilder.layer(OrgHttpApi)` instance
// because Effect's Layer system memoizes a shared instance and only the
// first prefix's routes would register otherwise (see
// `apps/cloud/src/api/protected.ts` for the same pattern).
const OrgPrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/:org"),
  ),
);

const OrgWorkspacePrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/:org/:workspace"),
  ),
);

const makeOrgLayer = () =>
  HttpApiBuilder.layer(OrgHttpApi).pipe(
    Layer.provide(Layer.mergeAll(OrgHandlers, WorkspacesHandlers)),
  );

export const makeOrgApiLive = (
  rsLive: Layer.Layer<DbService | UserStoreService>,
) => {
  const requestScopedLayer = requestScopedMiddleware(rsLive).layer;
  const orgMount = makeOrgLayer().pipe(
    Layer.provide(requestScopedLayer),
    Layer.provideMerge(OrgAuthLive),
    Layer.provide(OrgPrefixedRouterLayer),
  );
  const workspaceMount = makeOrgLayer().pipe(
    Layer.provide(requestScopedLayer),
    Layer.provideMerge(OrgAuthLive),
    Layer.provide(OrgWorkspacePrefixedRouterLayer),
  );
  return Layer.mergeAll(orgMount, workspaceMount);
};

// Default exports use the production per-request layer. Existing callers
// that import `NonProtectedApiLive`/`OrgApiLive` continue to work; the
// `make*` factories exist for tests that need to swap in a fake.
export const NonProtectedApiLive = makeNonProtectedApiLive(
  RequestScopedServicesLive,
);
export const OrgApiLive = makeOrgApiLive(RequestScopedServicesLive);

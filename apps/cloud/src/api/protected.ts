// Production wiring for the protected API. Lives outside `protected-layers.ts`
// because `makeExecutionStack` imports `cloudflare:workers`, which the test
// harness can't load in the workerd test runtime.

import { HttpApiSwagger } from "effect/unstable/httpapi";
import {
  HttpRouter,
  HttpServerRequest,
} from "effect/unstable/http";
import { Effect, Layer } from "effect";

import {
  ExecutionEngineService,
  ExecutorService,
  providePluginExtensions,
  type PluginExtensionServices,
} from "@executor-js/api/server";

import { cloudPlugins, type CloudPlugins } from "./cloud-plugins";
import { AuthContext } from "../auth/middleware";
import { authorizeOrganization } from "../auth/authorize-organization";
import { UserStoreService } from "../auth/context";
import { WorkOSAuth } from "../auth/workos";
import { AutumnService } from "../services/autumn";
import { DbService } from "../services/db";
import { makeExecutionStack } from "../services/execution-stack";
import {
  resolveOrgContext,
  resolveWorkspaceContext,
} from "../services/url-context";
import { HttpResponseError } from "./error-response";
import { RequestScopedServicesLive } from "./layers";
import {
  ProtectedCloudApi,
  ProtectedCloudApiLive,
  RouterConfig,
} from "./protected-layers";
import { requestScopedMiddleware } from "./request-scoped";

// Pre-compute the per-plugin `Effect.provideService(extensionService,
// executor[id])` chain. The plugin spec carries the Service tag so
// this file doesn't import each plugin's `*/api` directly.
const provideExecutorExtensions = providePluginExtensions(cloudPlugins);

// One `HttpRouter` middleware that:
//   1. authenticates the WorkOS sealed session,
//   2. verifies live org membership (closes the JWT-cache gap — see
//      `auth/authorize-organization.ts`),
//   3. resolves the org name (and optionally workspace from the URL),
//   4. builds the per-request executor + engine,
//   5. provides `AuthContext` + the execution-stack services to the handler.
//
// Errors are NOT caught here: failures propagate as typed errors and are
// rendered to a JSON response by the framework's `Respondable` pipeline
// (see `HttpResponseError` in `./error-response.ts`).
//
// Workspace requests (`/api/:org/:workspace/...`) follow the same auth
// path — workspaces don't have separate ACLs in v1, so org membership is
// the only check. The middleware reads `:org` and `:workspace` off
// `RouteContext.params` and picks the correct executor factory
// (`createWorkspaceExecutor` vs `createGlobalExecutor`).
const ExecutionStackMiddleware = HttpRouter.middleware<{
  // The plugin extension Services this middleware satisfies are derived
  // from `typeof cloudPlugins` — no per-plugin `*ExtensionService`
  // imports at the host. Runtime binding mirrors the type:
  // `providePluginExtensions(cloudPlugins)(executor)` below.
  provides:
    | AuthContext
    | ExecutorService
    | ExecutionEngineService
    | PluginExtensionServices<CloudPlugins>;
}>()(
  Effect.gen(function* () {
    const longLived = yield* Effect.context<WorkOSAuth | AutumnService>();
    return (httpEffect) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const handle = params["org"];
        const workspaceSlug = params["workspace"] ?? null;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const workos = yield* WorkOSAuth;
        const session = yield* workos.authenticateRequest(webRequest);
        if (!session) {
          return yield* new HttpResponseError({
            status: 401,
            code: "unauthorized",
            message: "Unauthorized",
          });
        }
        if (!handle) {
          return yield* new HttpResponseError({
            status: 404,
            code: "no_organization",
            message: "Missing organization in URL",
          });
        }
        if (workspaceSlug) {
          const resolved = yield* resolveWorkspaceContext(handle, workspaceSlug).pipe(
            Effect.catchTag("OrganizationHandleNotFound", () =>
              Effect.succeed(null),
            ),
            Effect.catchTag("WorkspaceSlugNotFound", () =>
              Effect.succeed(null),
            ),
          );
          if (!resolved) {
            return yield* new HttpResponseError({
              status: 404,
              code: "no_organization",
              message: `Context "${handle}/${workspaceSlug}" not found`,
            });
          }
          const org = yield* authorizeOrganization(session.userId, resolved.organization.id);
          if (!org) {
            return yield* new HttpResponseError({
              status: 403,
              code: "no_organization",
              message: "Not a member of this organization",
            });
          }
          const auth = AuthContext.of({
            accountId: session.userId,
            organizationId: org.id,
            email: session.email,
            name: `${session.firstName ?? ""} ${session.lastName ?? ""}`.trim() || null,
            avatarUrl: session.avatarUrl ?? null,
          });
          const { executor, engine } = yield* makeExecutionStack({
            userId: auth.accountId,
            organizationId: org.id,
            organizationName: org.name,
            workspaceId: resolved.workspace.id,
            workspaceName: resolved.workspace.name,
          });
          return yield* httpEffect.pipe(
            Effect.provideService(AuthContext, auth),
            Effect.provideService(ExecutorService, executor),
            Effect.provideService(ExecutionEngineService, engine),
            provideExecutorExtensions(executor),
          );
        }
        const resolved = yield* resolveOrgContext(handle).pipe(
          Effect.catchTag("OrganizationHandleNotFound", () => Effect.succeed(null)),
        );
        if (!resolved) {
          return yield* new HttpResponseError({
            status: 404,
            code: "no_organization",
            message: `Organization "${handle}" not found`,
          });
        }
        const org = yield* authorizeOrganization(session.userId, resolved.organization.id);
        if (!org) {
          return yield* new HttpResponseError({
            status: 403,
            code: "no_organization",
            message: "Not a member of this organization",
          });
        }
        const auth = AuthContext.of({
          accountId: session.userId,
          organizationId: org.id,
          email: session.email,
          name: `${session.firstName ?? ""} ${session.lastName ?? ""}`.trim() || null,
          avatarUrl: session.avatarUrl ?? null,
        });
        const { executor, engine } = yield* makeExecutionStack({
          userId: auth.accountId,
          organizationId: org.id,
          organizationName: org.name,
        });
        return yield* httpEffect.pipe(
          Effect.provideService(AuthContext, auth),
          Effect.provideService(ExecutorService, executor),
          Effect.provideService(ExecutionEngineService, engine),
          provideExecutorExtensions(executor),
        );
      }).pipe(Effect.provideContext(longLived));
  }),
);

// Layers that swap the boot router with prefixed views. Two prefixes serve
// the SAME endpoints — the request URL determines which scope stack the
// middleware builds. `HttpRouter.prefixed` returns a wrapper that delegates
// to the underlying router state, so non-protected routes (auth, autumn,
// swagger) keep their unprefixed paths.
const OrgPrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) => router.prefixed("/api/:org")),
);

const WorkspacePrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/api/:org/:workspace"),
  ),
);

// `rsLive` is the per-request DB layer. Combining it into the auth
// middleware collapses `requires: DbService | UserStoreService` to
// never (so `.layer` is a real Layer instead of the "Need to combine"
// type-error sentinel) AND makes the postgres.js socket request-scoped:
// the layer rebuilds per HTTP request, satisfying Cloudflare Workers'
// I/O isolation. Exposed as a factory so tests can swap in a counting
// fake — see `apps/cloud/src/api.request-scope.node.test.ts`.
export const makeProtectedApiLive = (
  rsLive: Layer.Layer<DbService | UserStoreService>,
) => {
  const protectedMiddleware = ExecutionStackMiddleware.combine(
    requestScopedMiddleware(rsLive),
  ).layer;
  const orgMount = ProtectedCloudApiLive.pipe(
    Layer.provide(protectedMiddleware),
    Layer.provide(OrgPrefixedRouterLayer),
  );
  const workspaceMount = ProtectedCloudApiLive.pipe(
    Layer.provide(protectedMiddleware),
    Layer.provide(WorkspacePrefixedRouterLayer),
  );
  return Layer.mergeAll(orgMount, workspaceMount).pipe(
    Layer.provideMerge(HttpApiSwagger.layer(ProtectedCloudApi, { path: "/docs" })),
    Layer.provideMerge(RouterConfig),
  );
};

export const ProtectedApiLive = makeProtectedApiLive(RequestScopedServicesLive);

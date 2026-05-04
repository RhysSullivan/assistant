// Shared HTTP test harness for node-pool integration tests.
//
// Stands up the real ProtectedCloudApi against a real DbService and
// every real plugin (openapi / mcp / graphql / workos-vault), with
// two test-only swaps:
//
//   - `OrgAuthLive` is replaced with `FakeOrgAuthLive`, which reads
//     the org handle from the URL `/api/:org/...` prefix instead of
//     the WorkOS cookie.
//   - `workos-vault` is configured with an in-memory `WorkOSVaultClient`
//     so secret writes never reach WorkOS's real API.
//
// Tests get a `fetchForOrg(orgId)` they can hand to `FetchHttpClient`
// and then call `HttpApiClient.make(ProtectedCloudApi)` against it.
// Each test picks its own org id (usually a random UUID) so rows don't
// collide across tests. The harness seeds an organizations row whose
// `handle` equals the org id so `resolveOrgContext(orgId)` succeeds.
//
// Workspace requests use `asWorkspace(orgId, workspaceSlug, …)`, which
// pre-seeds the workspace row + rewrites outgoing URLs to
// `/api/${orgId}/${workspaceSlug}${path}`. The middleware reads both
// segments off the URL params and builds a workspace-scoped executor.

import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { HttpApiBuilder, HttpApiClient, HttpApiSwagger } from "effect/unstable/httpapi";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
} from "effect/unstable/http";

import {
  ExecutionEngineService,
  ExecutorService,
  providePluginExtensions,
  type PluginExtensionServices,
} from "@executor-js/api/server";
import { createExecutionEngine } from "@executor-js/execution";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import {
  collectSchemas,
  createExecutor,
} from "@executor-js/sdk";
import {
  makePostgresAdapter,
  makePostgresBlobStore,
} from "@executor-js/storage-postgres";
import { makeTestWorkOSVaultClient } from "@executor-js/plugin-workos-vault/testing";

import executorConfig from "../../../executor.config";
import { AuthContext } from "../../auth/middleware";
import {
  ProtectedCloudApi,
  ProtectedCloudApiHandlers,
  RouterConfig,
} from "../../api/protected-layers";
import { DbService } from "../db";
import {
  orgScopeId,
  userOrgScopeId,
  userWorkspaceScopeId,
  workspaceScopeId,
} from "../ids";
import {
  buildGlobalScopeStack,
  buildWorkspaceScopeStack,
} from "../scope-stack";
import { organizations, workspaces } from "../schema";

export const TEST_BASE_URL = "http://test.local";
/**
 * Optional header for tests that need to act as a specific user. The org
 * id always comes from the URL prefix; only the user is opt-in.
 */
export const TEST_USER_HEADER = "x-test-user-id";

// `asOrg(orgId, …)` callers don't care which specific user they are, only
// that the executor has a valid user-org scope. We give each org a stable
// default user so list/get operations at the org scope remain deterministic
// across calls within a single test.
const defaultUserFor = (orgId: string) => `default_user_${orgId}`;

// ---------------------------------------------------------------------------
// Executor factory — mirrors apps/cloud/services/executor#createScopedExecutor
// but with an in-memory test vault client (see
// `@executor-js/plugin-workos-vault/testing`).
// ---------------------------------------------------------------------------

const fakeVault = makeTestWorkOSVaultClient();
const testPlugins = executorConfig.plugins({ workosVaultClient: fakeVault });

const createTestScopedExecutor = (
  userId: string,
  orgId: string,
  orgName: string,
  workspace: { id: string; name: string } | null,
) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    const plugins = testPlugins;
    const schema = collectSchemas(plugins);
    const adapter = makePostgresAdapter({ db, schema });
    const blobs = makePostgresBlobStore({ db });
    const scopes = workspace
      ? buildWorkspaceScopeStack({
          userId,
          organizationId: orgId,
          organizationName: orgName,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        })
      : buildGlobalScopeStack({
          userId,
          organizationId: orgId,
          organizationName: orgName,
        });
    return yield* createExecutor({
      scopes,
      adapter,
      blobs,
      plugins,
      onElicitation: "accept-all",
    });
  });

// Seed a test organization row whose handle equals the supplied id so the
// production middleware resolution path (`resolveOrgContext(handle)`) works
// against the test db. Uses `onConflictDoNothing` so repeated `asOrg(orgId,
// …)` calls within a test don't fight each other. Lives inside the request
// pipeline (so DbService is already provided) instead of at factory time
// — bringing up its own DbService.Live in a Node test process leaks a
// postgres.js socket that ECONNRESETs across test files.
const seedTestOrg = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    yield* Effect.promise(() =>
      db
        .insert(organizations)
        .values({ id: orgId, handle: orgId, name: `Org ${orgId}` })
        .onConflictDoNothing(),
    );
  });

/**
 * Same approach as `seedTestOrg`: idempotent insert of a workspace under the
 * given org so `resolveWorkspaceContext(orgId, slug)` succeeds. Returns the
 * workspace row (loaded via SELECT after the upsert), so callers know the
 * generated `workspace_<...>` id without a second round-trip.
 */
const seedTestWorkspace = (orgId: string, slug: string) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    const id = `workspace_test_${orgId}_${slug}`;
    yield* Effect.promise(() =>
      db
        .insert(workspaces)
        .values({
          id,
          organizationId: orgId,
          slug,
          name: `Workspace ${slug}`,
        })
        .onConflictDoNothing(),
    );
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.organizationId, orgId)),
    );
    const found = rows.find((r) => r.slug === slug);
    if (!found) {
      return yield* Effect.die(
        new Error(`failed to seed workspace ${slug} in org ${orgId}`),
      );
    }
    return found;
  });

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

// Pull the URL `:org` (+ optional `:workspace`) segments from a request path.
// The protected API mounts under `/api/:org/...` and `/api/:org/:workspace/...`.
// Returning `null` for a malformed prefix forces the downstream handler to
// surface a typed error rather than panicking.
//
// Workspace detection is conservative: any path with three+ segments after
// `/api/` is *potentially* workspace-scoped, but the tests pre-seed the
// workspace row before issuing the request via `asWorkspace(...)`, so we
// gate on the seeded set. That avoids accidentally treating an org-only
// endpoint with extra path segments (e.g. `/scopes/:id/sources`) as a
// workspace request.
const seededWorkspaces = new Map<string, Set<string>>();
const orgHandleFromPath = (pathname: string):
  | { orgId: string; workspaceSlug: string | null }
  | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length < 2 || parts[0] !== "api") return null;
  const orgId = parts[1] ?? null;
  if (!orgId) return null;
  const candidate = parts[2] ?? null;
  const orgSet = seededWorkspaces.get(orgId);
  const workspaceSlug =
    candidate && orgSet?.has(candidate) ? candidate : null;
  return { orgId, workspaceSlug };
};

const rememberWorkspace = (orgId: string, slug: string) => {
  let set = seededWorkspaces.get(orgId);
  if (!set) {
    set = new Set();
    seededWorkspaces.set(orgId, set);
  }
  set.add(slug);
};

// Test version of the production `ExecutionStackMiddleware` — reads the
// org (and optional workspace) handle from the URL prefix (matching
// production: `/api/:org/...` and `/api/:org/:workspace/...`), builds a
// test-scoped executor against the live postgres test db with a fake
// WorkOS vault, and provides `AuthContext` + the executor services to the
// handler. The optional `x-test-user-id` header overrides the default
// per-org user.
const TestExecutionStackMiddleware = HttpRouter.middleware<{
  provides:
    | AuthContext
    | ExecutorService
    | ExecutionEngineService
    | PluginExtensionServices<typeof testPlugins>;
}>()(
  // Layer-time setup — captures `DbService` so the per-request function
  // only depends on `HttpRouter`-Provided context. See `api/protected.ts`
  // for the same pattern.
  Effect.gen(function* () {
    const context = yield* Effect.context<DbService>();
    const provideExecutorExtensions = providePluginExtensions(testPlugins);
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const url = new URL(webRequest.url);
        const parsed = orgHandleFromPath(url.pathname);
        if (!parsed) {
          return yield* Effect.die(
            new Error(`missing /api/:org prefix in ${url.pathname}`),
          );
        }
        const { orgId, workspaceSlug } = parsed;
        // Lazily seed the org row so production-mode `resolveOrgContext`
        // (used anywhere that takes the URL handle as truth) finds it.
        // The test harness can't pre-seed at factory time without leaking
        // sockets.
        yield* seedTestOrg(orgId);
        // Resolve the workspace row (if present) BEFORE building the
        // executor — `buildWorkspaceScopeStack` needs the deterministic
        // `workspace_<id>` to scope reads/writes against.
        const workspace = workspaceSlug
          ? yield* seedTestWorkspace(orgId, workspaceSlug)
          : null;
        const userHeader = request.headers[TEST_USER_HEADER];
        const userId =
          typeof userHeader === "string" && userHeader.length > 0
            ? userHeader
            : defaultUserFor(orgId);
        const orgName = `Org ${orgId}`;
        const executor = yield* createTestScopedExecutor(
          userId,
          orgId,
          orgName,
          workspace ? { id: workspace.id, name: workspace.name } : null,
        );
        const engine = createExecutionEngine({
          executor,
          codeExecutor: makeQuickJsExecutor(),
        });
        return yield* httpEffect.pipe(
          Effect.provideService(
            AuthContext,
            AuthContext.of({
              accountId: userId,
              organizationId: orgId,
              email: "test@example.com",
              name: "Test User",
              avatarUrl: null,
            }),
          ),
          Effect.provideService(ExecutorService, executor),
          Effect.provideService(ExecutionEngineService, engine),
          provideExecutorExtensions(executor),
        );
      }).pipe(Effect.provideContext(context));
  }),
).layer;

// Mirror the production setup — the protected API mounts under `/api/:org`
// AND `/api/:org/:workspace` via prefixed router views. The outer
// `HttpRouter` from `HttpServer.layerServices` is the underlying state;
// each prefix wrapper rewrites added paths only. Both prefixes serve the
// SAME endpoints — the request URL determines which scope stack the
// middleware builds.
const OrgPrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/api/:org"),
  ),
);

const WorkspacePrefixedRouterLayer = Layer.effect(HttpRouter.HttpRouter)(
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/api/:org/:workspace"),
  ),
);

const orgMount = HttpApiBuilder.layer(ProtectedCloudApi).pipe(
  Layer.provide(ProtectedCloudApiHandlers),
  Layer.provide(TestExecutionStackMiddleware),
  Layer.provide(OrgPrefixedRouterLayer),
);

const workspaceMount = HttpApiBuilder.layer(ProtectedCloudApi).pipe(
  Layer.provide(ProtectedCloudApiHandlers),
  Layer.provide(TestExecutionStackMiddleware),
  Layer.provide(WorkspacePrefixedRouterLayer),
);

const TestApiLive = Layer.mergeAll(orgMount, workspaceMount).pipe(
  Layer.provideMerge(HttpApiSwagger.layer(ProtectedCloudApi, { path: "/docs" })),
  Layer.provideMerge(RouterConfig),
  Layer.provideMerge(DbService.Live),
  Layer.provideMerge(HttpServer.layerServices),
);

const handler = HttpRouter.toWebHandler(TestApiLive, { disableLogger: true }).handler;

// Rewrite outgoing request URLs to `/api/${orgId}${path}` (or
// `/api/${orgId}/${workspaceSlug}${path}` for workspace requests) so the
// prefixed router matches. Tests construct `HttpApiClient.make(...)`
// against `TEST_BASE_URL` and call endpoint methods that build paths like
// `/scopes/.../sources` — we splice the org (+workspace) segment in front
// before the request reaches the in-process handler.
const rewriteRequestForPrefix = async (
  base: Request,
  prefix: string,
  extraHeaders: Record<string, string> = {},
): Promise<Request> => {
  const url = new URL(base.url);
  if (!url.pathname.startsWith(`${prefix}/`) && url.pathname !== prefix) {
    url.pathname = `${prefix}${url.pathname.startsWith("/") ? "" : "/"}${url.pathname}`;
  }
  // Buffer the body — Node's `RequestInit` rejects stream bodies without
  // `duplex: "half"`, and forwarding a Request through `new Request(url, {...})`
  // is fragile across runtimes. ArrayBuffer survives the round-trip cleanly.
  const body =
    base.method === "GET" || base.method === "HEAD"
      ? undefined
      : await base.arrayBuffer();
  return new Request(url.toString(), {
    method: base.method,
    headers: { ...Object.fromEntries(base.headers), ...extraHeaders },
    body,
  });
};

const rewriteRequestForOrg = (
  base: Request,
  orgId: string,
  extraHeaders: Record<string, string> = {},
): Promise<Request> =>
  rewriteRequestForPrefix(base, `/api/${orgId}`, extraHeaders);

const rewriteRequestForWorkspace = (
  base: Request,
  orgId: string,
  workspaceSlug: string,
  extraHeaders: Record<string, string> = {},
): Promise<Request> =>
  rewriteRequestForPrefix(
    base,
    `/api/${orgId}/${workspaceSlug}`,
    extraHeaders,
  );

export const fetchForOrg = (orgId: string): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const base = input instanceof Request ? input : new Request(input, init);
    const req = await rewriteRequestForOrg(base, orgId);
    return handler(req);
  }) as typeof globalThis.fetch;

export const fetchForUser = (
  userId: string,
  orgId: string,
): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const base = input instanceof Request ? input : new Request(input, init);
    const req = await rewriteRequestForOrg(base, orgId, { [TEST_USER_HEADER]: userId });
    return handler(req);
  }) as typeof globalThis.fetch;

export const fetchForWorkspace = (
  orgId: string,
  workspaceSlug: string,
  userId?: string,
): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const base = input instanceof Request ? input : new Request(input, init);
    const extraHeaders: Record<string, string> = {};
    if (userId !== undefined) {
      extraHeaders[TEST_USER_HEADER] = userId;
    }
    const req = await rewriteRequestForWorkspace(
      base,
      orgId,
      workspaceSlug,
      extraHeaders,
    );
    return handler(req);
  }) as typeof globalThis.fetch;

export const clientLayerForOrg = (orgId: string) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetchForOrg(orgId))),
  );

export const clientLayerForUser = (userId: string, orgId: string) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch)(fetchForUser(userId, orgId)),
    ),
  );

export const clientLayerForWorkspace = (
  orgId: string,
  workspaceSlug: string,
  userId?: string,
) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch)(
        fetchForWorkspace(orgId, workspaceSlug, userId),
      ),
    ),
  );

// Constructs an HttpApiClient bound to the given org, hands it to `body`,
// and provides the org-scoped fetch layer in one step. Keeps per-test
// Effect blocks focused on the actual assertions.
type ApiShape = HttpApiClient.ForApi<typeof ProtectedCloudApi>;

export const asOrg = <A, E>(
  orgId: string,
  body: (client: ApiShape) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ProtectedCloudApi, { baseUrl: TEST_BASE_URL });
    return yield* body(client);
  }).pipe(Effect.provide(clientLayerForOrg(orgId))) as Effect.Effect<A, E>;

/**
 * Run the body with a `ProtectedCloudApi` client whose URLs target the
 * `/api/${orgId}/${workspaceSlug}/...` mount. The harness pre-registers
 * the slug so the in-process middleware treats subsequent requests as
 * workspace-scoped (third URL segment after `/api/` is treated as a
 * workspace slug only when seeded — see `orgHandleFromPath`). The actual
 * row insert happens lazily on first request inside the middleware via
 * `seedTestWorkspace`, so the executor's scope stack ends up with the
 * deterministic `workspace_<...>` id.
 */
export const asWorkspace = <A, E>(
  orgId: string,
  workspaceSlug: string,
  body: (client: ApiShape) => Effect.Effect<A, E>,
): Effect.Effect<A, E> => {
  rememberWorkspace(orgId, workspaceSlug);
  return Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ProtectedCloudApi, { baseUrl: TEST_BASE_URL });
    return yield* body(client);
  }).pipe(
    Effect.provide(clientLayerForWorkspace(orgId, workspaceSlug)),
  ) as Effect.Effect<A, E>;
};

/** As `asWorkspace` but threads a specific user id through. */
export const asWorkspaceUser = <A, E>(
  userId: string,
  orgId: string,
  workspaceSlug: string,
  body: (client: ApiShape) => Effect.Effect<A, E>,
): Effect.Effect<A, E> => {
  rememberWorkspace(orgId, workspaceSlug);
  return Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ProtectedCloudApi, { baseUrl: TEST_BASE_URL });
    return yield* body(client);
  }).pipe(
    Effect.provide(clientLayerForWorkspace(orgId, workspaceSlug, userId)),
  ) as Effect.Effect<A, E>;
};

// Same as `asOrg` but also threads a specific user id through the fake
// OrgAuth, so the built executor's user-org scope id is
// `user-org:${userId}:${orgId}`. Use this for tests that care about
// per-user isolation inside the same org.
export const asUser = <A, E>(
  userId: string,
  orgId: string,
  body: (client: ApiShape) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ProtectedCloudApi, { baseUrl: TEST_BASE_URL });
    return yield* body(client);
  }).pipe(
    Effect.provide(clientLayerForUser(userId, orgId)),
  ) as Effect.Effect<A, E>;

// Exposed so tests can build the same user-org scope id the harness uses
// when writing at a specific user's scope.
export const testUserOrgScopeId = (userId: string, orgId: string) =>
  userOrgScopeId(userId, orgId);

// Workspace-scoped variants. The harness derives workspace ids
// deterministically from the seed slug (`workspace_test_<orgId>_<slug>`),
// so tests can build expected scope ids without round-tripping the row.
export const testWorkspaceId = (orgId: string, slug: string) =>
  `workspace_test_${orgId}_${slug}`;
export const testWorkspaceScopeId = (orgId: string, slug: string) =>
  workspaceScopeId(testWorkspaceId(orgId, slug));
export const testUserWorkspaceScopeId = (
  userId: string,
  orgId: string,
  slug: string,
) => userWorkspaceScopeId(userId, testWorkspaceId(orgId, slug));

// Re-exports so call sites don't need a second import.
export { ProtectedCloudApi };
export { orgScopeId, userOrgScopeId, workspaceScopeId, userWorkspaceScopeId };

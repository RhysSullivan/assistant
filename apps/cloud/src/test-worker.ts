// ---------------------------------------------------------------------------
// vitest-pool-workers test entry
// ---------------------------------------------------------------------------
//
// Re-exports the real McpSessionDO and drives /mcp + /.well-known/* through
// the same Effect HttpEffect the prod worker uses. Only the `McpAuth` service
// is swapped: the real impl calls WorkOS's JWKS endpoint, which can't be
// reached from the test isolate.
//
// `stdio`-transport branch of plugin-mcp is now dynamically imported (see
// packages/plugins/mcp/src/sdk/connection.ts), so `@modelcontextprotocol/
// sdk/client/stdio.js` no longer touches `node:child_process` at module
// load — that was SIGSEGV-ing workerd during test instantiation.
// ---------------------------------------------------------------------------

import { HttpEffect } from "effect/unstable/http";
import { Effect, Layer } from "effect";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import {
  McpAuth,
  McpAuthLive,
  McpOrganizationAuth,
  McpOrganizationAuthLive,
  McpUrlContextResolver,
  McpUrlContextResolverLive,
  classifyMcpPath,
  mcpAuthorized,
  mcpApp,
  mcpUnauthorized,
} from "./mcp";
import { McpJwtVerificationError } from "./mcp-auth";
import { newId, slugifyHandle } from "./services/ids";
import { organizations, workspaces } from "./services/schema";
import { pickFreeOrgHandle } from "./services/user-store";
import { resolveOrgContext, resolveWorkspaceContext } from "./services/url-context";
import { DbService } from "./services/db";
import { CoreSharedServices } from "./api/core-shared-services";
import { UserStoreService } from "./auth/context";
import { parseTestBearer } from "./test-bearer";
import { DoTelemetryLive } from "./services/telemetry";

export { McpSessionDO } from "./mcp-session";

const TestMcpAuthLive = Layer.succeed(McpAuth)({
  verifyBearer: (request) =>
    Effect.gen(function* () {
      const header = request.headers.get("authorization");
      if (!header?.startsWith("Bearer ")) return mcpUnauthorized("missing_bearer");
      const rawToken = header.slice("Bearer ".length);
      if (rawToken === "test-system-error") {
        return yield* Effect.fail(new McpJwtVerificationError({
          cause: new Error("simulated jwks fetch failure"),
          reason: "system",
        }));
      }
      const token = parseTestBearer(rawToken);
      return token ? mcpAuthorized(token) : mcpUnauthorized("invalid_token");
    }),
});

const TestMcpOrganizationAuthLive = Layer.succeed(McpOrganizationAuth)({
  authorize: (_accountId, organizationId) =>
    Effect.succeed(!organizationId.startsWith("revoked_")),
});

// ---------------------------------------------------------------------------
// Test URL-context resolver
// ---------------------------------------------------------------------------
//
// `:org` / `:org/:workspace` paths route through the real DB-backed resolver
// (the test seed-org endpoint inserts the same rows the resolver reads).
//
// The `/mcp` fallback uses the bearer's encoded `organizationId` as the
// "user's first org membership" — we can't reach WorkOS from the test
// isolate. We still upsert the org row from the bearer because legacy tests
// don't pre-seed for the fallback path.
// ---------------------------------------------------------------------------

const TestDbLive = DbService.Live;
const TestUserStoreLive = UserStoreService.Live.pipe(Layer.provide(TestDbLive));
const TestUrlContextServices = Layer.mergeAll(
  TestDbLive,
  TestUserStoreLive,
  CoreSharedServices,
);

const TestMcpUrlContextResolverLive = Layer.succeed(McpUrlContextResolver)({
  resolve: (segments, token) =>
    Effect.gen(function* () {
      if (segments.kind === "global") {
        const resolved = yield* resolveOrgContext(segments.orgHandle).pipe(
          Effect.catchTag("OrganizationHandleNotFound", () =>
            Effect.succeed(null),
          ),
        );
        if (!resolved) {
          return { _tag: "OrgNotFound", handle: segments.orgHandle } as const;
        }
        return { _tag: "global", resolved } as const;
      }
      if (segments.kind === "workspace") {
        const resolved = yield* resolveWorkspaceContext(
          segments.orgHandle,
          segments.workspaceSlug,
        ).pipe(
          Effect.catchTags({
            OrganizationHandleNotFound: () => Effect.succeed(null),
            WorkspaceSlugNotFound: () => Effect.succeed(null),
          }),
        );
        if (!resolved) {
          const orgOnly = yield* resolveOrgContext(segments.orgHandle).pipe(
            Effect.catchTag("OrganizationHandleNotFound", () =>
              Effect.succeed(null),
            ),
          );
          if (!orgOnly) {
            return { _tag: "OrgNotFound", handle: segments.orgHandle } as const;
          }
          return {
            _tag: "WorkspaceNotFound",
            orgHandle: segments.orgHandle,
            slug: segments.workspaceSlug,
          } as const;
        }
        return { _tag: "workspace", resolved } as const;
      }
      // Fallback: the test bearer carries an encoded organizationId — that
      // doubles as the "first org" hint here. Auto-mirror the org row if
      // the test didn't pre-seed it; production does the same via
      // `resolveOrganization` against WorkOS, which we can't reach from
      // the test isolate.
      if (!token.organizationId) {
        return { _tag: "NoFallbackOrg", userId: token.accountId } as const;
      }
      const users = yield* UserStoreService;
      const existing = yield* users.use((s) =>
        s.getOrganization(token.organizationId!),
      );
      if (existing) {
        return { _tag: "global", resolved: { organization: existing } } as const;
      }
      const created = yield* users.use((s) =>
        s.upsertOrganization({
          id: token.organizationId!,
          name: token.organizationId!,
        }),
      );
      return { _tag: "global", resolved: { organization: created } } as const;
    }).pipe(Effect.provide(TestUrlContextServices)),
});

// ---------------------------------------------------------------------------
// Test seed endpoint
// ---------------------------------------------------------------------------
//
// Exposed at POST /__test__/seed-org. Tests call it via SELF.fetch to insert
// organization rows into the same PGlite-backed database the DO reads from. Doing
// the insert from inside the test worker avoids pulling postgres.js into the
// test file's top-level imports (which segfaulted workerd during test
// module instantiation).
// ---------------------------------------------------------------------------

const seedConnectionString = (envArg: Record<string, unknown>) =>
  (envArg.DATABASE_URL as string | undefined) ??
  "postgresql://postgres:postgres@127.0.0.1:5434/postgres";

// Per-request postgres connection. Sharing a `Sql` across requests breaks
// mid-suite — vitest-pool-workers' isolate resets tear down the socket and
// the next insert errors with "read end of pipe was aborted". Open + close
// per request; the test DO runtime does the same to avoid workerd's
// cross-request I/O guard.
const handleSeedOrg = async (
  request: Request,
  envArg: Record<string, unknown>,
): Promise<Response> => {
  const body = (await request.json()) as { id: string; name: string };
  const sql: Sql = postgres(seedConnectionString(envArg), {
    max: 1,
    idle_timeout: 0,
    max_lifetime: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    const db = drizzle(sql, { schema: { organizations } });
    const handle = await pickFreeOrgHandle(db, slugifyHandle(body.name));
    const [row] = await db
      .insert(organizations)
      .values({ id: body.id, name: body.name, handle })
      .onConflictDoUpdate({
        target: organizations.id,
        set: { name: body.name },
      })
      .returning();
    return new Response(JSON.stringify({ handle: row?.handle ?? handle }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
};

const handleSeedWorkspace = async (
  request: Request,
  envArg: Record<string, unknown>,
): Promise<Response> => {
  const body = (await request.json()) as {
    organizationId: string;
    name: string;
    slug?: string;
    id?: string;
  };
  const sql: Sql = postgres(seedConnectionString(envArg), {
    max: 1,
    idle_timeout: 0,
    max_lifetime: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    const db = drizzle(sql, { schema: { workspaces } });
    const slug = body.slug ?? slugifyHandle(body.name);
    const id = body.id ?? newId("workspace");
    const [row] = await db
      .insert(workspaces)
      .values({
        id,
        organizationId: body.organizationId,
        slug,
        name: body.name,
      })
      .returning();
    return new Response(JSON.stringify({ id: row!.id, slug: row!.slug }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
};

// Provide a WebSdk-backed tracer on the worker side so the `mcp.request` span
// gets reported to the OTLP receiver. Prod uses the global TracerProvider
// installed by `otel-cf-workers.instrument()`; the test worker has no such
// instrumentation, so we reuse DoTelemetryLive (it's a plain WebSdk +
// OTLPTraceExporter — not Durable-Object-specific) to stand in.
const testMcpFetch = HttpEffect.toWebHandler(
  mcpApp.pipe(
    Effect.provide(
      Layer.mergeAll(
        TestMcpAuthLive,
        TestMcpOrganizationAuthLive,
        TestMcpUrlContextResolverLive,
        DoTelemetryLive,
      ),
    ),
  ),
);

const realAuthMcpFetch = HttpEffect.toWebHandler(
  mcpApp.pipe(
    Effect.provide(
      Layer.mergeAll(
        McpAuthLive,
        McpOrganizationAuthLive,
        McpUrlContextResolverLive,
        DoTelemetryLive,
      ),
    ),
  ),
);

export default {
  async fetch(request: Request, envArg: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__test__/seed-org" && request.method === "POST") {
      return handleSeedOrg(request, envArg);
    }
    if (url.pathname === "/__test__/seed-workspace" && request.method === "POST") {
      return handleSeedWorkspace(request, envArg);
    }
    if (url.pathname === "/__test__/real-auth-mcp") {
      const mcpUrl = new URL(request.url);
      mcpUrl.pathname = "/mcp";
      return realAuthMcpFetch(new Request(mcpUrl, request));
    }
    if (classifyMcpPath(url.pathname) !== null) {
      return testMcpFetch(request);
    }
    return new Response("not found", { status: 404 });
  },
};

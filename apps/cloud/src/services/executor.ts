// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, new SDK shape
// ---------------------------------------------------------------------------
//
// Each invocation of `createGlobalExecutor` / `createWorkspaceExecutor` runs
// inside a request-scoped Effect and yields a fresh executor bound to the
// current DbService's per-request postgres.js client. Cloudflare Workers +
// Hyperdrive demand fresh connections per request, so "build once" means
// "once per request" here.

import { Effect } from "effect";

import {
  collectSchemas,
  createExecutor,
  type Scope,
} from "@executor-js/sdk";
import {
  makePostgresAdapter,
  makePostgresBlobStore,
} from "@executor-js/storage-postgres";

import { env } from "cloudflare:workers";
import executorConfig from "../../executor.config";
import { DbService } from "./db";
import {
  buildGlobalScopeStack,
  buildWorkspaceScopeStack,
  type GlobalContext,
  type WorkspaceContext,
} from "./scope-stack";

// ---------------------------------------------------------------------------
// Plugin list lives in `executor.config.ts` — that file is the single
// source of truth, also consumed by the schema-gen CLI and the test
// harness. Per-request runtime values (WorkOS credentials from the
// Worker env) are passed through the factory's `deps` parameter.
// ---------------------------------------------------------------------------

export type CloudPlugins = ReturnType<typeof executorConfig.plugins>;

const orgPlugins = (): CloudPlugins =>
  executorConfig.plugins({
    workosCredentials: {
      apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID,
    },
  });

// ---------------------------------------------------------------------------
// Create a fresh executor for a request context (stateless, per-request).
//
// Scope stacks are built innermost-first by `./scope-stack`:
//   global    -> [userOrgScope, orgScope]
//   workspace -> [userWorkspaceScope, workspaceScope, userOrgScope, orgScope]
//
// OAuth tokens land at `ctx.scopes[0]` (the most-personal scope) by default,
// so per-user credentials can't leak across users in the same workspace/org.
// Source rows and shared credentials live on the outer scopes.
// ---------------------------------------------------------------------------

const buildExecutor = (scopes: ReadonlyArray<Scope>) =>
  Effect.gen(function* () {
    const { db } = yield* DbService;
    const plugins = orgPlugins();
    const schema = collectSchemas(plugins);
    const adapter = makePostgresAdapter({ db, schema });
    const blobs = makePostgresBlobStore({ db });
    return yield* createExecutor({
      scopes,
      adapter,
      blobs,
      plugins,
      onElicitation: "accept-all",
    });
  });

export const createGlobalExecutor = (ctx: GlobalContext) =>
  buildExecutor(buildGlobalScopeStack(ctx));

export const createWorkspaceExecutor = (ctx: WorkspaceContext) =>
  buildExecutor(buildWorkspaceScopeStack(ctx));

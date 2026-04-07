// ---------------------------------------------------------------------------
// Cloud API — core handlers from @executor/api + cloud-specific plugins + auth
// ---------------------------------------------------------------------------

import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpServer,
} from "@effect/platform";
import { Effect, Layer } from "effect";

import { addGroup, CoreHandlers, ExecutorService, ExecutionEngineService } from "@executor/api";
import { createExecutionEngine } from "@executor/execution";
import { OpenApiGroup, OpenApiExtensionService, OpenApiHandlers } from "@executor/plugin-openapi/api";
import { McpGroup, McpExtensionService, McpHandlers } from "@executor/plugin-mcp/api";
import { GoogleDiscoveryGroup, GoogleDiscoveryExtensionService, GoogleDiscoveryHandlers } from "@executor/plugin-google-discovery/api";
import { GraphqlGroup, GraphqlExtensionService, GraphqlHandlers } from "@executor/plugin-graphql/api";

import { createTeamExecutor } from "./services/executor";
import { CloudAuthApi } from "./auth/api";
import { CloudAuthHandlers } from "./auth/handlers";
import { AuthContext, UserStoreService } from "./auth/context";
import { WorkOSAuth } from "./auth/workos";
import type { DrizzleDb } from "./services/db";

// ---------------------------------------------------------------------------
// Cloud API — core + cloud plugins + cloud auth (no onepassword)
// ---------------------------------------------------------------------------

const CloudApi = addGroup(OpenApiGroup)
  .add(McpGroup)
  .add(GoogleDiscoveryGroup)
  .add(GraphqlGroup)
  .add(CloudAuthApi);

const CloudApiBase = HttpApiBuilder.api(CloudApi).pipe(
  Layer.provide(CoreHandlers),
  Layer.provide(Layer.mergeAll(
    OpenApiHandlers,
    McpHandlers,
    GoogleDiscoveryHandlers,
    GraphqlHandlers,
    CloudAuthHandlers,
  )),
);

// ---------------------------------------------------------------------------
// Cookie parser
// ---------------------------------------------------------------------------

const parseCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  return match.slice(name.length + 1) || null;
};

// ---------------------------------------------------------------------------
// Create API handler with auth-based executor resolution
// ---------------------------------------------------------------------------

export const createCloudApiHandler = (db: DrizzleDb, encryptionKey: string) => {
  return async (request: Request): Promise<Response> => {
    // Authenticate via WorkOS sealed session
    const auth = await Effect.runPromise(
      Effect.gen(function* () {
        const workos = yield* WorkOSAuth;
        return yield* workos.authenticateRequest(request);
      }).pipe(Effect.provide(WorkOSAuth.Default)),
    );

    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teamId = parseCookie(request.headers.get("cookie"), "executor_team");
    if (!teamId) {
      return Response.json({ error: "No team selected" }, { status: 401 });
    }

    // Resolve team name
    const userStore = UserStoreService.layer(db);
    const team = await Effect.runPromise(
      Effect.gen(function* () {
        const users = yield* UserStoreService;
        return yield* users.use((s) => s.getTeam(teamId));
      }).pipe(Effect.provide(userStore)),
    );
    const teamName = team?.name ?? "Unknown Team";

    const executor = await Effect.runPromise(
      createTeamExecutor(db, teamId, teamName, encryptionKey),
    );

    const pluginExtensions = Layer.mergeAll(
      Layer.succeed(OpenApiExtensionService, executor.openapi),
      Layer.succeed(McpExtensionService, executor.mcp),
      Layer.succeed(GoogleDiscoveryExtensionService, executor.googleDiscovery),
      Layer.succeed(GraphqlExtensionService, executor.graphql),
    );

    const engine = createExecutionEngine({ executor });

    const handler = HttpApiBuilder.toWebHandler(
      HttpApiSwagger.layer().pipe(
        Layer.provideMerge(HttpApiBuilder.middlewareOpenApi()),
        Layer.provideMerge(CloudApiBase),
        Layer.provideMerge(pluginExtensions),
        Layer.provideMerge(Layer.succeed(ExecutorService, executor)),
        Layer.provideMerge(Layer.succeed(ExecutionEngineService, engine)),
        Layer.provideMerge(Layer.succeed(AuthContext, {
          userId: auth.userId,
          email: auth.email,
          teamId,
          name: `${auth.firstName ?? ""} ${auth.lastName ?? ""}`.trim() || null,
          avatarUrl: auth.avatarUrl,
        })),
        Layer.provideMerge(UserStoreService.layer(db)),
        Layer.provideMerge(WorkOSAuth.Default),
        Layer.provideMerge(HttpServer.layerContext),
      ),
      { middleware: HttpMiddleware.logger },
    );

    try {
      const response = await handler.handler(request);

      if (auth.refreshedCookie) {
        const newResponse = new Response(response.body, response);
        newResponse.headers.append("Set-Cookie", auth.refreshedCookie);
        return newResponse;
      }

      return response;
    } finally {
      await Effect.runPromise(executor.close()).catch(() => undefined);
      handler.dispose();
    }
  };
};

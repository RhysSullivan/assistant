import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import type { AccountId } from "#schema";
import {
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  SecretMaterialIdSchema,
  SourceIdSchema,
} from "#schema";
import type { ToolPath } from "@executor/codemode-core";

import {
  createControlPlaneRuntime,
  LiveExecutionManagerService,
} from "./index";
import { createSourceFromPayload } from "./source-definitions";
import { decodeSourceCredentialSelectionContent } from "./source-credential-interactions";
import { persistSource } from "./source-store";
import { withControlPlaneClient } from "./test-http-client";

const makeRuntime = Effect.acquireRelease(
  createControlPlaneRuntime({
    localDataDir: ":memory:",
    workspaceRoot: mkdtempSync(join(tmpdir(), "executor-control-plane-runtime-")),
  }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

type OpenApiSpecServer = {
  baseUrl: string;
  specUrl: string;
  close: () => Promise<void>;
};

const makeOpenApiSpecServer = Effect.acquireRelease(
  Effect.promise<OpenApiSpecServer>(
    () =>
      new Promise<OpenApiSpecServer>((resolve, reject) => {
        const openApiDocument = JSON.stringify({
          openapi: "3.0.3",
          info: {
            title: "GitHub Test API",
            version: "1.0.0",
          },
          paths: {
            "/repos/{owner}/{repo}": {
              get: {
                operationId: "repos/get-repo",
                tags: ["repos"],
                summary: "Get a repository",
                responses: {
                  200: {
                    description: "ok",
                  },
                },
              },
            },
          },
        });

        const server = createServer((request, response) => {
          if (request.url !== "/openapi.json") {
            response.statusCode = 404;
            response.end();
            return;
          }

          response.statusCode = 200;
          response.setHeader("content-type", "application/json");
          response.end(openApiDocument);
        });

        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Failed to bind OpenAPI runtime test server"));
            return;
          }

          const baseUrl = `http://127.0.0.1:${address.port}`;
          resolve({
            baseUrl,
            specUrl: `${baseUrl}/openapi.json`,
            close: () =>
              new Promise<void>((closeResolve, closeReject) => {
                server.close((error) => {
                  if (error) {
                    closeReject(error);
                    return;
                  }

                  closeResolve();
                });
              }),
          });
        });
      }),
  ),
  (server) => Effect.promise(() => server.close()).pipe(Effect.orDie),
);

const expectLeft = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.either(effect).pipe(
    Effect.flatMap((result) =>
      result._tag === "Left"
        ? Effect.succeed(result.left)
        : Effect.fail(new Error("Expected effect to fail")),
    ),
  );

describe("control-plane-runtime", () => {
  it.scoped("writes local source changes through executor.jsonc", () =>
    Effect.gen(function* () {
      const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-local-config-runtime-"));
      const runtime = yield* Effect.acquireRelease(
        createControlPlaneRuntime({
          localDataDir: ":memory:",
          workspaceRoot,
        }),
        (createdRuntime) => Effect.promise(() => createdRuntime.close()).pipe(Effect.orDie),
      );
      const openApiServer = yield* makeOpenApiSpecServer;
      const installation = runtime.localInstallation;

      const createdSource = yield* withControlPlaneClient(
        { runtime, accountId: installation.accountId },
        (client) =>
          client.sources.create({
            path: { workspaceId: installation.workspaceId },
            payload: {
              name: "GitHub",
              kind: "openapi",
              endpoint: openApiServer.baseUrl,
              namespace: "github",
              binding: {
                specUrl: openApiServer.specUrl,
                defaultHeaders: null,
              },
              auth: { kind: "none" },
            },
          }),
      );

      const configPath = join(workspaceRoot, ".executor", "executor.jsonc");
      const createdConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
        sources?: Record<string, { kind: string; connection: { endpoint: string } }>;
      };
      expect(createdConfig.sources?.github?.kind).toBe("openapi");
      expect(createdConfig.sources?.github?.connection.endpoint).toBe(openApiServer.baseUrl);

      const removed = yield* withControlPlaneClient(
        { runtime, accountId: installation.accountId },
        (client) =>
          client.sources.remove({
            path: {
              workspaceId: installation.workspaceId,
              sourceId: createdSource.id,
            },
          }),
      );
      expect(removed.removed).toBe(true);

      const removedConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
        sources?: Record<string, unknown>;
      };
      expect(removedConfig.sources?.github).toBeUndefined();
    }),
    60_000,
  );


  it.scoped("captures credential requests through the local HTML flow without persisting raw tokens", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const executionId = ExecutionIdSchema.make("exec_local_credential");
      const sourceId = SourceIdSchema.make("github");
      const interactionSuffix = "executor.sources.add:test";
      const interactionId = ExecutionInteractionIdSchema.make(
        `${executionId}:${interactionSuffix}`,
      );
      const now = Date.now();

      yield* runtime.persistence.rows.executions.insert({
        id: executionId,
        workspaceId: installation.workspaceId,
        createdByAccountId: installation.accountId,
        status: "running",
        code: "return await tools.executor.sources.add(...)",
        resultJson: null,
        errorText: null,
        logsJson: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const localSource = yield* createSourceFromPayload({
        workspaceId: installation.workspaceId,
        sourceId,
        payload: {
          name: "GitHub",
          kind: "openapi",
          endpoint: "https://api.github.com",
          status: "auth_required",
          enabled: true,
          namespace: "github",
          importAuthPolicy: "reuse_runtime",
          binding: {
            specUrl: "https://example.com/github-openapi.yaml",
            defaultHeaders: null,
          },
          importAuth: { kind: "none" },
          auth: { kind: "none" },
        },
        now,
      }).pipe(Effect.orDie);
      yield* persistSource(runtime.persistence.rows, localSource, {
        actorAccountId: installation.accountId,
      }).pipe(
        Effect.provide(runtime.runtimeLayer),
        Effect.orDie,
      );

      const interactionFiber = yield* Effect.gen(function* () {
        const liveExecutionManager = yield* LiveExecutionManagerService;
        const onElicitation = liveExecutionManager.createOnElicitation({
          rows: runtime.persistence.rows,
          executionId,
        });

        return yield* onElicitation({
          interactionId: interactionSuffix,
          path: "executor.sources.add" as ToolPath,
          sourceKey: "executor",
          args: {
            kind: "openapi",
            endpoint: "https://api.github.com",
            specUrl: "https://example.com/github-openapi.yaml",
            name: "GitHub",
            workspaceId: installation.workspaceId,
            sourceId,
          },
          elicitation: {
            mode: "url",
            message: "Open the secure credential page to connect GitHub",
            url: `http://127.0.0.1/v1/workspaces/${encodeURIComponent(installation.workspaceId)}/sources/${encodeURIComponent(sourceId)}/credentials?interactionId=${encodeURIComponent(interactionId)}`,
            elicitationId: interactionSuffix,
          },
        });
      }).pipe(
        Effect.provide(runtime.runtimeLayer),
        Effect.fork,
      );

      yield* Effect.yieldNow();

      const pendingInteraction = yield* runtime.persistence.rows.executionInteractions
        .getPendingByExecutionId(executionId);
      assertTrue(Option.isSome(pendingInteraction));
      expect(pendingInteraction.value.id).toBe(interactionId);

      const page = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.sources.credentialPage({
            path: {
              workspaceId: installation.workspaceId,
              sourceId,
            },
            urlParams: {
              interactionId: pendingInteraction.value.id,
            },
          }),
      );
      expect(page).toContain("Configure Source Access");
      expect(page).toContain("GitHub");
      expect(page).toContain("Continue without auth");

      const submittedPage = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.sources.credentialSubmit({
            path: {
              workspaceId: installation.workspaceId,
              sourceId,
            },
            urlParams: {
              interactionId: pendingInteraction.value.id,
            },
            payload: {
              action: "submit",
              token: "ghp_local_test_token",
            },
          }),
      );
      expect(submittedPage).toContain("Credential Stored");

      const response = yield* Fiber.join(interactionFiber);
      expect(response.action).toBe("accept");
      expect(response.content?.authKind).toBe("bearer");

      const decodedCredentialSelection = decodeSourceCredentialSelectionContent(
        response.content,
      );
      expect(decodedCredentialSelection.authKind).toBe("bearer");
      expect(
        decodedCredentialSelection.authKind === "bearer"
          ? decodedCredentialSelection.tokenRef.providerId
          : null,
      ).toBe("postgres");

      const tokenSecretMaterialId = SecretMaterialIdSchema.make(
        decodedCredentialSelection.authKind === "bearer"
          ? decodedCredentialSelection.tokenRef.handle
          : "",
      );
      const storedSecret = yield* runtime.persistence.rows.secretMaterials.getById(
        tokenSecretMaterialId,
      );
      assertTrue(Option.isSome(storedSecret));
      expect(storedSecret.value.value).toBe("ghp_local_test_token");

      const storedInteraction = yield* runtime.persistence.rows.executionInteractions.getById(
        pendingInteraction.value.id,
      );
      assertTrue(Option.isSome(storedInteraction));
      expect(storedInteraction.value.responseJson).toContain("\"authKind\":\"bearer\"");
      expect(storedInteraction.value.responseJson).not.toContain("tokenRef");
      expect(storedInteraction.value.responseJson).not.toContain("ghp_local_test_token");
    }),
  );

  it.scoped("allows continuing an OpenAPI source credential request without auth", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const executionId = ExecutionIdSchema.make("exec_local_credential_continue");
      const sourceId = SourceIdSchema.make("github");
      const interactionSuffix = "executor.sources.add:continue";
      const interactionId = ExecutionInteractionIdSchema.make(
        `${executionId}:${interactionSuffix}`,
      );
      const now = Date.now();

      yield* runtime.persistence.rows.executions.insert({
        id: executionId,
        workspaceId: installation.workspaceId,
        createdByAccountId: installation.accountId,
        status: "running",
        code: "return await tools.executor.sources.add(...)",
        resultJson: null,
        errorText: null,
        logsJson: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const localSource = yield* createSourceFromPayload({
        workspaceId: installation.workspaceId,
        sourceId,
        payload: {
          name: "GitHub",
          kind: "openapi",
          endpoint: "https://api.github.com",
          status: "auth_required",
          enabled: true,
          namespace: "github",
          importAuthPolicy: "reuse_runtime",
          binding: {
            specUrl: "https://example.com/github-openapi.yaml",
            defaultHeaders: null,
          },
          importAuth: { kind: "none" },
          auth: { kind: "none" },
        },
        now,
      }).pipe(Effect.orDie);
      yield* persistSource(runtime.persistence.rows, localSource, {
        actorAccountId: installation.accountId,
      }).pipe(
        Effect.provide(runtime.runtimeLayer),
        Effect.orDie,
      );

      const interactionFiber = yield* Effect.gen(function* () {
        const liveExecutionManager = yield* LiveExecutionManagerService;
        const onElicitation = liveExecutionManager.createOnElicitation({
          rows: runtime.persistence.rows,
          executionId,
        });

        return yield* onElicitation({
          interactionId: interactionSuffix,
          path: "executor.sources.add" as ToolPath,
          sourceKey: "executor",
          args: {
            kind: "openapi",
            endpoint: "https://api.github.com",
            specUrl: "https://example.com/github-openapi.yaml",
            name: "GitHub",
            workspaceId: installation.workspaceId,
            sourceId,
          },
          elicitation: {
            mode: "url",
            message: "Open the secure credential page to connect GitHub",
            url: `http://127.0.0.1/v1/workspaces/${encodeURIComponent(installation.workspaceId)}/sources/${encodeURIComponent(sourceId)}/credentials?interactionId=${encodeURIComponent(interactionId)}`,
            elicitationId: interactionSuffix,
          },
        });
      }).pipe(
        Effect.provide(runtime.runtimeLayer),
        Effect.fork,
      );

      yield* Effect.yieldNow();

      const pendingInteraction = yield* runtime.persistence.rows.executionInteractions
        .getPendingByExecutionId(executionId);
      assertTrue(Option.isSome(pendingInteraction));

      const submittedPage = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.sources.credentialSubmit({
            path: {
              workspaceId: installation.workspaceId,
              sourceId,
            },
            urlParams: {
              interactionId: pendingInteraction.value.id,
            },
            payload: {
              action: "continue",
            },
          }),
      );

      expect(submittedPage).toContain("Continuing without auth");

      const response = yield* Fiber.join(interactionFiber);
      expect(response.action).toBe("accept");
      expect(response.content).toEqual({
        authKind: "none",
      });

      const storedInteraction = yield* runtime.persistence.rows.executionInteractions.getById(
        pendingInteraction.value.id,
      );
      assertTrue(Option.isSome(storedInteraction));
      expect(storedInteraction.value.responseJson).toContain("\"authKind\":\"none\"");
      expect(storedInteraction.value.responseJson).not.toContain("tokenRef");
    }),
  );

});

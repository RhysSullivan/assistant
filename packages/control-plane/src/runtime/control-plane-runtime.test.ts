import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import type { AccountId } from "#schema";
import {
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  type ExecutionInteraction,
  SecretMaterialIdSchema,
  SourceIdSchema,
} from "#schema";
import type { ToolPath } from "@executor/codemode-core";

import {
  createControlPlaneRuntime,
  LiveExecutionManagerService,
  provideControlPlaneRuntime,
} from "./index";
import { createSourceFromPayload } from "./source-definitions";
import { decodeSourceCredentialSelectionContent } from "./source-credential-interactions";
import { persistSource } from "./source-store";
import { withControlPlaneClient } from "./test-http-client";

const makeRuntime = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const workspaceRoot = yield* fs.makeTempDirectoryScoped({
    prefix: "executor-control-plane-runtime-",
  });
  const homeConfigPath = join(workspaceRoot, ".executor-home.jsonc");
  const homeStateDirectory = join(workspaceRoot, ".executor-home-state");

  return yield* Effect.acquireRelease(
    createControlPlaneRuntime({
      workspaceRoot,
      homeConfigPath,
      homeStateDirectory,
    }),
    (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
  );
}).pipe(Effect.provide(NodeFileSystem.layer));

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
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "executor-local-config-runtime-",
      });
      const homeConfigPath = join(workspaceRoot, ".executor-home.jsonc");
      const homeStateDirectory = join(workspaceRoot, ".executor-home-state");
      const runtime = yield* Effect.acquireRelease(
        createControlPlaneRuntime({
          workspaceRoot,
          homeConfigPath,
          homeStateDirectory,
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
    }).pipe(Effect.provide(NodeFileSystem.layer)),
    60_000,
  );

  it.scoped("manages local secrets through provider-backed metadata rows", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const created = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.local.createSecret({
            payload: {
              name: "GitHub PAT",
              value: "ghp_test_token",
              providerId: "local",
            },
          }),
      );

      expect(created.providerId).toBe("local");

      const listed = yield* withControlPlaneClient(
        { runtime },
        (client) => client.local.listSecrets({}),
      );
      expect(listed).toEqual([
        expect.objectContaining({
          id: created.id,
          providerId: "local",
          name: "GitHub PAT",
        }),
      ]);

      const updated = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.local.updateSecret({
            path: { secretId: created.id },
            payload: {
              name: "GitHub PAT Updated",
              value: "ghp_test_token_v2",
            },
          }),
      );
      expect(updated.providerId).toBe("local");
      expect(updated.name).toBe("GitHub PAT Updated");

      const storedSecret = yield* runtime.persistence.rows.secretMaterials.getById(
        SecretMaterialIdSchema.make(created.id),
      );
      assertTrue(Option.isSome(storedSecret));
      expect(storedSecret.value.providerId).toBe("local");
      expect(storedSecret.value.value).toBe("ghp_test_token_v2");

      const removed = yield* withControlPlaneClient(
        { runtime },
        (client) =>
          client.local.deleteSecret({
            path: { secretId: created.id },
          }),
      );
      expect(removed.removed).toBe(true);
    }),
  );

  it.scoped("reports safe secret storage options for the current platform", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const config = yield* withControlPlaneClient(
        { runtime },
        (client) => client.local.config({}),
      );

      const keychainProvider =
        config.secretProviders.find((provider) => provider.id === "keychain") ?? null;

      if (process.platform === "linux") {
        expect(config.defaultSecretStoreProvider).toBe("local");
        expect(keychainProvider?.canStore).toBe(false);
        return;
      }

      if (process.platform === "darwin") {
        expect(keychainProvider?.canStore).toBe(true);
        return;
      }

      expect(keychainProvider).toBeNull();
    }),
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
      }).pipe((effect) => provideControlPlaneRuntime(effect, runtime), Effect.orDie);

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
        (effect) => provideControlPlaneRuntime(effect, runtime),
        Effect.fork,
      );

      const waitForPendingInteraction = (
        remaining: number,
      ): Effect.Effect<Option.Option<ExecutionInteraction>, Error> =>
        runtime.persistence.rows.executionInteractions.getPendingByExecutionId(executionId).pipe(
          Effect.flatMap((pendingInteraction) =>
            Option.isSome(pendingInteraction) || remaining <= 0
              ? Effect.succeed(pendingInteraction)
              : Effect.yieldNow().pipe(
                  Effect.zipRight(waitForPendingInteraction(remaining - 1)),
                ),
          ),
        );

      const pendingInteraction = yield* waitForPendingInteraction(20);
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
      ).toBe("local");

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

  it.scoped("returns an empty inspection bundle for auth-required sources without a catalog artifact", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const sourceId = SourceIdSchema.make("googleapis");
      const now = Date.now();

      const localSource = yield* createSourceFromPayload({
        workspaceId: installation.workspaceId,
        sourceId,
        payload: {
          name: "Google Drive",
          kind: "google_discovery",
          endpoint: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
          status: "auth_required",
          enabled: true,
          namespace: "googleapis",
          importAuthPolicy: "reuse_runtime",
          binding: {
            service: "drive",
            version: "v3",
            discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
            scopes: ["https://www.googleapis.com/auth/drive.readonly"],
          },
          importAuth: { kind: "none" },
          auth: { kind: "none" },
        },
        now,
      }).pipe(Effect.orDie);
      yield* persistSource(runtime.persistence.rows, localSource, {
        actorAccountId: installation.accountId,
      }).pipe((effect) => provideControlPlaneRuntime(effect, runtime), Effect.orDie);

      const inspection = yield* withControlPlaneClient(
        { runtime, accountId: installation.accountId },
        (client) =>
          client.sources.inspection({
            path: {
              workspaceId: installation.workspaceId,
              sourceId,
            },
          }),
      );

      expect(inspection.source.id).toBe(sourceId);
      expect(inspection.source.status).toBe("auth_required");
      expect(inspection.toolCount).toBe(0);
      expect(inspection.tools).toEqual([]);
    }),
  );

  it.scoped("still fails inspection when a connected source is missing its catalog artifact", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const sourceId = SourceIdSchema.make("googleapis");
      const now = Date.now();

      const localSource = yield* createSourceFromPayload({
        workspaceId: installation.workspaceId,
        sourceId,
        payload: {
          name: "Google Drive",
          kind: "google_discovery",
          endpoint: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
          status: "connected",
          enabled: true,
          namespace: "googleapis",
          importAuthPolicy: "reuse_runtime",
          binding: {
            service: "drive",
            version: "v3",
            discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
            scopes: ["https://www.googleapis.com/auth/drive.readonly"],
          },
          importAuth: { kind: "none" },
          auth: { kind: "none" },
        },
        now,
      }).pipe(Effect.orDie);
      yield* persistSource(runtime.persistence.rows, localSource, {
        actorAccountId: installation.accountId,
      }).pipe((effect) => provideControlPlaneRuntime(effect, runtime), Effect.orDie);

      const error = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: installation.accountId },
          (client) =>
            client.sources.inspection({
              path: {
                workspaceId: installation.workspaceId,
                sourceId,
              },
            }),
        ),
      );

      expect(error.message).toContain("Catalog artifact missing for source googleapis");
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
      }).pipe((effect) => provideControlPlaneRuntime(effect, runtime), Effect.orDie);

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
        (effect) => provideControlPlaneRuntime(effect, runtime),
        Effect.fork,
      );

      const waitForPendingInteraction = (
        remaining: number,
      ): Effect.Effect<Option.Option<ExecutionInteraction>, Error> =>
        runtime.persistence.rows.executionInteractions.getPendingByExecutionId(executionId).pipe(
          Effect.flatMap((pendingInteraction) =>
            Option.isSome(pendingInteraction) || remaining <= 0
              ? Effect.succeed(pendingInteraction)
              : Effect.yieldNow().pipe(
                  Effect.zipRight(waitForPendingInteraction(remaining - 1)),
                ),
          ),
        );

      const pendingInteraction = yield* waitForPendingInteraction(20);
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

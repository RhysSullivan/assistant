import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  AccountIdSchema,
  decodeBuiltInAuthArtifactConfig,
  McpSourceAuthSessionDataJsonSchema,
  SecretMaterialIdSchema,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
  type Source,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "../persistence";
import {
  loadLocalExecutorConfig,
  resolveLocalWorkspaceContext,
} from "./local-config";
import {
  RuntimeLocalWorkspaceService,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import {
  loadLocalWorkspaceState,
} from "./local-workspace-state";
import { persistSource, removeSourceById } from "./source-store";

const makePersistence: Effect.Effect<SqlControlPlanePersistence, unknown, Scope.Scope> =
  Effect.acquireRelease(
  createSqlControlPlanePersistence({
    localDataDir: ":memory:",
  }),
  (persistence) =>
    Effect.tryPromise({
      try: () => persistence.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
  );

const encodeSessionDataJson = Schema.encodeSync(McpSourceAuthSessionDataJsonSchema);

const makeRuntimeLocalWorkspace = (input: {
  workspaceId: Source["workspaceId"];
  accountId: ReturnType<typeof AccountIdSchema.make>;
}) =>
  Effect.gen(function* () {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-source-store-"));
    const context = yield* Effect.tryPromise({
      try: () => resolveLocalWorkspaceContext({ workspaceRoot }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const loadedConfig = yield* Effect.tryPromise({
      try: () => loadLocalExecutorConfig(context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return {
      context,
      installation: {
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        organizationId: "org_local_personal" as never,
      },
      loadedConfig,
    } satisfies RuntimeLocalWorkspaceState;
  });

const withRuntimeLocalWorkspace = <A, E>(
  effect: Effect.Effect<A, E, never>,
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState,
) =>
  effect.pipe(
    Effect.provideService(RuntimeLocalWorkspaceService, runtimeLocalWorkspace),
  );

const makeOpenApiSource = (input: {
  workspaceId: Source["workspaceId"];
  sourceId: Source["id"];
  now: number;
  updatedAt?: number;
  name?: string;
  endpoint?: string;
  specUrl?: string;
  auth: Source["auth"];
}): Source => ({
  id: input.sourceId,
  workspaceId: input.workspaceId,
  name: input.name ?? "GitHub",
  kind: "openapi",
  endpoint: input.endpoint ?? "https://api.github.com",
  status: "connected",
  enabled: true,
  namespace: "github",
  bindingVersion: 1,
  binding: {
    specUrl: input.specUrl ?? "https://example.com/openapi.json",
    defaultHeaders: null,
  },
  importAuthPolicy: "reuse_runtime",
  importAuth: { kind: "none" },
  auth: input.auth,
  sourceHash: null,
  lastError: null,
  createdAt: input.now,
  updatedAt: input.updatedAt ?? input.now,
});

describe("source-store", () => {
  it.scoped("replaces superseded secrets and removes source auth state cleanly", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const accountId = AccountIdSchema.make("acc_source_store");
      const workspaceId = WorkspaceIdSchema.make("ws_source_store");
      const sourceId = SourceIdSchema.make("github");
      const firstTokenId = SecretMaterialIdSchema.make("sec_source_store_first");
      const secondTokenId = SecretMaterialIdSchema.make("sec_source_store_second");
      const runtimeLocalWorkspace = yield* makeRuntimeLocalWorkspace({
        workspaceId,
        accountId,
      });

      yield* persistence.rows.secretMaterials.upsert({
        id: firstTokenId,
        name: null,
        purpose: "auth_material",
        value: "ghp_first",
        createdAt: now,
        updatedAt: now,
      });
      yield* persistence.rows.secretMaterials.upsert({
        id: secondTokenId,
        name: null,
        purpose: "auth_material",
        value: "ghp_second",
        createdAt: now,
        updatedAt: now,
      });

      yield* withRuntimeLocalWorkspace(
        persistSource(
          persistence.rows,
          makeOpenApiSource({
            workspaceId,
            sourceId,
            now,
            auth: {
              kind: "bearer",
              headerName: "Authorization",
              prefix: "Bearer ",
              token: {
                providerId: "postgres",
                handle: firstTokenId,
              },
            },
          }),
        ),
        runtimeLocalWorkspace,
      );

      yield* persistence.rows.sourceAuthSessions.upsert({
        id: SourceAuthSessionIdSchema.make("src_auth_source_store"),
        workspaceId,
        sourceId,
        actorAccountId: accountId,
        executionId: null,
        interactionId: null,
        providerKind: "mcp_oauth",
        credentialSlot: "runtime",
        status: "pending",
        state: "state_source_store",
        sessionDataJson: encodeSessionDataJson({
          kind: "mcp_oauth",
          endpoint: "https://api.github.com",
          redirectUri: "http://127.0.0.1/callback",
          scope: null,
          resourceMetadataUrl: null,
          authorizationServerUrl: null,
          resourceMetadata: null,
          authorizationServerMetadata: null,
          clientInformation: null,
          codeVerifier: "verifier",
          authorizationUrl: "https://example.com/auth",
        }),
        errorText: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      yield* withRuntimeLocalWorkspace(
        persistSource(
          persistence.rows,
          makeOpenApiSource({
            workspaceId,
            sourceId,
            now,
            updatedAt: now + 1,
            auth: {
              kind: "bearer",
              headerName: "Authorization",
              prefix: "Bearer ",
              token: {
                providerId: "postgres",
                handle: secondTokenId,
              },
            },
          }),
        ),
        runtimeLocalWorkspace,
      );

      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(firstTokenId))).toBe(true);
      const authArtifacts = yield* persistence.rows.authArtifacts.listByWorkspaceId(workspaceId);
      expect(authArtifacts).toHaveLength(1);
      const decoded = authArtifacts[0] ? decodeBuiltInAuthArtifactConfig(authArtifacts[0]) : null;
      expect(
        decoded !== null && decoded.artifactKind === "static_bearer"
          ? decoded.config.token.handle
          : null,
      ).toBe(secondTokenId);

      const removed = yield* withRuntimeLocalWorkspace(
        removeSourceById(persistence.rows, {
          workspaceId,
          sourceId,
        }),
        runtimeLocalWorkspace,
      );
      expect(removed).toBe(true);

      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(secondTokenId))).toBe(true);
      expect(yield* persistence.rows.authArtifacts.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(yield* persistence.rows.sourceAuthSessions.listByWorkspaceId(workspaceId)).toHaveLength(0);
      const config = yield* Effect.tryPromise({
        try: () => loadLocalExecutorConfig(runtimeLocalWorkspace.context),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      expect(config.config?.sources?.[sourceId]).toBeUndefined();
      const workspaceState = yield* Effect.tryPromise({
        try: () => loadLocalWorkspaceState(runtimeLocalWorkspace.context),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
      expect(workspaceState.sources[sourceId]).toBeUndefined();
    }),
  );

  it.scoped("creates a fresh actor-scoped credential when a shared credential already exists", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const accountId = AccountIdSchema.make("acc_actor_scoped");
      const workspaceId = WorkspaceIdSchema.make("ws_actor_scoped");
      const sourceId = SourceIdSchema.make("github");
      const sharedTokenId = SecretMaterialIdSchema.make("sec_actor_scoped_shared");
      const runtimeLocalWorkspace = yield* makeRuntimeLocalWorkspace({
        workspaceId,
        accountId,
      });
      yield* persistence.rows.secretMaterials.upsert({
        id: sharedTokenId,
        name: null,
        purpose: "auth_material",
        value: "ghp_shared",
        createdAt: now,
        updatedAt: now,
      });

      const source = makeOpenApiSource({
        workspaceId,
        sourceId,
        now,
        auth: {
          kind: "bearer",
          headerName: "Authorization",
          prefix: "Bearer ",
          token: {
            providerId: "postgres",
            handle: sharedTokenId,
          },
        },
      });

      yield* withRuntimeLocalWorkspace(
        persistSource(persistence.rows, source),
        runtimeLocalWorkspace,
      );
      yield* withRuntimeLocalWorkspace(
        persistSource(
          persistence.rows,
          {
            ...source,
            updatedAt: now + 1,
          },
          {
            actorAccountId: accountId,
          },
        ),
        runtimeLocalWorkspace,
      );

      const authArtifacts = yield* persistence.rows.authArtifacts.listByWorkspaceAndSourceId({
        workspaceId,
        sourceId,
      });
      expect(authArtifacts).toHaveLength(2);
      expect(authArtifacts.some((artifact) => artifact.actorAccountId === null)).toBe(true);
      expect(authArtifacts.some((artifact) => artifact.actorAccountId === accountId)).toBe(true);
      expect(new Set(authArtifacts.map((artifact) => artifact.id)).size).toBe(2);
    }),
  );
});

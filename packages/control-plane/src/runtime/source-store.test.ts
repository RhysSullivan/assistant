import { describe, expect, it } from "@effect/vitest";

import {
  AccountIdSchema,
  OrganizationIdSchema,
  SecretMaterialIdSchema,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
  type Source,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "../persistence";
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

const makeOpenApiSource = (input: {
  workspaceId: Source["workspaceId"];
  sourceId: Source["id"];
  now: number;
  updatedAt?: number;
  auth: Source["auth"];
}): Source => ({
  id: input.sourceId,
  workspaceId: input.workspaceId,
  name: "GitHub",
  kind: "openapi",
  endpoint: "https://api.github.com",
  status: "connected",
  enabled: true,
  namespace: "github",
  transport: null,
  queryParams: null,
  headers: null,
  specUrl: "https://example.com/openapi.json",
  defaultHeaders: null,
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
      const organizationId = OrganizationIdSchema.make("org_source_store");
      const workspaceId = WorkspaceIdSchema.make("ws_source_store");
      const sourceId = SourceIdSchema.make("src_source_store");
      const firstTokenId = SecretMaterialIdSchema.make("sec_source_store_first");
      const secondTokenId = SecretMaterialIdSchema.make("sec_source_store_second");

      yield* persistence.rows.organizations.insert({
        id: organizationId,
        slug: "source-store",
        name: "Source Store",
        status: "active",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
      yield* persistence.rows.workspaces.insert({
        id: workspaceId,
        organizationId,
        name: "Primary",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
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

      yield* persistSource(
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
      );

      yield* persistence.rows.sourceAuthSessions.upsert({
        id: SourceAuthSessionIdSchema.make("src_auth_source_store"),
        workspaceId,
        sourceId,
        actorAccountId: accountId,
        executionId: null,
        interactionId: null,
        providerKind: "mcp_oauth",
        status: "pending",
        state: "state_source_store",
        sessionDataJson: JSON.stringify({
          kind: "mcp_oauth",
          endpoint: "https://api.github.com",
          redirectUri: "http://127.0.0.1/callback",
          scope: null,
          resourceMetadataUrl: null,
          authorizationServerUrl: null,
          resourceMetadataJson: null,
          authorizationServerMetadataJson: null,
          clientInformationJson: null,
          codeVerifier: "verifier",
          authorizationUrl: "https://example.com/auth",
        }),
        errorText: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistSource(
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
      );

      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(firstTokenId))).toBe(true);
      expect(yield* persistence.rows.credentials.listByWorkspaceId(workspaceId)).toHaveLength(1);
      expect((yield* persistence.rows.credentials.listByWorkspaceId(workspaceId))[0]?.tokenHandle).toBe(
        secondTokenId,
      );

      const removed = yield* removeSourceById(persistence.rows, {
        workspaceId,
        sourceId,
      });
      expect(removed).toBe(true);

      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(secondTokenId))).toBe(true);
      expect(yield* persistence.rows.sources.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(yield* persistence.rows.credentials.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(yield* persistence.rows.sourceAuthSessions.listByWorkspaceId(workspaceId)).toHaveLength(0);
    }),
  );

  it.scoped("creates a fresh actor-scoped credential when a shared credential already exists", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const accountId = AccountIdSchema.make("acc_actor_scoped");
      const organizationId = OrganizationIdSchema.make("org_actor_scoped");
      const workspaceId = WorkspaceIdSchema.make("ws_actor_scoped");
      const sourceId = SourceIdSchema.make("src_actor_scoped");
      const sharedTokenId = SecretMaterialIdSchema.make("sec_actor_scoped_shared");

      yield* persistence.rows.organizations.insert({
        id: organizationId,
        slug: "actor-scoped",
        name: "Actor Scoped",
        status: "active",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
      yield* persistence.rows.workspaces.insert({
        id: workspaceId,
        organizationId,
        name: "Primary",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
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

      yield* persistSource(persistence.rows, source);
      yield* persistSource(
        persistence.rows,
        {
          ...source,
          updatedAt: now + 1,
        },
        {
          actorAccountId: accountId,
        },
      );

      const credentials = yield* persistence.rows.credentials.listByWorkspaceAndSourceId({
        workspaceId,
        sourceId,
      });
      expect(credentials).toHaveLength(2);
      expect(credentials.some((credential) => credential.actorAccountId === null)).toBe(true);
      expect(credentials.some((credential) => credential.actorAccountId === accountId)).toBe(true);
      expect(new Set(credentials.map((credential) => credential.id)).size).toBe(2);
    }),
  );
});

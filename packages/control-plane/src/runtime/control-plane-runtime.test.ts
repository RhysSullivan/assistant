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
import type { ToolPath } from "@executor-v3/codemode-core";

import {
  createSqlControlPlaneRuntime,
  LiveExecutionManagerService,
} from "./index";
import { withControlPlaneClient } from "./test-http-client";

const makeRuntime = Effect.acquireRelease(
  createSqlControlPlaneRuntime({ localDataDir: ":memory:" }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
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
  it.scoped("supports full CRUD flow over HTTP API", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const createOrg = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.organizations.create({
            payload: {
              name: "Acme",
            },
          }),
      );
      const organizationId = createOrg.id;

      const createWorkspace = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.workspaces.create({
            path: { organizationId },
            payload: { name: "Primary" },
          }),
      );
      expect(createWorkspace.createdByAccountId).toBe("acc_1");
      const workspaceId = createWorkspace.id;

      yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.sources.create({
            path: { workspaceId },
            payload: {
              name: "Github",
              kind: "openapi",
              endpoint: "https://api.github.com",
              specUrl: "https://api.github.com/openapi.json",
              auth: {
                kind: "none",
              },
            },
          }),
      );

      yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.policies.create({
            path: { workspaceId },
            payload: {
              resourceType: "tool_path",
              resourcePattern: "source.github.*",
              matchType: "glob",
              effect: "allow",
              approvalMode: "auto",
              priority: 50,
              enabled: true,
            },
          }),
      );

      const listSources = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.sources.list({
            path: { workspaceId },
          }),
      );
      expect(listSources.length).toBe(1);

      const listPolicies = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.policies.list({
            path: { workspaceId },
          }),
      );
      expect(listPolicies.length).toBe(1);
    }),
  );

  it.scoped("captures credential requests through the local HTML flow without persisting raw tokens", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const executionId = ExecutionIdSchema.make("exec_local_credential");
      const sourceId = SourceIdSchema.make("src_local_credential");
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

      yield* runtime.persistence.rows.sources.insert({
        id: sourceId,
        workspaceId: installation.workspaceId,
        name: "GitHub",
        kind: "openapi",
        endpoint: "https://api.github.com",
        status: "auth_required",
        enabled: true,
        namespace: "github",
        transport: null,
        queryParamsJson: null,
        headersJson: null,
        specUrl: "https://example.com/github-openapi.yaml",
        defaultHeadersJson: null,
        authKind: "none",
        authHeaderName: null,
        authPrefix: null,
        sourceHash: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

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
      expect(typeof response.content?.tokenSecretMaterialId).toBe("string");

      const tokenSecretMaterialId = SecretMaterialIdSchema.make(
        String(response.content?.tokenSecretMaterialId),
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
      expect(storedInteraction.value.responseJson).toContain("tokenSecretMaterialId");
      expect(storedInteraction.value.responseJson).not.toContain("ghp_local_test_token");
    }),
  );

  it.scoped("allows continuing an OpenAPI source credential request without auth", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;
      const executionId = ExecutionIdSchema.make("exec_local_credential_continue");
      const sourceId = SourceIdSchema.make("src_local_credential_continue");
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

      yield* runtime.persistence.rows.sources.insert({
        id: sourceId,
        workspaceId: installation.workspaceId,
        name: "GitHub",
        kind: "openapi",
        endpoint: "https://api.github.com",
        status: "auth_required",
        enabled: true,
        namespace: "github",
        transport: null,
        queryParamsJson: null,
        headersJson: null,
        specUrl: "https://example.com/github-openapi.yaml",
        defaultHeadersJson: null,
        authKind: "none",
        authHeaderName: null,
        authPrefix: null,
        sourceHash: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

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
      expect(storedInteraction.value.responseJson).not.toContain("tokenSecretMaterialId");
    }),
  );

  it.scoped("scopes organization list/get to memberships", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const orgOne = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) =>
          client.organizations.create({
            payload: { name: "Org One" },
          }),
      );

      const orgTwo = yield* withControlPlaneClient(
        { runtime, accountId: "acc_2" },
        (client) =>
          client.organizations.create({
            payload: { name: "Org Two" },
          }),
      );

      const listForAcc1 = yield* withControlPlaneClient(
        { runtime, accountId: "acc_1" },
        (client) => client.organizations.list({}),
      );

      expect(listForAcc1.length).toBe(1);

      const getOtherOrgError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_1" },
          (client) =>
            client.organizations.get({
              path: { organizationId: orgTwo.id },
            }),
        ),
      );

      assertTrue(orgOne.id.length > 0);
      expect(getOtherOrgError._tag).toBe("ControlPlaneNotFoundError");
    }),
  );

  it.scoped("prevents viewers from workspace manage actions", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const organization = yield* withControlPlaneClient(
        { runtime, accountId: "owner_acc" },
        (client) =>
          client.organizations.create({
            payload: { name: "Secured Org" },
          }),
      );

      const workspace = yield* withControlPlaneClient(
        { runtime, accountId: "owner_acc" },
        (client) =>
          client.workspaces.create({
            path: { organizationId: organization.id },
            payload: { name: "Secured WS" },
          }),
      );

      yield* withControlPlaneClient(
        { runtime, accountId: "owner_acc" },
        (client) =>
          client.memberships.create({
            path: { organizationId: organization.id },
            payload: {
              accountId: "viewer_acc" as AccountId,
              role: "viewer",
              status: "active",
            },
          }),
      );

      const viewerDeleteError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "viewer_acc" },
          (client) =>
            client.workspaces.remove({
              path: { workspaceId: workspace.id },
            }),
        ),
      );

      expect(viewerDeleteError._tag).toBe("ControlPlaneForbiddenError");
    }),
  );

  it.scoped("blocks organization manage across tenants", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const orgA = yield* withControlPlaneClient(
        { runtime, accountId: "acc_a" },
        (client) =>
          client.organizations.create({
            payload: { name: "Org A" },
          }),
      );

      const orgB = yield* withControlPlaneClient(
        { runtime, accountId: "acc_b" },
        (client) =>
          client.organizations.create({
            payload: { name: "Org B" },
          }),
      );

      const patchOtherOrgError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_a" },
          (client) =>
            client.organizations.update({
              path: { organizationId: orgB.id },
              payload: { name: "Renamed" },
            }),
        ),
      );
      assertTrue(orgA.id.length > 0);
      expect(patchOtherOrgError._tag).toBe("ControlPlaneForbiddenError");

      const deleteOtherOrgError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_a" },
          (client) =>
            client.organizations.remove({
              path: { organizationId: orgB.id },
            }),
        ),
      );
      expect(deleteOtherOrgError._tag).toBe("ControlPlaneForbiddenError");
    }),
  );

  it.scoped("suspended creators cannot manage previously created workspaces", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const organization = yield* withControlPlaneClient(
        { runtime, accountId: "creator_acc" },
        (client) =>
          client.organizations.create({
            payload: { name: "Creator Org" },
          }),
      );

      const workspace = yield* withControlPlaneClient(
        { runtime, accountId: "creator_acc" },
        (client) =>
          client.workspaces.create({
            path: { organizationId: organization.id },
            payload: { name: "Creator WS" },
          }),
      );

      yield* withControlPlaneClient(
        { runtime, accountId: "creator_acc" },
        (client) =>
          client.memberships.update({
            path: {
              organizationId: organization.id,
              accountId: "creator_acc" as AccountId,
            },
            payload: { status: "suspended" },
          }),
      );

      const deleteWorkspaceError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "creator_acc" },
          (client) =>
            client.workspaces.remove({
              path: { workspaceId: workspace.id },
            }),
        ),
      );

      expect(deleteWorkspaceError._tag).toBe("ControlPlaneForbiddenError");
    }),
  );

  it.scoped("deleting organization cascades and blocks stale org operations", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const organization = yield* withControlPlaneClient(
        { runtime, accountId: "acc_del" },
        (client) =>
          client.organizations.create({
            payload: { name: "Delete Me" },
          }),
      );

      const workspace = yield* withControlPlaneClient(
        { runtime, accountId: "acc_del" },
        (client) =>
          client.workspaces.create({
            path: { organizationId: organization.id },
            payload: { name: "Delete WS" },
          }),
      );

      const deleteOrg = yield* withControlPlaneClient(
        { runtime, accountId: "acc_del" },
        (client) =>
          client.organizations.remove({
            path: { organizationId: organization.id },
          }),
      );
      assertTrue(deleteOrg.removed);

      const listStaleWorkspacesError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_del" },
          (client) =>
            client.workspaces.list({
              path: { organizationId: organization.id },
            }),
        ),
      );
      expect(listStaleWorkspacesError._tag).toBe("ControlPlaneForbiddenError");

      const createStaleWorkspaceError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_del" },
          (client) =>
            client.workspaces.create({
              path: { organizationId: organization.id },
              payload: { name: "Should Fail" },
            }),
        ),
      );
      expect(createStaleWorkspaceError._tag).toBe("ControlPlaneForbiddenError");

      const getDeletedWorkspaceError = yield* expectLeft(
        withControlPlaneClient(
          { runtime, accountId: "acc_del" },
          (client) =>
            client.workspaces.get({
              path: { workspaceId: workspace.id },
            }),
        ),
      );
      expect(getDeletedWorkspaceError._tag).toBe("ControlPlaneForbiddenError");
    }),
  );

  it.scoped("rejects unauthenticated calls", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;

      const error = yield* expectLeft(
        withControlPlaneClient({ runtime }, (client) => client.organizations.list({})),
      );

      expect(error._tag).toBe("ControlPlaneUnauthorizedError");
    }),
  );
});

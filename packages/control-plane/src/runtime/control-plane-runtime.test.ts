import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { WorkspaceIdSchema, type AccountId } from "#schema";

import { createSqlControlPlaneRuntime } from "./index";
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

      expect(orgOne.id.length > 0).toBe(true);
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
      expect(orgA.id.length > 0).toBe(true);
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
      expect(deleteOrg.removed).toBe(true);

      const deletedWorkspaceLookup = yield* Effect.either(
        runtime.service.getWorkspace(WorkspaceIdSchema.make(workspace.id)),
      );
      expect(deletedWorkspaceLookup._tag).toBe("Left");

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

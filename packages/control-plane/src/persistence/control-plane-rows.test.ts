import { describe, expect, it } from "@effect/vitest";
import {
  AccountIdSchema,
  OrganizationIdSchema,
  OrganizationMemberIdSchema,
  PolicyIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { createSqlControlPlanePersistence } from "./index";

const makePersistence = Effect.acquireRelease(
  createSqlControlPlanePersistence({
    localDataDir: ":memory:",
  }),
  (persistence) =>
    Effect.tryPromise({
      try: () => persistence.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
);

describe("control-plane-persistence-drizzle", () => {
  it.scoped("creates and reads organization/workspace/source/policy rows", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const organizationId = OrganizationIdSchema.make("org_1");
      const accountId = AccountIdSchema.make("acc_1");
      const workspaceId = WorkspaceIdSchema.make("ws_1");

      yield* persistence.rows.organizations.insert({
        id: organizationId,
        slug: "acme",
        name: "Acme",
        status: "active",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.workspaces.insert({
        id: workspaceId,
        organizationId,
        name: "Main",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.sources.insert({
        id: SourceIdSchema.make("src_1"),
        workspaceId,
        name: "Github",
        kind: "openapi",
        endpoint: "https://api.github.com",
        status: "draft",
        enabled: true,
        namespace: "github",
        transport: null,
        queryParamsJson: null,
        headersJson: null,
        specUrl: "https://api.github.com/openapi.json",
        defaultHeadersJson: null,
        authKind: "none",
        authHeaderName: null,
        authPrefix: null,
        sourceHash: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.policies.insert({
        id: PolicyIdSchema.make("pol_1"),
        workspaceId,
        targetAccountId: null,
        clientId: null,
        resourceType: "tool_path",
        resourcePattern: "source.github.*",
        matchType: "glob",
        effect: "allow",
        approvalMode: "auto",
        argumentConditionsJson: null,
        priority: 10,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      const workspace = yield* persistence.rows.workspaces.getById(workspaceId);
      expect(Option.isSome(workspace)).toBe(true);

      const sources = yield* persistence.rows.sources.listByWorkspaceId(workspaceId);
      expect(sources).toHaveLength(1);
      expect(sources[0]?.name).toBe("Github");

      const policies = yield* persistence.rows.policies.listByWorkspaceId(workspaceId);
      expect(policies).toHaveLength(1);
      expect(policies[0]?.resourcePattern).toBe("source.github.*");
    }),
  );

  it.scoped("upserts organization memberships by org/account", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const organizationId = OrganizationIdSchema.make("org_1");
      const accountId = AccountIdSchema.make("acc_1");

      yield* persistence.rows.organizationMemberships.upsert({
        id: OrganizationMemberIdSchema.make("mem_1"),
        organizationId,
        accountId,
        role: "viewer",
        status: "active",
        billable: true,
        invitedByAccountId: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.organizationMemberships.upsert({
        id: OrganizationMemberIdSchema.make("mem_2"),
        organizationId,
        accountId,
        role: "admin",
        status: "active",
        billable: true,
        invitedByAccountId: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now + 1,
      });

      const membership = yield* persistence.rows.organizationMemberships.getByOrganizationAndAccount(
        organizationId,
        accountId,
      );

      expect(Option.isSome(membership)).toBe(true);
      if (Option.isSome(membership)) {
        expect(membership.value.role).toBe("admin");
      }
    }),
  );

});

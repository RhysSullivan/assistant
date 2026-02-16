import { Migrations } from "@convex-dev/migrations";
import type { Id } from "./_generated/dataModel.d.ts";
import type { DataModel } from "./_generated/dataModel.d.ts";
import { components } from "./_generated/api";

const migrations = new Migrations<DataModel>(components.migrations);

const LEGACY_GUEST_NAME = "Guest Workspace";
const ANONYMOUS_ORGANIZATION_NAME = "Anonymous Organization";
const ANONYMOUS_WORKSPACE_NAME = "Anonymous Workspace";

function readLegacyDtsStorageIds(entry: unknown): Id<"_storage">[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const raw = Reflect.get(entry, "dtsStorageIds");
  if (!Array.isArray(raw)) {
    return [];
  }

  const ids: Id<"_storage">[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const storageId = Reflect.get(item, "storageId");
    if (typeof storageId === "string" && storageId.length > 0) {
      ids.push(storageId as Id<"_storage">);
    }
  }

  return ids;
}

async function isAnonymousCreator(
  ctx: { db: { get: (id: Id<"accounts">) => Promise<{ provider: string } | null> } },
  accountId: Id<"accounts"> | undefined,
): Promise<boolean> {
  if (!accountId) {
    return false;
  }

  const account = await ctx.db.get(accountId);
  return account?.provider === "anonymous";
}

export const renameLegacyAnonymousOrganizations = migrations.define({
  table: "organizations",
  migrateOne: async (ctx, organization) => {
    if (organization.name !== LEGACY_GUEST_NAME) {
      return;
    }

    const anonymousCreator = await isAnonymousCreator(ctx, organization.createdByAccountId);
    if (!anonymousCreator) {
      return;
    }

    return {
      name: ANONYMOUS_ORGANIZATION_NAME,
      updatedAt: Date.now(),
    };
  },
});

export const renameLegacyAnonymousWorkspaces = migrations.define({
  table: "workspaces",
  migrateOne: async (ctx, workspace) => {
    if (workspace.name !== LEGACY_GUEST_NAME) {
      return;
    }

    const anonymousCreator = await isAnonymousCreator(ctx, workspace.createdByAccountId);
    if (!anonymousCreator) {
      return;
    }

    return {
      name: ANONYMOUS_WORKSPACE_NAME,
      updatedAt: Date.now(),
    };
  },
});

export const deleteAnonymousSessionsMissingAccountId = migrations.define({
  table: "anonymousSessions",
  migrateOne: async (ctx, session) => {
    if (session.accountId) {
      return;
    }

    await ctx.db.delete(session._id);
  },
});

export const deleteSourceCredentialsMissingProvider = migrations.define({
  table: "sourceCredentials",
  migrateOne: async (ctx, credential) => {
    if (credential.provider) {
      return;
    }

    await ctx.db.delete(credential._id);
  },
});

export const deleteAnonymousSessionsMissingUserId = migrations.define({
  table: "anonymousSessions",
  migrateOne: async (ctx, session) => {
    if (session.userId) {
      return;
    }

    await ctx.db.delete(session._id);
  },
});

export const cleanupTaskEmptyStringSentinels = migrations.define({
  table: "tasks",
  migrateOne: async (_ctx, task) => {
    const patch: Record<string, undefined> = {};
    if (Reflect.get(task, "accountId") === "") patch.accountId = undefined;
    if (task.clientId === "") patch.clientId = undefined;
    if (Object.keys(patch).length > 0) return patch;
  },
});

export const cleanupAccessPolicyEmptyStringSentinels = migrations.define({
  table: "accessPolicies",
  migrateOne: async (_ctx, policy) => {
    const policyRecord = policy as Record<string, unknown>;
    const patch: Record<string, undefined> = {};
    if (Reflect.get(policyRecord, "accountId") === "") patch["accountId"] = undefined;
    if (Reflect.get(policyRecord, "targetAccountId") === "") patch["targetAccountId"] = undefined;
    if (policy.clientId === "") patch["clientId"] = undefined;
    if (Object.keys(patch).length > 0) return patch;
  },
});

export const cleanupWorkspaceToolCacheLegacyDtsStorageIds = migrations.define({
  table: "workspaceToolCache",
  migrateOne: async (ctx, entry) => {
    const legacyIds = readLegacyDtsStorageIds(entry);
    const hasLegacyField = entry && typeof entry === "object" && Reflect.has(entry, "dtsStorageIds");
    if (legacyIds.length === 0) {
      if (hasLegacyField) {
        return { dtsStorageIds: undefined };
      }
      return;
    }

    for (const storageId of legacyIds) {
      await ctx.storage.delete(storageId).catch(() => {});
    }

    return { dtsStorageIds: undefined };
  },
});

export const run = migrations.runner();

import { v } from "convex/values";
import { z } from "zod";
import { internalMutation, internalQuery } from "../_generated/server";
import { mapCredential } from "../../src/database/mappers";
import { computeBoundAuthFingerprint } from "../../src/database/readers";
import {
  credentialProviderValidator,
  credentialScopeValidator,
  jsonObjectValidator,
  ownerScopeTypeValidator,
} from "../../src/database/validators";

const recordSchema = z.record(z.unknown());

function toRecordValue(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function scopeKeyForCredential(scope: "workspace" | "actor", actorId?: string): string {
  if (scope === "workspace") {
    return "workspace";
  }

  const normalizedActorId = actorId?.trim();
  if (!normalizedActorId) {
    throw new Error("actorId is required for actor-scoped credentials");
  }

  return `actor:${normalizedActorId}`;
}

export const upsertCredential = internalMutation({
  args: {
    id: v.optional(v.string()),
    workspaceId: v.id("workspaces"),
    ownerScopeType: v.optional(ownerScopeTypeValidator),
    sourceKey: v.string(),
    scope: credentialScopeValidator,
    actorId: v.optional(v.string()),
    provider: v.optional(credentialProviderValidator),
    secretJson: jsonObjectValidator,
    overridesJson: v.optional(jsonObjectValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ownerScopeType = args.ownerScopeType ?? "workspace";
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }
    const organizationId = workspace.organizationId;
    const ownerWorkspaceId = ownerScopeType === "workspace" ? args.workspaceId : undefined;

    const actorId = args.scope === "actor" ? args.actorId?.trim() : undefined;
    const scopeKey = scopeKeyForCredential(args.scope, actorId);
    const submittedSecret = toRecordValue(args.secretJson);
    const hasSubmittedSecret = Object.keys(submittedSecret).length > 0;

    const existing = ownerScopeType === "workspace"
      ? await ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_source_scope_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique()
      : await ctx.db
        .query("sourceCredentials")
        .withIndex("by_organization_owner_source_scope_key", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("ownerScopeType", "organization")
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique();

    let requestedId = args.id?.trim() || "";
    if (requestedId.startsWith("bind_")) {
      const binding = await ctx.db
        .query("sourceCredentials")
        .withIndex("by_binding_id", (q) => q.eq("bindingId", requestedId))
        .unique();
      const sameOwner = binding
        && binding.organizationId === organizationId
        && binding.ownerScopeType === ownerScopeType
        && (ownerScopeType === "organization" || binding.workspaceId === args.workspaceId);
      if (sameOwner) {
        requestedId = binding.credentialId;
      }
    }

    const connectionId = requestedId || existing?.credentialId || `conn_${crypto.randomUUID()}`;

    const linkedRows = ownerScopeType === "workspace"
      ? await ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_credential", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("credentialId", connectionId),
        )
        .collect()
      : await ctx.db
        .query("sourceCredentials")
        .withIndex("by_organization_owner_credential", (q) =>
          q.eq("organizationId", organizationId).eq("ownerScopeType", "organization").eq("credentialId", connectionId),
        )
        .collect();
    const exemplar = linkedRows[0] ?? existing ?? null;

    const provider = args.provider ?? exemplar?.provider ?? "local-convex";
    const fallbackSecret = toRecordValue(exemplar?.secretJson);
    const finalSecret = hasSubmittedSecret ? submittedSecret : fallbackSecret;
    if (Object.keys(finalSecret).length === 0) {
      throw new Error("Credential values are required");
    }

    const overridesJson = args.overridesJson === undefined
      ? toRecordValue(existing?.overridesJson)
      : toRecordValue(args.overridesJson);

    const boundAuthFingerprint = await computeBoundAuthFingerprint(
      ctx,
      args.workspaceId,
      args.sourceKey,
    );

    if (linkedRows.length > 0 && (hasSubmittedSecret || args.provider)) {
      await Promise.all(linkedRows.map(async (row) => {
        await ctx.db.patch(row._id, {
          provider,
          secretJson: finalSecret,
          updatedAt: now,
        });
      }));
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerScopeType,
        organizationId,
        workspaceId: ownerWorkspaceId,
        credentialId: connectionId,
        provider,
        secretJson: finalSecret,
        overridesJson,
        scopeKey,
        actorId,
        boundAuthFingerprint,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("sourceCredentials", {
        bindingId: `bind_${crypto.randomUUID()}`,
        credentialId: connectionId,
        ownerScopeType,
        organizationId,
        workspaceId: ownerWorkspaceId,
        sourceKey: args.sourceKey,
        scope: args.scope,
        scopeKey,
        actorId,
        provider,
        secretJson: finalSecret,
        overridesJson,
        boundAuthFingerprint,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = ownerScopeType === "workspace"
      ? await ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_source_scope_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique()
      : await ctx.db
        .query("sourceCredentials")
        .withIndex("by_organization_owner_source_scope_key", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("ownerScopeType", "organization")
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique();

    if (!updated) {
      throw new Error("Failed to read upserted credential");
    }

    return mapCredential(updated);
  },
});

export const listCredentials = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }

    const [workspaceDocs, organizationDocs] = await Promise.all([
      ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .collect(),
      ctx.db
        .query("sourceCredentials")
        .withIndex("by_organization_owner_created", (q) =>
          q.eq("organizationId", workspace.organizationId).eq("ownerScopeType", "organization"),
        )
        .order("desc")
        .collect(),
    ]);

    const docs = [...workspaceDocs, ...organizationDocs]
      .filter((doc, index, entries) => entries.findIndex((candidate) => candidate.bindingId === doc.bindingId) === index)
      .sort((a, b) => b.createdAt - a.createdAt);

    return docs.map(mapCredential);
  },
});

export const listCredentialProviders = internalQuery({
  args: {},
  handler: async () => {
    const workosEnabled = Boolean(process.env.WORKOS_API_KEY?.trim());
    return [
      {
        id: workosEnabled ? "workos-vault" : "local-convex",
        label: workosEnabled ? "Encrypted" : "Local",
        description: workosEnabled
          ? "Secrets are stored in WorkOS Vault."
          : "Secrets are stored locally in Convex on this machine.",
      },
    ] as const;
  },
});

export const resolveCredential = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    sourceKey: v.string(),
    scope: credentialScopeValidator,
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }

    const workspaceScopeKey = scopeKeyForCredential("workspace");
    const actorId = args.actorId?.trim() || "";
    const actorScopeKey = actorId ? scopeKeyForCredential("actor", actorId) : null;

    const tryWorkspaceOwned = async (scopeKey: string) => {
      return await ctx.db
        .query("sourceCredentials")
        .withIndex("by_workspace_source_scope_key", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique();
    };

    const tryOrganizationOwned = async (scopeKey: string) => {
      return await ctx.db
        .query("sourceCredentials")
        .withIndex("by_organization_owner_source_scope_key", (q) =>
          q
            .eq("organizationId", workspace.organizationId)
            .eq("ownerScopeType", "organization")
            .eq("sourceKey", args.sourceKey)
            .eq("scopeKey", scopeKey),
        )
        .unique();
    };

    if (args.scope === "actor" && actorScopeKey) {
      const workspaceActorDoc = await tryWorkspaceOwned(actorScopeKey);
      if (workspaceActorDoc) {
        return mapCredential(workspaceActorDoc as never);
      }

      const organizationActorDoc = await tryOrganizationOwned(actorScopeKey);
      if (organizationActorDoc) {
        return mapCredential(organizationActorDoc as never);
      }
    }

    const workspaceDoc = await tryWorkspaceOwned(workspaceScopeKey);
    if (workspaceDoc) {
      return mapCredential(workspaceDoc as never);
    }

    const organizationDoc = await tryOrganizationOwned(workspaceScopeKey);
    if (organizationDoc) {
      return mapCredential(organizationDoc as never);
    }

    return null;
  },
});

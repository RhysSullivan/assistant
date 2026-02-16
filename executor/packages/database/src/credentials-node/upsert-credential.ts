import { Result } from "better-result";
import { z } from "zod";
import type { Id } from "../../convex/_generated/dataModel.d.ts";
import type { ActionCtx } from "../../convex/_generated/server";
import {
  createWorkosClient,
  extractWorkosVaultObjectId,
  withWorkosVaultRetryResult,
} from "../../../core/src/credentials/workos-vault";
import {
  assertMatchesCanonicalActorId,
  canonicalActorIdForWorkspaceAccess,
} from "../auth/actor_identity";

type Internal = typeof import("../../convex/_generated/api").internal;

type SecretBackend = "local-convex" | "workos-vault";

const recordSchema = z.record(z.unknown());

const secretPayloadSchema = z.object({
  __headers: z.record(z.unknown()).optional(),
}).catchall(z.unknown());

const listedCredentialSchema = z.object({
  id: z.string().optional(),
  bindingId: z.string().optional(),
  ownerScopeType: z.enum(["organization", "workspace"]).optional(),
  scope: z.enum(["workspace", "actor"]).optional(),
  actorId: z.string().optional(),
  secretJson: z.record(z.unknown()).optional(),
});

type ListedCredential = z.infer<typeof listedCredentialSchema>;

function toRecordValue(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function normalizedActorId(scope: "workspace" | "actor", actorId?: string): string {
  if (scope !== "actor") return "";
  if (typeof actorId !== "string") return "";
  return actorId.trim();
}

function configuredSecretBackend(): SecretBackend {
  const explicit = process.env.EXECUTOR_SECRET_BACKEND?.trim().toLowerCase();
  if (explicit === "workos" || explicit === "workos-vault") {
    return "workos-vault";
  }
  if (explicit === "local" || explicit === "local-convex") {
    return "local-convex";
  }
  return process.env.WORKOS_API_KEY?.trim() ? "workos-vault" : "local-convex";
}

function extractHeaderOverrides(secretJson: Record<string, unknown>): {
  cleanSecret: Record<string, unknown>;
  overridesJson: Record<string, unknown>;
} {
  const parsedSecret = secretPayloadSchema.safeParse(secretJson);
  const normalizedSecret = parsedSecret.success ? parsedSecret.data : {};
  const rawHeaders = toRecordValue(normalizedSecret.__headers);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    const headerName = name.trim();
    if (!headerName) continue;
    const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!text) continue;
    headers[headerName] = text;
  }

  const { __headers: _headers, ...rest } = normalizedSecret;
  return {
    cleanSecret: toRecordValue(rest),
    overridesJson: Object.keys(headers).length > 0 ? { headers } : {},
  };
}

function parseListedCredentials(value: unknown): ListedCredential[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const parsed = listedCredentialSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function buildVaultObjectName(args: {
  workspaceId: string;
  sourceKey: string;
  scope: "workspace" | "actor";
  actorId: string;
}): string {
  const actorSegment = args.scope === "actor" ? args.actorId || "actor" : "workspace";
  const sourceSegment = args.sourceKey
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return `executor-conn-${args.workspaceId.slice(0, 24)}-${sourceSegment}-${actorSegment.slice(0, 24)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function upsertVaultObject(args: {
  workspaceId: string;
  sourceKey: string;
  scope: "workspace" | "actor";
  actorId: string;
  existingObjectId: string | null;
  payload: Record<string, unknown>;
}): Promise<Result<string, Error>> {
  const workosResult = createWorkosClient();
  if (workosResult.isErr()) {
    return Result.err(workosResult.error);
  }

  const workos = workosResult.value;
  const value = JSON.stringify(args.payload);

  if (args.existingObjectId) {
    const objectId: string = args.existingObjectId;
    const updatedResult = await withWorkosVaultRetryResult(async () => {
      return await workos.vault.updateObject({
        id: objectId,
        value,
      });
    }, {
      maxAttempts: 10,
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      exhaustionErrorMessage: "Encrypted storage is still initializing in WorkOS. Please wait about 60 seconds and retry.",
    });
    if (updatedResult.isErr()) {
      return Result.err(updatedResult.error);
    }

    return Result.ok(updatedResult.value.id);
  }

  const createdResult = await withWorkosVaultRetryResult(async () => {
    return await workos.vault.createObject({
      name: buildVaultObjectName(args),
      value,
      context: {
        workspace_id: args.workspaceId,
      },
    });
  }, {
    maxAttempts: 10,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    exhaustionErrorMessage: "Encrypted storage is still initializing in WorkOS. Please wait about 60 seconds and retry.",
  });
  if (createdResult.isErr()) {
    return Result.err(createdResult.error);
  }

  return Result.ok(createdResult.value.id);
}

export async function upsertCredentialHandler(
  ctx: ActionCtx,
  internal: Internal,
  args: {
    id?: string;
    workspaceId: Id<"workspaces">;
    sessionId?: string;
    ownerScopeType?: "organization" | "workspace";
    sourceKey: string;
    scope: "workspace" | "actor";
    actorId?: string;
    provider?: "local-convex" | "workos-vault";
    secretJson: unknown;
  },
): Promise<Record<string, unknown>> {
  const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForRequest, {
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
  });
  const canonicalActorId = canonicalActorIdForWorkspaceAccess(access);
  if (args.scope === "actor") {
    assertMatchesCanonicalActorId(args.actorId, canonicalActorId);
  }

  const actorId = normalizedActorId(args.scope, args.actorId ?? canonicalActorId);
  const ownerScopeType = args.ownerScopeType ?? "workspace";
  const rawSubmittedSecret = toRecordValue(args.secretJson);
  const { cleanSecret: submittedSecret, overridesJson } = extractHeaderOverrides(rawSubmittedSecret);

  const existingBinding = await ctx.runQuery(internal.database.resolveCredential, {
    workspaceId: args.workspaceId,
    sourceKey: args.sourceKey,
    scope: args.scope,
    ...(args.scope === "actor" ? { actorId } : {}),
  });

  const allCredentialsRaw = await ctx.runQuery(internal.database.listCredentials, {
    workspaceId: args.workspaceId,
  });
  const allCredentials = parseListedCredentials(allCredentialsRaw);
  const requestedId = args.id?.trim();
  const existingConnection = requestedId
    ? allCredentials.find((credential) => {
      const id = (credential.id ?? "").trim();
      const bindingId = (credential.bindingId ?? "").trim();
      if (id !== requestedId && bindingId !== requestedId) return false;
      if ((credential.ownerScopeType ?? "workspace") !== ownerScopeType) return false;
      if (credential.scope !== args.scope) return false;
      if (args.scope === "actor") {
        return (credential.actorId ?? "").trim() === actorId;
      }
      return true;
    }) ?? allCredentials.find((credential) => {
      const id = (credential.id ?? "").trim();
      const bindingId = (credential.bindingId ?? "").trim();
      return id === requestedId || bindingId === requestedId;
    })
    : null;
  const connectionId = (existingConnection?.id ?? requestedId ?? "").trim() || undefined;

  const backend = configuredSecretBackend();

  if (backend === "local-convex") {
    const finalSecret = Object.keys(submittedSecret).length > 0
      ? submittedSecret
      : toRecordValue(existingConnection?.secretJson ?? existingBinding?.secretJson);
    if (Object.keys(finalSecret).length === 0) {
      throw new Error("Credential values are required");
    }

    return await ctx.runMutation(internal.database.upsertCredential, {
      id: connectionId,
      workspaceId: args.workspaceId,
      ownerScopeType,
      sourceKey: args.sourceKey,
      scope: args.scope,
      ...(args.scope === "actor" ? { actorId } : {}),
      provider: "local-convex",
      secretJson: finalSecret,
      overridesJson,
    });
  }

  const submittedObjectId = extractWorkosVaultObjectId(submittedSecret);
  if (submittedObjectId && /^gh[opu]_/.test(submittedObjectId)) {
    throw new Error("Encrypted storage value looks like a GitHub token. Paste the token in the token field.");
  }

  const existingObjectId = extractWorkosVaultObjectId(
    toRecordValue(existingConnection?.secretJson ?? existingBinding?.secretJson),
  );

  let finalObjectId = submittedObjectId;
  if (!finalObjectId && Object.keys(submittedSecret).length > 0) {
    const upsertResult = await upsertVaultObject({
      workspaceId: args.workspaceId,
      sourceKey: args.sourceKey,
      scope: args.scope,
      actorId,
      existingObjectId,
      payload: submittedSecret,
    });
    if (upsertResult.isErr()) {
      throw upsertResult.error;
    }
    finalObjectId = upsertResult.value;
  }

  if (!finalObjectId && existingObjectId) {
    finalObjectId = existingObjectId;
  }

  if (!finalObjectId) {
    throw new Error("Credential values are required");
  }

  return await ctx.runMutation(internal.database.upsertCredential, {
    id: connectionId,
    workspaceId: args.workspaceId,
    ownerScopeType,
    sourceKey: args.sourceKey,
    scope: args.scope,
    ...(args.scope === "actor" ? { actorId } : {}),
    provider: "workos-vault",
    secretJson: { objectId: finalObjectId },
    overridesJson,
  });
}

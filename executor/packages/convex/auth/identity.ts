import { components } from "../_generated/api";
import type { RunQueryCtx } from "./types";

type WorkosProfile = {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
};

export function getIdentityString(identity: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = identity[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export async function getAuthKitUserProfile(ctx: RunQueryCtx, workosUserId: string) {
  try {
    return await ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, {
      id: workosUserId,
    });
  } catch {
    return null;
  }
}

export function resolveIdentityProfile(args: {
  identity: Record<string, unknown> & { subject: string };
  authKitProfile: WorkosProfile | null;
}) {
  const { identity, authKitProfile } = args;

  const email =
    authKitProfile?.email
    ?? getIdentityString(identity, ["email", "https://workos.com/email", "upn"])
    ?? `${identity.subject}@workos.executor.local`;

  const firstName = authKitProfile?.firstName
    ?? getIdentityString(identity, ["given_name", "first_name", "https://workos.com/first_name"]);

  const lastName = authKitProfile?.lastName
    ?? getIdentityString(identity, ["family_name", "last_name", "https://workos.com/last_name"]);

  const fullName =
    (getIdentityString(identity, ["name", "https://workos.com/name"]) ?? [firstName, lastName].filter(Boolean).join(" "))
    || email;

  const avatarUrl =
    (authKitProfile?.profilePictureUrl ?? undefined)
    ?? getIdentityString(identity, ["picture", "avatar_url", "https://workos.com/profile_picture_url"]);

  const hintedWorkosOrgId = getIdentityString(identity, [
    "org_id",
    "organization_id",
    "https://workos.com/organization_id",
  ]);

  return {
    email,
    firstName,
    lastName,
    fullName,
    avatarUrl,
    hintedWorkosOrgId,
  };
}

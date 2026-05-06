// ---------------------------------------------------------------------------
// Cloud id helpers
// ---------------------------------------------------------------------------
//
// Two flavors:
//
//   - `newId(prefix)` — random, prefixed local id (Unkey-style). Used for
//     entities the cloud owns (workspaces, future local orgs, …). WorkOS
//     ids stay as identity anchors; we don't re-prefix them.
//
//   - `orgScopeId / workspaceScopeId / userOrgScopeId / userWorkspaceScopeId`
//     — deterministic scope id constructors. Scope rows are addressed by
//     these strings; the prefixes make a row's owner trivially inspectable
//     and prevent accidental collisions between user scopes and org scopes.
//
// Plus `slugifyHandle / withHandleSuffix` for generating org handles and
// workspace slugs from human-entered names.

import { ScopeId } from "@executor-js/sdk";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const randomBase58 = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE58_ALPHABET[bytes[i]! % 58];
  }
  return out;
};

/**
 * Random prefixed id, ~128 bits of entropy. Output shape: `${prefix}_<22 base58>`.
 */
export const newId = (prefix: string): string => `${prefix}_${randomBase58(22)}`;

// ---------------------------------------------------------------------------
// Deterministic scope id constructors
// ---------------------------------------------------------------------------

export const orgScopeId = (orgId: string): ScopeId =>
  ScopeId.make(`org_${orgId}`);

export const workspaceScopeId = (workspaceId: string): ScopeId =>
  ScopeId.make(`workspace_${workspaceId}`);

export const userOrgScopeId = (userId: string, orgId: string): ScopeId =>
  ScopeId.make(`user_org_${userId}_${orgId}`);

export const userWorkspaceScopeId = (
  userId: string,
  workspaceId: string,
): ScopeId => ScopeId.make(`user_workspace_${userId}_${workspaceId}`);

// ---------------------------------------------------------------------------
// Handle / slug helpers
// ---------------------------------------------------------------------------

const HANDLE_MAX = 48;

/**
 * Reduce a free-form name to a handle/slug. Lowercase, ASCII-ish, hyphenated.
 * Caller is responsible for collision handling — see `withHandleSuffix`.
 */
export const slugifyHandle = (name: string): string => {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, HANDLE_MAX);
  return cleaned.length > 0 ? cleaned : "org";
};

/**
 * Append a numeric suffix to a handle, keeping the result within HANDLE_MAX.
 * `withHandleSuffix("acme", 2)` → `"acme-2"`.
 */
export const withHandleSuffix = (handle: string, n: number): string => {
  const suffix = `-${n}`;
  const room = HANDLE_MAX - suffix.length;
  const base = handle.slice(0, Math.max(1, room));
  return `${base}${suffix}`;
};

// ---------------------------------------------------------------------------
// URL context parsing — shared between the fetch wrapper and the AppLink
// helpers so both agree on what counts as a workspace slug vs an org-level
// sub-route. Plan reserves `-` as the org-admin marker; the sub-route names
// below are the org-level pages that share the URL space with workspace
// slugs (so a workspace can't be named "sources" etc.).
// ---------------------------------------------------------------------------

/** First-segment names that aren't an org handle. */
export const RESERVED_FIRST_SEGMENTS = new Set([
  "api",
  "ingest",
  "assets",
  "auth",
]);

/**
 * Second-segment names that aren't a workspace slug — they're either the
 * org-admin marker (`-`) or org-level sub-routes that live at `/:org/<rest>`.
 * Anything else in the second slot is a workspace slug.
 */
export const RESERVED_SECOND_SEGMENTS = new Set([
  "-",
  "sources",
  "connections",
  "secrets",
  "policies",
  "tools",
]);

export type UrlContext =
  | { kind: "global"; orgHandle: string }
  | { kind: "workspace"; orgHandle: string; workspaceSlug: string }
  | { kind: "none" };

export const parseUrlContext = (pathname: string): UrlContext => {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { kind: "none" };
  const orgHandle = parts[0]!;
  if (RESERVED_FIRST_SEGMENTS.has(orgHandle)) return { kind: "none" };
  const second = parts[1];
  if (!second || RESERVED_SECOND_SEGMENTS.has(second)) {
    return { kind: "global", orgHandle };
  }
  return { kind: "workspace", orgHandle, workspaceSlug: second };
};

/** API URL prefix for the current page. `null` outside an org URL (e.g. on
 *  the local app where org-prefixing is a no-op). */
export const apiPrefixFor = (ctx: UrlContext): string | null => {
  if (ctx.kind === "global") return `/api/${ctx.orgHandle}`;
  if (ctx.kind === "workspace") {
    return `/api/${ctx.orgHandle}/${ctx.workspaceSlug}`;
  }
  return null;
};

/** App-route prefix for building hrefs. Empty string when there is no org
 *  context (local app, login screens). */
export const appPrefixFor = (ctx: UrlContext): string => {
  if (ctx.kind === "global") return `/${ctx.orgHandle}`;
  if (ctx.kind === "workspace") {
    return `/${ctx.orgHandle}/${ctx.workspaceSlug}`;
  }
  return "";
};

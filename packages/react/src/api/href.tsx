import { useCallback } from "react";
import { useLocation } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// useAppHref — prepend the URL-context prefix (`/:org` or
// `/:org/:workspace`) to absolute app paths on cloud so shared pages built
// against the flat local route tree still navigate correctly. Local stays
// at no prefix.
// ---------------------------------------------------------------------------
//
// The shared `@executor-js/react` pages (sources, connections, command
// palette, etc.) hard-code `<Link to="/sources/...">` against the local
// app's flat route tree. On cloud those routes live under
// `/${org}` (and optionally `/${org}/${workspace}`) — but the shared
// components can't statically depend on the cloud's route shape.
//
// `useAppHref(path, params?)` pulls the active org (and workspace) handle
// off `useLocation().pathname` and returns the right URL string. Pass it
// as `<Link to={appHref("/sources/add/openapi")}>` instead of an absolute
// path. The hook is a no-op on local — there's no prefix to add.

const RESERVED_FIRST_SEGMENTS = new Set(["api", "ingest", "assets", "auth"]);

const splitContextPrefix = (
  pathname: string,
): { prefix: string; rest: string } => {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { prefix: "", rest: pathname };
  const org = parts[0]!;
  if (RESERVED_FIRST_SEGMENTS.has(org)) return { prefix: "", rest: pathname };
  // Reserved org-admin marker `/:org/-/...` keeps the prefix at org-only.
  const second = parts[1];
  if (!second || second === "-") {
    return {
      prefix: `/${org}`,
      rest: parts.slice(1).join("/"),
    };
  }
  return {
    prefix: `/${org}/${second}`,
    rest: parts.slice(2).join("/"),
  };
};

const interpolate = (path: string, params?: Record<string, string>): string => {
  if (!params) return path;
  return path.replace(/\$([a-zA-Z_][\w]*)/g, (_match, name: string) => {
    const v = params[name];
    return v != null ? encodeURIComponent(v) : `$${name}`;
  });
};

const buildSearch = (search?: Record<string, string | number | boolean>): string => {
  if (!search) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
};

/**
 * Returns a function that prefixes app-absolute paths with the active URL
 * context. Use it instead of hard-coded Link `to` strings in components
 * shared between local and cloud.
 *
 * Example:
 *   const appHref = useAppHref();
 *   <Link to={appHref("/sources/add/$pluginKey", { pluginKey })}>Add</Link>
 */
export const useAppHref = () => {
  const location = useLocation();
  return useCallback(
    (
      path: string,
      params?: Record<string, string>,
      search?: Record<string, string | number | boolean>,
    ): string => {
      const { prefix } = splitContextPrefix(location.pathname);
      const interpolated = interpolate(path, params);
      const normalized = interpolated.startsWith("/")
        ? interpolated
        : `/${interpolated}`;
      return `${prefix}${normalized}${buildSearch(search)}`;
    },
    [location.pathname],
  );
};

import { forwardRef } from "react";
import { Link, useLocation, type LinkComponentProps } from "@tanstack/react-router";

import { appPrefixFor, parseUrlContext } from "./url-context";

// ---------------------------------------------------------------------------
// AppLink — TanStack `<Link>` that automatically prepends the active URL
// context (`/:org` or `/:org/:workspace`) to absolute `to` strings on cloud,
// while leaving them unchanged on the local app (no prefix).
//
// Use it instead of `<Link>` in code that lives in `@executor-js/react` and
// renders in both apps. The `to` prop is the absolute path against the
// flat (local) route tree — e.g. `to="/sources/add/$pluginKey"` — and the
// component resolves it to the right URL at render time.
//
// Param interpolation (`$name` -> params[name]) is handled here too so
// callers don't have to drop into manual string concat. Search/hash flow
// through to TanStack unchanged when the prefix is empty; on cloud they
// are spliced into the resolved string.

const interpolate = (
  path: string,
  params?: Record<string, unknown>,
): string => {
  if (!params) return path;
  return path.replace(/\$([a-zA-Z_][\w]*)/g, (_match, name: string) => {
    const v = params[name];
    return v != null ? encodeURIComponent(String(v)) : `$${name}`;
  });
};

const buildSearch = (
  search?: Record<string, unknown> | ((prev: unknown) => unknown),
): string => {
  if (!search || typeof search === "function") return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
};

export type AppLinkProps = Omit<LinkComponentProps, "to" | "params" | "search"> & {
  /** Absolute path with TanStack-style `$param` placeholders, e.g.
   *  `/sources/add/$pluginKey`. Resolved to the active URL context on
   *  cloud and passed through unchanged on local. */
  to: string;
  params?: Record<string, unknown>;
  search?: Record<string, unknown>;
};

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink({ to, params, search, ...rest }, ref) {
    const location = useLocation();
    const ctx = parseUrlContext(location.pathname);
    const prefix = appPrefixFor(ctx);
    const interpolated = interpolate(to, params);
    const normalized = interpolated.startsWith("/")
      ? interpolated
      : `/${interpolated}`;
    const resolved = `${prefix}${normalized}${buildSearch(search)}`;
    return (
      <Link ref={ref} to={resolved as never} {...(rest as object)} />
    );
  },
);

import { FetchHttpClient } from "effect/unstable/http";
import { Layer } from "effect";

import { apiPrefixFor, parseUrlContext } from "./url-context";

// ---------------------------------------------------------------------------
// URL-context aware HTTP client layer
// ---------------------------------------------------------------------------
//
// The cloud app mounts its protected API under `/api/:org/...` (and
// `/api/:org/:workspace/...`). The Effect `AtomHttpApi.Service` is built once
// at module load with a static baseUrl, but the active org/workspace changes
// as the user navigates. Re-instantiating the client per-org is awkward inside
// the service model, so instead we wrap the global `fetch` and rewrite
// outgoing URLs at request time:
//
//   `${origin}/api/:tail`
//      -> `${origin}/api/${urlOrg}/${urlWorkspace?}/:tail`
//
// based on the current `window.location.pathname`. Auth/admin routes that
// stay unprefixed on the server (`/api/auth/...`, `/api/sentry-tunnel`, the
// autumn billing proxy) are passed through untouched.

const UNPREFIXED_API_PATHS = [
  "/api/auth/",
  "/api/sentry-tunnel",
  "/api/autumn/",
];

const wrapFetch = (inner: typeof globalThis.fetch): typeof globalThis.fetch =>
  (input, init) => {
    const ctx =
      typeof window !== "undefined"
        ? parseUrlContext(window.location.pathname)
        : { kind: "none" as const };
    const prefix = apiPrefixFor(ctx);
    if (!prefix) return inner(input, init);

    const rewriteUrl = (raw: string): string => {
      let url: URL;
      try {
        url = new URL(raw, window.location.origin);
      } catch {
        return raw;
      }
      if (url.origin !== window.location.origin) return raw;
      if (!url.pathname.startsWith("/api/")) return raw;
      if (UNPREFIXED_API_PATHS.some((p) => url.pathname.startsWith(p))) {
        return url.toString();
      }
      // Already prefixed — leave alone.
      if (url.pathname.startsWith(`${prefix}/`) || url.pathname === prefix) {
        return url.toString();
      }
      const tail = url.pathname.slice("/api".length);
      url.pathname = `${prefix}${tail}`;
      return url.toString();
    };

    if (typeof input === "string") {
      return inner(rewriteUrl(input), init);
    }
    if (input instanceof URL) {
      return inner(rewriteUrl(input.toString()), init);
    }
    const req = input as Request;
    const rewritten = new Request(rewriteUrl(req.url), req);
    return inner(rewritten, init);
  };

const ContextAwareFetchLive = Layer.succeed(
  FetchHttpClient.Fetch,
  typeof globalThis.fetch === "function"
    ? wrapFetch(globalThis.fetch.bind(globalThis))
    : (globalThis.fetch as typeof globalThis.fetch),
);

export const ContextAwareHttpClient = FetchHttpClient.layer.pipe(
  Layer.provide(ContextAwareFetchLive),
);

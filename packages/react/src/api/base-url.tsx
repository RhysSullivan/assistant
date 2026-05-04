// ---------------------------------------------------------------------------
// Static API base URL — `${origin}/api` on the browser, dev fallback in SSR.
// Per-org / per-workspace prefixing happens at fetch time inside
// `ContextAwareHttpClient` (see `./http-client.tsx`); callers don't try to
// thread the active context through the base URL because Effect's
// `AtomHttpApi.Service` snapshots `baseUrl` at module load.
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://127.0.0.1:4000";

export const getBaseUrl = (): string =>
  typeof window !== "undefined" && typeof window.location?.origin === "string"
    ? `${window.location.origin}/api`
    : `${DEFAULT_BASE_URL}/api`;

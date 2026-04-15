// ---------------------------------------------------------------------------
// scope-chain-prototype
//
// A walled-off playground for modeling the layered-scope primitive discussed
// in notes. Plain TypeScript, in-memory, synchronous. The goal is to nail
// down semantics via tests before touching the real SecretStore / registries.
//
// Concepts:
//   Layer       A named bag. { id, kind, name }. No parent field.
//   ScopeChain  Ordered list of Layers, narrowest first (PATH-style).
//   AuthScope   How a source decides which layer to write tokens to.
//   ChainSource An installed source. Lives at one layer; its tokens may
//               live at a different layer (determined by authScope).
//
// Rules:
//   - resolve walks the chain narrowest→widest, first hit wins
//   - list merges across the chain with shadow-dedup by id (narrower wins)
//   - pickAuthLayer decides *where OAuth writes* when a flow completes
//   - a miss is a clean failure — no silent fallback, no cross-user leakage
// ---------------------------------------------------------------------------

// ---------- Types ----------------------------------------------------------

export type Layer = {
  readonly id: string;
  readonly kind: string; // free-form label: "org" | "workspace" | "user" | ...
  readonly name: string;
};

export type ScopeChain = readonly Layer[];

export type AuthScope =
  | { readonly type: "inherit" }
  | { readonly type: "kind"; readonly kind: string }
  | { readonly type: "pinned"; readonly scopeId: string };

export type ChainSource = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** scope id where the source was installed */
  readonly installedAt: string;
  readonly authScope: AuthScope;
};

export type Resolved<T> = {
  readonly value: T;
  readonly resolvedAt: Layer;
};

// ---------- Layer helpers --------------------------------------------------

export const layer = (kind: string) => (id: string, name: string): Layer => ({
  id,
  kind,
  name,
});

export const platform = layer("platform");
export const org = layer("org");
export const workspace = layer("workspace");
export const user = layer("user");
export const serviceAccount = layer("service-account");

// ---------- ChainSecretStore ----------------------------------------------

/**
 * Secrets are keyed by (logicalName, scopeId). The same logical name
 * (e.g. "gmail:access") can exist at multiple layers; the chain decides
 * which one you see.
 */
export const makeChainSecretStore = () => {
  // scopeId → (logicalName → value)
  const byScope = new Map<string, Map<string, string>>();

  const set = (name: string, scopeId: string, value: string): void => {
    let m = byScope.get(scopeId);
    if (!m) {
      m = new Map();
      byScope.set(scopeId, m);
    }
    m.set(name, value);
  };

  const remove = (name: string, scopeId: string): boolean => {
    return byScope.get(scopeId)?.delete(name) ?? false;
  };

  const resolve = (
    name: string,
    chain: ScopeChain,
  ): Resolved<string> | null => {
    for (const l of chain) {
      const v = byScope.get(l.id)?.get(name);
      if (v !== undefined) return { value: v, resolvedAt: l };
    }
    return null;
  };

  const status = (
    name: string,
    chain: ScopeChain,
  ): "resolved" | "missing" => (resolve(name, chain) ? "resolved" : "missing");

  const listAtLayer = (scopeId: string): readonly string[] => [
    ...(byScope.get(scopeId)?.keys() ?? []),
  ];

  return { set, remove, resolve, status, listAtLayer };
};

export type ChainSecretStore = ReturnType<typeof makeChainSecretStore>;

// ---------- ChainSourceRegistry -------------------------------------------

/**
 * Sources are installed at a single layer. list(chain) merges the visible
 * sources from every layer in the chain, with shadow-dedup by source id —
 * narrower layers hide wider ones.
 */
export const makeChainSourceRegistry = () => {
  // scopeId → (sourceId → ChainSource)
  const byScope = new Map<string, Map<string, ChainSource>>();

  const install = (source: ChainSource): void => {
    let m = byScope.get(source.installedAt);
    if (!m) {
      m = new Map();
      byScope.set(source.installedAt, m);
    }
    m.set(source.id, source);
  };

  const uninstall = (sourceId: string, scopeId: string): boolean =>
    byScope.get(scopeId)?.delete(sourceId) ?? false;

  const list = (chain: ScopeChain): readonly ChainSource[] => {
    const seen = new Map<string, ChainSource>();
    for (const l of chain) {
      const m = byScope.get(l.id);
      if (!m) continue;
      for (const [id, src] of m) {
        if (!seen.has(id)) seen.set(id, src);
      }
    }
    return [...seen.values()];
  };

  const get = (
    sourceId: string,
    chain: ScopeChain,
  ): ChainSource | null => list(chain).find((s) => s.id === sourceId) ?? null;

  return { install, uninstall, list, get };
};

export type ChainSourceRegistry = ReturnType<typeof makeChainSourceRegistry>;

// ---------- pickAuthLayer --------------------------------------------------

/**
 * Given a source's authScope and the chain of the caller, pick the layer
 * where OAuth tokens should be written. Returns null when no layer in the
 * chain satisfies the predicate — which is a clean failure, not a fallback.
 */
export const pickAuthLayer = (
  source: ChainSource,
  chain: ScopeChain,
): Layer | null => {
  switch (source.authScope.type) {
    case "inherit":
      return chain.find((l) => l.id === source.installedAt) ?? null;
    case "kind": {
      const target = source.authScope.kind;
      return chain.find((l) => l.kind === target) ?? null;
    }
    case "pinned": {
      const target = source.authScope.scopeId;
      return chain.find((l) => l.id === target) ?? null;
    }
  }
};

// ---------- OAuth simulation helpers --------------------------------------

/**
 * Simulate a completed OAuth flow: compute the write target from authScope,
 * and write the token there. Returns the layer it landed at, or null if
 * no matching layer existed (clean failure — caller surfaces the error).
 */
export const completeOAuth = (
  secrets: ChainSecretStore,
  source: ChainSource,
  chain: ScopeChain,
  tokens: { readonly access: string; readonly refresh?: string },
): Layer | null => {
  const target = pickAuthLayer(source, chain);
  if (!target) return null;
  secrets.set(`${source.id}:access`, target.id, tokens.access);
  if (tokens.refresh !== undefined) {
    secrets.set(`${source.id}:refresh`, target.id, tokens.refresh);
  }
  return target;
};

/**
 * Simulate refresh-in-place: resolve the current access token, pretend to
 * exchange the refresh token for a new access token, and write the new one
 * back at *the same layer* the original was resolved from.
 *
 * This is the key invariant from the design: refreshes do NOT migrate
 * tokens between layers. Whatever layer they were read from is where
 * they get rewritten.
 */
export const refreshInPlace = (
  secrets: ChainSecretStore,
  source: ChainSource,
  chain: ScopeChain,
  mintNewAccess: () => string,
): Resolved<string> | null => {
  const current = secrets.resolve(`${source.id}:access`, chain);
  if (!current) return null;
  const next = mintNewAccess();
  secrets.set(`${source.id}:access`, current.resolvedAt.id, next);
  return { value: next, resolvedAt: current.resolvedAt };
};

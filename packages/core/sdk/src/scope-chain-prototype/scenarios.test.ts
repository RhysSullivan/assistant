// ---------------------------------------------------------------------------
// scope-chain-prototype — scenarios
//
// These tests are the design. Each one names a case from the design thread:
// Gmail-at-workspace, shared Slack bot, BYO OAuth client, headless agent,
// refresh-in-place, shadowing, etc. If any of these feel wrong, the shape
// of the primitive is wrong — not the test.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "@effect/vitest";

import {
  completeOAuth,
  makeChainSecretStore,
  makeChainSourceRegistry,
  org,
  pickAuthLayer,
  platform,
  refreshInPlace,
  user,
  workspace,
  type ChainSource,
  type ScopeChain,
} from "./index";

// ---------- Fixtures -------------------------------------------------------

const PLATFORM = platform("platform", "Platform");
const ACME = org("org_acme", "Acme Inc");
const MARKETING = workspace("ws_marketing", "Marketing");
const ENGINEERING = workspace("ws_engineering", "Engineering");
const ALICE = user("user_alice", "Alice");
const BOB = user("user_bob", "Bob");

// A caller's chain: narrowest → widest
const chainFor = (...layers: ReadonlyArray<typeof PLATFORM>): ScopeChain => layers;

const gmailAtMarketing: ChainSource = {
  id: "gmail",
  name: "Gmail",
  kind: "google",
  installedAt: MARKETING.id,
  authScope: { type: "kind", kind: "user" },
};

const slackBotAtMarketing: ChainSource = {
  id: "slack",
  name: "Slack",
  kind: "slack",
  installedAt: MARKETING.id,
  authScope: { type: "inherit" },
};

// ---------- Resolve cascade ------------------------------------------------

describe("resolve cascades narrowest → widest", () => {
  it("returns the narrowest match", () => {
    const secrets = makeChainSecretStore();
    secrets.set("k", ACME.id, "org-value");
    secrets.set("k", MARKETING.id, "workspace-value");
    secrets.set("k", ALICE.id, "alice-value");

    const chain = chainFor(ALICE, MARKETING, ACME, PLATFORM);
    const r = secrets.resolve("k", chain);
    expect(r?.value).toBe("alice-value");
    expect(r?.resolvedAt.id).toBe(ALICE.id);
  });

  it("falls through to wider layers when narrower has no value", () => {
    const secrets = makeChainSecretStore();
    secrets.set("k", ACME.id, "org-value");

    const chain = chainFor(ALICE, MARKETING, ACME);
    expect(secrets.resolve("k", chain)?.value).toBe("org-value");
    expect(secrets.resolve("k", chain)?.resolvedAt.id).toBe(ACME.id);
  });

  it("returns null when no layer has the secret (clean miss)", () => {
    const secrets = makeChainSecretStore();
    const chain = chainFor(ALICE, MARKETING, ACME);
    expect(secrets.resolve("k", chain)).toBeNull();
    expect(secrets.status("k", chain)).toBe("missing");
  });

  it("same chain resolves differently for different users", () => {
    const secrets = makeChainSecretStore();
    secrets.set("k", ALICE.id, "alice");
    secrets.set("k", BOB.id, "bob");

    expect(secrets.resolve("k", chainFor(ALICE, MARKETING))?.value).toBe("alice");
    expect(secrets.resolve("k", chainFor(BOB, MARKETING))?.value).toBe("bob");
  });
});

// ---------- Source merge ---------------------------------------------------

describe("source list merges with shadow-dedup", () => {
  it("exposes sources from every layer in the chain", () => {
    const sources = makeChainSourceRegistry();
    sources.install(slackBotAtMarketing);
    sources.install({
      id: "stripe",
      name: "Stripe",
      kind: "openapi",
      installedAt: ACME.id,
      authScope: { type: "inherit" },
    });

    const chain = chainFor(ALICE, MARKETING, ACME);
    const ids = sources.list(chain).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["slack", "stripe"]));
    expect(ids).toHaveLength(2);
  });

  it("narrower layer shadows wider layer for same source id", () => {
    const sources = makeChainSourceRegistry();
    // Org-wide GitHub
    sources.install({
      id: "github",
      name: "GitHub (org)",
      kind: "openapi",
      installedAt: ACME.id,
      authScope: { type: "inherit" },
    });
    // Alice's personal GitHub override — same id, different layer
    sources.install({
      id: "github",
      name: "GitHub (alice)",
      kind: "openapi",
      installedAt: ALICE.id,
      authScope: { type: "inherit" },
    });

    const aliceChain = chainFor(ALICE, ACME);
    const bobChain = chainFor(BOB, ACME);

    expect(sources.get("github", aliceChain)?.name).toBe("GitHub (alice)");
    expect(sources.get("github", bobChain)?.name).toBe("GitHub (org)");
  });

  it("hides sources installed at layers not in the chain", () => {
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing); // installed at MARKETING

    // Engineering workspace never sees Marketing's source
    const engChain = chainFor(ALICE, ENGINEERING, ACME);
    expect(sources.list(engChain)).toHaveLength(0);
  });
});

// ---------- pickAuthLayer --------------------------------------------------

describe("pickAuthLayer", () => {
  it("inherit → source's own layer", () => {
    const chain = chainFor(ALICE, MARKETING, ACME);
    const layer = pickAuthLayer(slackBotAtMarketing, chain);
    expect(layer?.id).toBe(MARKETING.id);
  });

  it("kind=user → narrowest user-kind layer in the chain", () => {
    const chain = chainFor(ALICE, MARKETING, ACME);
    const layer = pickAuthLayer(gmailAtMarketing, chain);
    expect(layer?.id).toBe(ALICE.id);
  });

  it("kind=user with no user layer in chain → null (clean failure)", () => {
    const agentChain = chainFor(MARKETING, ACME, PLATFORM);
    expect(pickAuthLayer(gmailAtMarketing, agentChain)).toBeNull();
  });

  it("pinned → the named scope if in chain, else null", () => {
    const pinned: ChainSource = {
      ...gmailAtMarketing,
      authScope: { type: "pinned", scopeId: ACME.id },
    };
    expect(pickAuthLayer(pinned, chainFor(ALICE, MARKETING, ACME))?.id).toBe(ACME.id);
    expect(pickAuthLayer(pinned, chainFor(ALICE, MARKETING))).toBeNull();
  });
});

// ---------- The flagship scenario: Gmail at workspace ---------------------

describe("Gmail at workspace, authScope user", () => {
  it("Alice OAuths and her token lands at her user layer", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);

    // Before: source visible, but no token for Alice
    expect(sources.list(aliceChain).map((s) => s.id)).toContain("gmail");
    expect(secrets.status("gmail:access", aliceChain)).toBe("missing");

    // Alice completes OAuth
    const landedAt = completeOAuth(secrets, gmailAtMarketing, aliceChain, {
      access: "alice-access-token",
      refresh: "alice-refresh-token",
    });

    // Token lands at ALICE, not MARKETING
    expect(landedAt?.id).toBe(ALICE.id);
    expect(secrets.status("gmail:access", aliceChain)).toBe("resolved");

    // And secretly: the token is actually stored at user:alice
    expect(secrets.listAtLayer(ALICE.id)).toContain("gmail:access");
    expect(secrets.listAtLayer(MARKETING.id)).not.toContain("gmail:access");
  });

  it("Bob sees the same source but no token until he signs in himself", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);
    const bobChain = chainFor(BOB, MARKETING, ACME);

    // Alice signs in
    completeOAuth(secrets, gmailAtMarketing, aliceChain, { access: "alice-tok" });

    // Alice resolves, Bob does not
    expect(secrets.resolve("gmail:access", aliceChain)?.value).toBe("alice-tok");
    expect(secrets.resolve("gmail:access", bobChain)).toBeNull();
    expect(secrets.status("gmail:access", bobChain)).toBe("missing");

    // Bob signs in with his own account
    completeOAuth(secrets, gmailAtMarketing, bobChain, { access: "bob-tok" });

    // Each resolves to their own token. No leakage.
    expect(secrets.resolve("gmail:access", aliceChain)?.value).toBe("alice-tok");
    expect(secrets.resolve("gmail:access", bobChain)?.value).toBe("bob-tok");
  });
});

// ---------- Shared workspace OAuth (Slack bot) ----------------------------

describe("Slack bot at workspace, authScope inherit", () => {
  it("one person OAuths, everyone in the workspace resolves the same token", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(slackBotAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);
    const bobChain = chainFor(BOB, MARKETING, ACME);

    // Alice (an admin) completes OAuth for the shared bot
    const landedAt = completeOAuth(secrets, slackBotAtMarketing, aliceChain, {
      access: "xoxb-shared",
    });
    expect(landedAt?.id).toBe(MARKETING.id);

    // Both Alice and Bob resolve the same token from the workspace layer
    expect(secrets.resolve("slack:access", aliceChain)?.value).toBe("xoxb-shared");
    expect(secrets.resolve("slack:access", bobChain)?.value).toBe("xoxb-shared");
    expect(secrets.resolve("slack:access", aliceChain)?.resolvedAt.id).toBe(MARKETING.id);
  });
});

// ---------- BYO OAuth client credentials (shadowing a platform default) --

describe("BYO OAuth app: org override shadows platform default", () => {
  it("client_id/client_secret resolve from platform until org overrides", () => {
    const secrets = makeChainSecretStore();
    // Platform-provided default
    secrets.set("google:client_id", PLATFORM.id, "platform-client-id");
    secrets.set("google:client_secret", PLATFORM.id, "platform-client-secret");

    const chain = chainFor(ALICE, MARKETING, ACME, PLATFORM);

    expect(secrets.resolve("google:client_id", chain)?.value).toBe("platform-client-id");
    expect(secrets.resolve("google:client_id", chain)?.resolvedAt.id).toBe(PLATFORM.id);

    // Acme wants to use their own OAuth app — write at org, same name
    secrets.set("google:client_id", ACME.id, "acme-client-id");
    secrets.set("google:client_secret", ACME.id, "acme-client-secret");

    // Same call site, different result. No handler code needs to change.
    expect(secrets.resolve("google:client_id", chain)?.value).toBe("acme-client-id");
    expect(secrets.resolve("google:client_id", chain)?.resolvedAt.id).toBe(ACME.id);

    // Another org without the override still sees the platform default
    const OTHER_ORG = org("org_other", "Other Inc");
    const otherChain = chainFor(ALICE, OTHER_ORG, PLATFORM);
    expect(secrets.resolve("google:client_id", otherChain)?.value).toBe("platform-client-id");
  });
});

// ---------- Agent / non-interactive execution ------------------------------

describe("headless agent without a user layer", () => {
  it("per-user source cleanly fails to resolve — no silent leakage", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing);

    // Alice has signed in in another session
    completeOAuth(
      secrets,
      gmailAtMarketing,
      chainFor(ALICE, MARKETING, ACME),
      { access: "alice-tok" },
    );

    // An unattended agent runs with no user layer in its chain
    const agentChain = chainFor(MARKETING, ACME, PLATFORM);

    // The source is visible (installed at the workspace)...
    expect(sources.get("gmail", agentChain)?.id).toBe("gmail");
    // ...but the token does NOT leak from Alice's user layer
    expect(secrets.resolve("gmail:access", agentChain)).toBeNull();
    // OAuth can't complete either — pickAuthLayer returns null
    expect(pickAuthLayer(gmailAtMarketing, agentChain)).toBeNull();
  });

  it("an agent run as Alice (delegated) does resolve her token", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);
    completeOAuth(secrets, gmailAtMarketing, aliceChain, { access: "alice-tok" });

    // Agent invoked "as Alice" — her user layer is explicitly in the chain
    const delegatedAgentChain = chainFor(ALICE, MARKETING, ACME);
    expect(secrets.resolve("gmail:access", delegatedAgentChain)?.value).toBe("alice-tok");
  });
});

// ---------- Refresh in place ----------------------------------------------

describe("refresh-in-place writes back at resolvedAt", () => {
  it("refresh rewrites the token at the layer it was read from", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(gmailAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);
    completeOAuth(secrets, gmailAtMarketing, aliceChain, {
      access: "stale-token",
      refresh: "r1",
    });

    const after = refreshInPlace(secrets, gmailAtMarketing, aliceChain, () => "fresh-token");

    expect(after?.value).toBe("fresh-token");
    expect(after?.resolvedAt.id).toBe(ALICE.id);
    // The new value is at Alice, not promoted to the workspace
    expect(secrets.listAtLayer(ALICE.id)).toContain("gmail:access");
    expect(secrets.listAtLayer(MARKETING.id)).not.toContain("gmail:access");
  });

  it("refresh of a shared workspace token stays at the workspace", () => {
    const secrets = makeChainSecretStore();
    const sources = makeChainSourceRegistry();
    sources.install(slackBotAtMarketing);

    const aliceChain = chainFor(ALICE, MARKETING, ACME);
    completeOAuth(secrets, slackBotAtMarketing, aliceChain, { access: "stale" });

    // Bob's session triggers the refresh...
    const bobChain = chainFor(BOB, MARKETING, ACME);
    const after = refreshInPlace(secrets, slackBotAtMarketing, bobChain, () => "fresh");

    // ...and it still lands at the workspace, not Bob's user layer
    expect(after?.resolvedAt.id).toBe(MARKETING.id);
    expect(secrets.listAtLayer(MARKETING.id)).toContain("slack:access");
    expect(secrets.listAtLayer(BOB.id)).not.toContain("slack:access");
  });
});

// ---------- User-composed chain (prepended personal layer) ----------------

describe("user-composed chain: personal account prepended", () => {
  it("Alice's personal secrets shadow workspace secrets when she opts in", () => {
    const secrets = makeChainSecretStore();
    const ALICE_PERSONAL = user("user_alice_personal", "Alice (personal)");

    // Workspace has a shared OpenAI key
    secrets.set("openai:key", MARKETING.id, "sk-team");
    // Alice also has her own
    secrets.set("openai:key", ALICE_PERSONAL.id, "sk-alice");

    // Default chain: no personal layer → resolves to team key
    const defaultChain = chainFor(ALICE, MARKETING, ACME);
    expect(secrets.resolve("openai:key", defaultChain)?.value).toBe("sk-team");

    // Alice prepends her personal layer — explicit opt-in
    const composedChain = chainFor(ALICE_PERSONAL, ALICE, MARKETING, ACME);
    expect(secrets.resolve("openai:key", composedChain)?.value).toBe("sk-alice");
  });
});

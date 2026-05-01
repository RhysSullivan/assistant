import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import { makeMemoryAdapter } from "@executor-js/storage-core/testing/memory";

import { makeInMemoryBlobStore } from "./blob";
import {
  ConnectionRefreshError,
  CreateConnectionInput,
  TokenMaterial,
  UpdateConnectionTokensInput,
  type ConnectionProvider,
  type ConnectionRefreshInput,
  type ConnectionRefreshResult,
} from "./connections";
import { collectSchemas, createExecutor } from "./executor";
import { ConnectionId, ScopeId, SecretId } from "./ids";
import { definePlugin } from "./plugin";
import { Scope } from "./scope";
import { SetSecretInput, type SecretProvider } from "./secrets";
import { makeTestConfig } from "./testing";

// ---------------------------------------------------------------------------
// Shared fixture helpers. Each test builds its own plugin stack so refresh
// handlers and captured provider inputs stay isolated.
// ---------------------------------------------------------------------------

const makeMemoryProvider = (): SecretProvider => {
  const store = new Map<string, string>();
  const key = (scope: string, id: string) => `${scope}\0${id}`;
  return {
    key: "memory",
    writable: true,
    get: (id, scope) => Effect.sync(() => store.get(key(scope, id)) ?? null),
    set: (id, value, scope) =>
      Effect.sync(() => {
        store.set(key(scope, id), value);
      }),
    delete: (id, scope) => Effect.sync(() => store.delete(key(scope, id))),
    list: () =>
      Effect.sync(() =>
        Array.from(store.keys()).map((k) => {
          const name = k.split("\0", 2)[1] ?? k;
          return { id: name, name };
        }),
      ),
  };
};

const memorySecretsPlugin = (provider: SecretProvider = makeMemoryProvider()) =>
  definePlugin(() => ({
    id: "memory-secrets" as const,
    storage: () => ({}),
    secretProviders: [provider],
  }))();

// Connection provider factory that records every refresh call and returns
// whatever result the test asked for. The `refresh` handler is optional —
// tests that exercise "no refresh" behavior omit it.
const makeConnectionProvider = (opts: {
  key: string;
  refresh?: (input: ConnectionRefreshInput) => ConnectionRefreshResult;
}) => {
  const calls: ConnectionRefreshInput[] = [];
  const provider: ConnectionProvider = {
    key: opts.key,
    ...(opts.refresh
      ? {
          refresh: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return opts.refresh!(input);
            }),
        }
      : {}),
  };
  return { provider, calls };
};

const connPlugin = (provider: ConnectionProvider) =>
  definePlugin(() => ({
    id: "conn-test" as const,
    storage: () => ({}),
    connectionProviders: [provider],
  }))();

const sid = (s: string) => SecretId.make(s);
const cid = (s: string) => ConnectionId.make(s);
const scpid = (s: string) => ScopeId.make(s);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connections", () => {
  it.effect("create + get + list round-trips", () =>
    Effect.gen(function* () {
      const { provider } = makeConnectionProvider({ key: "spotify" });
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
        }),
      );

      const created = yield* executor.connections.create(
        new CreateConnectionInput({
          id: cid("conn-1"),
          scope: scpid("test-scope"),
          provider: "spotify",
          identityLabel: "alice",
          accessToken: new TokenMaterial({
            secretId: sid("conn-1.access"),
            name: "access",
            value: "access-v1",
          }),
          refreshToken: new TokenMaterial({
            secretId: sid("conn-1.refresh"),
            name: "refresh",
            value: "refresh-v1",
          }),
          expiresAt: Date.now() + 3_600_000,
          oauthScope: "user-read",
          providerState: null,
        }),
      );
      expect(created.id).toBe(cid("conn-1"));
      expect(created.identityLabel).toBe("alice");

      const got = yield* executor.connections.get("conn-1");
      expect(got?.id).toBe(cid("conn-1"));
      expect(got?.accessTokenSecretId).toBe(sid("conn-1.access"));

      const list = yield* executor.connections.list();
      expect(list.map((r) => r.id)).toEqual([cid("conn-1")]);
    }),
  );

  it.effect("create fails when the provider is not registered", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin()] as const,
        }),
      );

      const err = yield* executor.connections
        .create(
          new CreateConnectionInput({
            id: cid("conn-x"),
            scope: scpid("test-scope"),
            provider: "unregistered",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-x.access"),
              name: "access",
              value: "a",
            }),
            refreshToken: null,
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        )
        .pipe(Effect.flip);
      expect(err._tag).toBe("ConnectionProviderNotRegisteredError");
    }),
  );

  it.effect("create fails when the target scope is outside the stack", () =>
    Effect.gen(function* () {
      const { provider } = makeConnectionProvider({ key: "spotify" });
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
        }),
      );

      const result = yield* Effect.exit(
        executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-y"),
            scope: scpid("not-in-stack"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-y.access"),
              name: "access",
              value: "a",
            }),
            refreshToken: null,
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        ),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect(
    "secrets.list hides connection-owned secrets but surfaces bare ones",
    () =>
      Effect.gen(function* () {
        const { provider } = makeConnectionProvider({ key: "spotify" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.secrets.set(
          new SetSecretInput({
            id: sid("bare-api"),
            scope: scpid("test-scope"),
            name: "bare API key",
            value: "bare",
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "a",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "r",
            }),
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );

        const list = yield* executor.secrets.list();
        const ids = list.map((s) => s.id as unknown as string);
        expect(ids).toContain("bare-api");
        expect(ids).not.toContain("conn-1.access");
        expect(ids).not.toContain("conn-1.refresh");
      }),
  );

  it.effect(
    "secrets.remove rejects connection-owned secrets with SecretOwnedByConnectionError",
    () =>
      Effect.gen(function* () {
        const { provider } = makeConnectionProvider({ key: "spotify" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "a",
            }),
            refreshToken: null,
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );

        const err = yield* executor.secrets
          .remove("conn-1.access")
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe(
          "SecretOwnedByConnectionError",
        );
      }),
  );

  it.effect(
    "connections.remove cascades through providers and deletes the core row",
    () =>
      Effect.gen(function* () {
        const secretProvider = makeMemoryProvider();
        const { provider } = makeConnectionProvider({ key: "spotify" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [
              memorySecretsPlugin(secretProvider),
              connPlugin(provider),
            ] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "access-v1",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "refresh-v1",
            }),
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );

        // Pre-check: backing provider holds the tokens.
        expect(
          yield* secretProvider.get!("conn-1.access", "test-scope"),
        ).toBe("access-v1");
        expect(
          yield* secretProvider.get!("conn-1.refresh", "test-scope"),
        ).toBe("refresh-v1");

        yield* executor.connections.remove("conn-1");

        // Connection row gone.
        expect(yield* executor.connections.get("conn-1")).toBeNull();
        // Backing secret values gone from the provider.
        expect(
          yield* secretProvider.get!("conn-1.access", "test-scope"),
        ).toBeNull();
        expect(
          yield* secretProvider.get!("conn-1.refresh", "test-scope"),
        ).toBeNull();
      }),
  );

  it.effect("accessToken returns the stored value when not near expiry", () =>
    Effect.gen(function* () {
      const { provider, calls } = makeConnectionProvider({
        key: "spotify",
        refresh: () => ({
          accessToken: "should-not-be-used",
        }),
      });
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
        }),
      );

      yield* executor.connections.create(
        new CreateConnectionInput({
          id: cid("conn-1"),
          scope: scpid("test-scope"),
          provider: "spotify",
          identityLabel: null,
          accessToken: new TokenMaterial({
            secretId: sid("conn-1.access"),
            name: "access",
            value: "access-fresh",
          }),
          refreshToken: new TokenMaterial({
            secretId: sid("conn-1.refresh"),
            name: "refresh",
            value: "refresh-v1",
          }),
          // Expiry far in the future — no refresh.
          expiresAt: Date.now() + 3_600_000,
          oauthScope: null,
          providerState: null,
        }),
      );

      const token = yield* executor.connections.accessToken("conn-1");
      expect(token).toBe("access-fresh");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect(
    "accessToken calls provider.refresh inside the skew window and writes new tokens back",
    () =>
      Effect.gen(function* () {
        const secretProvider = makeMemoryProvider();
        const { provider, calls } = makeConnectionProvider({
          key: "spotify",
          refresh: (input) => ({
            accessToken: `rotated-${input.refreshToken ?? "none"}`,
            refreshToken: "refresh-v2",
            expiresAt: Date.now() + 3_600_000,
            oauthScope: "user-read user-modify",
            providerState: { rotation: "bumped" },
          }),
        });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [
              memorySecretsPlugin(secretProvider),
              connPlugin(provider),
            ] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: "alice",
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "access-v1",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "refresh-v1",
            }),
            // Already expired so we're well inside the 60s skew window.
            expiresAt: Date.now() - 1_000,
            oauthScope: "user-read",
            providerState: { rotation: "fresh" },
          }),
        );

        const token = yield* executor.connections.accessToken("conn-1");
        expect(token).toBe("rotated-refresh-v1");
        expect(calls).toHaveLength(1);
        expect(calls[0]!.identityLabel).toBe("alice");
        expect(calls[0]!.refreshToken).toBe("refresh-v1");
        expect(calls[0]!.providerState).toEqual({ rotation: "fresh" });

        // Backing secrets got rewritten at the same ids.
        expect(
          yield* secretProvider.get!("conn-1.access", "test-scope"),
        ).toBe("rotated-refresh-v1");
        expect(
          yield* secretProvider.get!("conn-1.refresh", "test-scope"),
        ).toBe("refresh-v2");

        const got = yield* executor.connections.get("conn-1");
        expect(got?.providerState).toEqual({ rotation: "bumped" });
        expect(got?.oauthScope).toBe("user-read user-modify");
      }),
  );

  it.effect(
    "accessToken dedupes concurrent refreshes into a single provider call",
    () =>
      Effect.gen(function* () {
        // A gated refresh provider. Every concurrent caller that lands
        // inside the skew window must converge on the single pending
        // refresh instead of hitting the token endpoint N times. The
        // `entered` Deferred signals that the leader fiber is parked
        // inside `refresh`; we only release the `gate` once every
        // caller has had a chance to register.
        const gate = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const calls: ConnectionRefreshInput[] = [];
        let responseCounter = 0;
        const provider: ConnectionProvider = {
          key: "spotify",
          refresh: (input) =>
            Effect.gen(function* () {
              calls.push(input);
              const n = ++responseCounter;
              yield* Deferred.succeed(entered, undefined as void);
              // Block the leader inside `refresh` until the test
              // releases the gate. Any other fiber that concurrently
              // calls `accessToken` must observe the in-flight
              // Deferred instead of entering this handler.
              yield* gate;
              return {
                accessToken: `rotated-${n}`,
                refreshToken: `refresh-${n}`,
                expiresAt: Date.now() + 3_600_000,
                oauthScope: "user-read",
                providerState: null,
              };
            }),
        };

        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "stale",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "refresh-v1",
            }),
            // Expired so every caller enters the refresh branch.
            expiresAt: Date.now() - 1_000,
            oauthScope: null,
            providerState: null,
          }),
        );

        // Kick off the leader first and wait for it to park inside
        // `refresh`. Any subsequent caller is guaranteed to see the
        // in-flight Deferred the leader just registered.
        const leaderFiber = yield* Effect.fork(
          executor.connections.accessToken("conn-1"),
        );
        yield* entered;

        const followerFibers = yield* Effect.forEach(
          [1, 2, 3, 4],
          () => Effect.fork(executor.connections.accessToken("conn-1")),
          { concurrency: "unbounded" },
        );

        // Every follower is queued on the leader's Deferred. Release
        // the gate — the leader resolves, waiters wake up with the
        // same token, no extra `refresh` is invoked.
        yield* Deferred.succeed(gate, undefined as void);

        const leaderResult = yield* leaderFiber;
        const followerResults = yield* Effect.all(
          followerFibers.map((f) => f.await),
          { concurrency: "unbounded" },
        );
        expect(leaderResult).toBe("rotated-1");
        for (const r of followerResults) {
          expect(r._tag).toBe("Success");
          if (r._tag === "Success") expect(r.value).toBe("rotated-1");
        }
        expect(calls).toHaveLength(1);
      }),
  );

  it.effect(
    "accessToken surfaces ConnectionReauthRequiredError when refresh fails with reauthRequired",
    () =>
      Effect.gen(function* () {
        const provider: ConnectionProvider = {
          key: "spotify",
          refresh: (input) =>
            Effect.fail(
              new ConnectionRefreshError({
                connectionId: input.connectionId,
                message:
                  "OAuth token exchange failed: invalid_grant (stored refresh_token revoked)",
                reauthRequired: true,
              }),
            ),
        };

        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: "alice",
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "stale",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "revoked",
            }),
            expiresAt: Date.now() - 1_000,
            oauthScope: null,
            providerState: null,
          }),
        );

        const flipped = yield* executor.connections
          .accessToken("conn-1")
          .pipe(Effect.flip);
        expect(flipped._tag).toBe("ConnectionReauthRequiredError");
        if (flipped._tag !== "ConnectionReauthRequiredError") return;
        expect(flipped.provider).toBe("spotify");
        expect(flipped.message).toMatch(/invalid_grant/);
      }),
  );

  it.effect(
    "accessToken preserves ConnectionRefreshError for non-reauth failures",
    () =>
      Effect.gen(function* () {
        // Transient failure path — the provider failed but not with a
        // terminal RFC 6749 code. The SDK must keep it as-is so
        // callers can tell "retry later" from "prompt for sign-in".
        const provider: ConnectionProvider = {
          key: "spotify",
          refresh: (input) =>
            Effect.fail(
              new ConnectionRefreshError({
                connectionId: input.connectionId,
                message: "network flake",
              }),
            ),
        };

        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "stale",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "refresh-v1",
            }),
            expiresAt: Date.now() - 1_000,
            oauthScope: null,
            providerState: null,
          }),
        );

        const err = yield* executor.connections
          .accessToken("conn-1")
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe("ConnectionRefreshError");
      }),
  );

  it.effect(
    "accessToken fails with ConnectionRefreshNotSupportedError when provider omits refresh",
    () =>
      Effect.gen(function* () {
        const { provider } = makeConnectionProvider({ key: "static-token" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "static-token",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "a",
            }),
            refreshToken: null,
            expiresAt: Date.now() - 1_000,
            oauthScope: null,
            providerState: null,
          }),
        );

        const err = yield* executor.connections
          .accessToken("conn-1")
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe(
          "ConnectionRefreshNotSupportedError",
        );
      }),
  );

  it.effect(
    "accessToken fails with ConnectionNotFoundError for an unknown id",
    () =>
      Effect.gen(function* () {
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin()] as const,
          }),
        );

        const err = yield* executor.connections
          .accessToken("does-not-exist")
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe(
          "ConnectionNotFoundError",
        );
      }),
  );

  it.effect(
    "updateTokens writes new values but does not rotate secret ids",
    () =>
      Effect.gen(function* () {
        const secretProvider = makeMemoryProvider();
        const { provider } = makeConnectionProvider({ key: "spotify" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [
              memorySecretsPlugin(secretProvider),
              connPlugin(provider),
            ] as const,
          }),
        );

        yield* executor.connections.create(
          new CreateConnectionInput({
            id: cid("conn-1"),
            scope: scpid("test-scope"),
            provider: "spotify",
            identityLabel: null,
            accessToken: new TokenMaterial({
              secretId: sid("conn-1.access"),
              name: "access",
              value: "v1",
            }),
            refreshToken: new TokenMaterial({
              secretId: sid("conn-1.refresh"),
              name: "refresh",
              value: "r1",
            }),
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );

        const updated = yield* executor.connections.updateTokens(
          new UpdateConnectionTokensInput({
            id: cid("conn-1"),
            accessToken: "v2",
            refreshToken: "r2",
            expiresAt: 1_700_000_000_000,
            oauthScope: "new-scope",
            providerState: { rotation: "next" },
          }),
        );

        expect(updated.accessTokenSecretId).toBe(sid("conn-1.access"));
        expect(updated.refreshTokenSecretId).toBe(sid("conn-1.refresh"));
        expect(updated.expiresAt).toBe(1_700_000_000_000);
        expect(updated.oauthScope).toBe("new-scope");
        expect(updated.providerState).toEqual({ rotation: "next" });

        expect(
          yield* secretProvider.get!("conn-1.access", "test-scope"),
        ).toBe("v2");
        expect(
          yield* secretProvider.get!("conn-1.refresh", "test-scope"),
        ).toBe("r2");
      }),
  );

  it.effect(
    "updateTokens fails with ConnectionNotFoundError for unknown id",
    () =>
      Effect.gen(function* () {
        const { provider } = makeConnectionProvider({ key: "spotify" });
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
          }),
        );

        const err = yield* executor.connections
          .updateTokens(
            new UpdateConnectionTokensInput({
              id: cid("nope"),
              accessToken: "x",
            }),
          )
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe("ConnectionNotFoundError");
      }),
  );

  it.effect("setIdentityLabel updates the label", () =>
    Effect.gen(function* () {
      const { provider } = makeConnectionProvider({ key: "spotify" });
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin(), connPlugin(provider)] as const,
        }),
      );

      yield* executor.connections.create(
        new CreateConnectionInput({
          id: cid("conn-1"),
          scope: scpid("test-scope"),
          provider: "spotify",
          identityLabel: "original",
          accessToken: new TokenMaterial({
            secretId: sid("conn-1.access"),
            name: "access",
            value: "a",
          }),
          refreshToken: null,
          expiresAt: null,
          oauthScope: null,
          providerState: null,
        }),
      );

      yield* executor.connections.setIdentityLabel("conn-1", "alice@example");
      const got = yield* executor.connections.get("conn-1");
      expect(got?.identityLabel).toBe("alice@example");
    }),
  );

  it.effect(
    "setIdentityLabel fails with ConnectionNotFoundError for unknown id",
    () =>
      Effect.gen(function* () {
        const executor = yield* createExecutor(
          makeTestConfig({
            plugins: [memorySecretsPlugin()] as const,
          }),
        );

        const err = yield* executor.connections
          .setIdentityLabel("does-not-exist", "x")
          .pipe(Effect.flip);
        expect((err as { _tag: string })._tag).toBe(
          "ConnectionNotFoundError",
        );
      }),
  );

  it.effect("providers() returns every registered connection provider key", () =>
    Effect.gen(function* () {
      const a = makeConnectionProvider({ key: "prov-a" });
      const b = makeConnectionProvider({ key: "prov-b" });
      const multiPlugin = definePlugin(() => ({
        id: "multi" as const,
        storage: () => ({}),
        connectionProviders: [a.provider, b.provider],
      }))();

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin(), multiPlugin] as const,
        }),
      );

      const keys = yield* executor.connections.providers();
      expect([...keys].sort()).toEqual(["oauth2", "prov-a", "prov-b"]);
    }),
  );

  it.effect("refreshes legacy google-discovery oauth2 provider rows through core oauth", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin()] as const,
        }),
      );
      yield* executor.secrets.set(
        new SetSecretInput({
          id: sid("google_client_id"),
          scope: scpid("test-scope"),
          name: "Google Client ID",
          value: "google-client",
        }),
      );
      yield* executor.secrets.set(
        new SetSecretInput({
          id: sid("google_client_secret"),
          scope: scpid("test-scope"),
          name: "Google Client Secret",
          value: "google-secret",
        }),
      );
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "google-access-v2",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      yield* executor.connections.create(
        new CreateConnectionInput({
          id: cid("google-legacy"),
          scope: scpid("test-scope"),
          provider: "google-discovery:oauth2",
          identityLabel: "Google",
          accessToken: new TokenMaterial({
            secretId: sid("google-legacy.access"),
            name: "access",
            value: "google-access-v1",
          }),
          refreshToken: new TokenMaterial({
            secretId: sid("google-legacy.refresh"),
            name: "refresh",
            value: "google-refresh-v1",
          }),
          expiresAt: Date.now() - 1_000,
          oauthScope: "email",
          providerState: {
            clientIdSecretId: "google_client_id",
            clientSecretSecretId: "google_client_secret",
            scopes: ["email"],
          },
        }),
      );

      const token = yield* executor.connections.accessToken("google-legacy");
      expect(token).toBe("google-access-v2");
      const body = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://oauth2.googleapis.com/token",
      );
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("google-refresh-v1");
    }),
  );

  it.effect("refreshes legacy MCP oauth2 rows by discovering the token endpoint", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [memorySecretsPlugin()] as const,
        }),
      );
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.includes(".well-known/oauth-authorization-server")) {
            return new Response(
              JSON.stringify({
                issuer: "https://as.example.com",
                authorization_endpoint: "https://as.example.com/authorize",
                token_endpoint: "https://as.example.com/token",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          if (url === "https://as.example.com/token") {
            const body = init?.body as URLSearchParams;
            expect(body.get("grant_type")).toBe("refresh_token");
            expect(body.get("client_id")).toBe("mcp-client");
            expect(body.get("refresh_token")).toBe("mcp-refresh-v1");
            return new Response(
              JSON.stringify({
                access_token: "mcp-access-v2",
                token_type: "Bearer",
                expires_in: 3600,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response("not found", { status: 404 });
        });

      yield* executor.connections.create(
        new CreateConnectionInput({
          id: cid("mcp-legacy"),
          scope: scpid("test-scope"),
          provider: "mcp:oauth2",
          identityLabel: "MCP",
          accessToken: new TokenMaterial({
            secretId: sid("mcp-legacy.access"),
            name: "access",
            value: "mcp-access-v1",
          }),
          refreshToken: new TokenMaterial({
            secretId: sid("mcp-legacy.refresh"),
            name: "refresh",
            value: "mcp-refresh-v1",
          }),
          expiresAt: Date.now() - 1_000,
          oauthScope: null,
          providerState: {
            endpoint: "https://mcp.example.com",
            tokenType: "Bearer",
            clientInformation: { client_id: "mcp-client" },
            authorizationServerUrl: "https://as.example.com",
            authorizationServerMetadata: null,
            resourceMetadataUrl: null,
            resourceMetadata: null,
          },
        }),
      );

      const token = yield* executor.connections.accessToken("mcp-legacy");
      expect(token).toBe("mcp-access-v2");
      expect(fetchMock).toHaveBeenCalled();
    }),
  );
});

// ---------------------------------------------------------------------------
// Multi-scope behaviour — two executors sharing an adapter, same connection
// id registered at different scopes. Reads must innermost-win; removes at
// the inner scope must leave the outer-scope connection intact.
// ---------------------------------------------------------------------------

const makeLayeredConnExecutors = () =>
  Effect.gen(function* () {
    const { provider } = makeConnectionProvider({ key: "spotify" });
    const plugins = [memorySecretsPlugin(), connPlugin(provider)] as const;
    const schema = collectSchemas(plugins);
    const adapter = makeMemoryAdapter({ schema });
    const blobs = makeInMemoryBlobStore();

    const outerId = scpid("org");
    const innerId = scpid("user-org:u1:org");
    const outerScope = new Scope({
      id: outerId,
      name: "outer",
      createdAt: new Date(),
    });
    const innerScope = new Scope({
      id: innerId,
      name: "inner",
      createdAt: new Date(),
    });

    const execOuter = yield* createExecutor({
      scopes: [outerScope],
      adapter,
      blobs,
      plugins,
    });
    const execInner = yield* createExecutor({
      scopes: [innerScope, outerScope],
      adapter,
      blobs,
      plugins,
    });
    return { execOuter, execInner, outerId, innerId };
  });

describe("connections — multi-scope behaviour", () => {
  it.effect("get picks the innermost-scope row when the same id exists at two scopes", () =>
    Effect.gen(function* () {
      const { execOuter, execInner, outerId, innerId } =
        yield* makeLayeredConnExecutors();

      yield* execOuter.connections.create(
        new CreateConnectionInput({
          id: cid("shared"),
          scope: outerId,
          provider: "spotify",
          identityLabel: "outer",
          accessToken: new TokenMaterial({
            secretId: sid("shared.access.outer"),
            name: "access",
            value: "outer-access",
          }),
          refreshToken: null,
          expiresAt: null,
          oauthScope: null,
          providerState: null,
        }),
      );

      yield* execInner.connections.create(
        new CreateConnectionInput({
          id: cid("shared"),
          scope: innerId,
          provider: "spotify",
          identityLabel: "inner",
          accessToken: new TokenMaterial({
            secretId: sid("shared.access.inner"),
            name: "access",
            value: "inner-access",
          }),
          refreshToken: null,
          expiresAt: null,
          oauthScope: null,
          providerState: null,
        }),
      );

      const innerView = yield* execInner.connections.get("shared");
      expect(innerView?.identityLabel).toBe("inner");
      expect(innerView?.scopeId).toBe(innerId);

      const outerView = yield* execOuter.connections.get("shared");
      expect(outerView?.identityLabel).toBe("outer");
      expect(outerView?.scopeId).toBe(outerId);

      // Inner executor's list dedupes — one entry for "shared", the inner one.
      const innerList = yield* execInner.connections.list();
      const sharedEntries = innerList.filter((r) => r.id === cid("shared"));
      expect(sharedEntries).toHaveLength(1);
      expect(sharedEntries[0]!.identityLabel).toBe("inner");
    }),
  );

  it.effect(
    "remove at the inner scope does not wipe the outer-scope connection",
    () =>
      Effect.gen(function* () {
        const { execOuter, execInner, outerId, innerId } =
          yield* makeLayeredConnExecutors();

        yield* execOuter.connections.create(
          new CreateConnectionInput({
            id: cid("shared"),
            scope: outerId,
            provider: "spotify",
            identityLabel: "outer",
            accessToken: new TokenMaterial({
              secretId: sid("shared.access.outer"),
              name: "access",
              value: "outer-access",
            }),
            refreshToken: null,
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );
        yield* execInner.connections.create(
          new CreateConnectionInput({
            id: cid("shared"),
            scope: innerId,
            provider: "spotify",
            identityLabel: "inner",
            accessToken: new TokenMaterial({
              secretId: sid("shared.access.inner"),
              name: "access",
              value: "inner-access",
            }),
            refreshToken: null,
            expiresAt: null,
            oauthScope: null,
            providerState: null,
          }),
        );

        yield* execInner.connections.remove("shared");

        const outerStill = yield* execOuter.connections.get("shared");
        expect(outerStill?.identityLabel).toBe("outer");
      }),
  );
});

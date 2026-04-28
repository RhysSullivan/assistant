import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeMemoryAdapter } from "@executor/storage-core/testing/memory";

import {
  collectSchemas,
  createExecutor,
  makeInMemoryBlobStore,
  makeTestConfig,
  Scope,
  ScopeId,
  SecretId,
  SetSecretInput,
  typedAdapter,
} from "@executor/sdk";

import { type WorkOSVaultClient } from "./client";
import { workosVaultPlugin } from "./plugin";
import {
  makeWorkosVaultStore,
  type WorkosVaultSchema,
} from "./secret-store";
import { makeTestWorkOSVaultClient } from "./testing";

const makeExecutor = (client: WorkOSVaultClient) =>
  createExecutor(makeTestConfig({ plugins: [workosVaultPlugin({ client })] as const }));

// ---------------------------------------------------------------------------
// Tests — drive the provider through the real executor's secrets facade
// so we exercise the core `secret` routing table + metadata-store + Vault
// roundtrip all at once.
// ---------------------------------------------------------------------------

describe("WorkOS Vault secret provider", () => {
  it.effect("stores and resolves secrets through WorkOS Vault", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor(makeTestWorkOSVaultClient());

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("github-token"),
          scope: ScopeId.make("test-scope"),
          name: "GitHub Token",
          value: "ghp_secret",
        }),
      );

      expect(yield* executor.secrets.get("github-token")).toBe("ghp_secret");
      expect(executor.workosVault.providerKey).toBe("workos-vault");

      const listed = yield* executor.secrets.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.name).toBe("GitHub Token");
      expect(listed[0]!.provider).toBe("workos-vault");
    }),
  );

  it.effect("updates metadata and secret values in place", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor(makeTestWorkOSVaultClient());

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-key"),
          scope: ScopeId.make("test-scope"),
          name: "Initial",
          value: "v1",
        }),
      );

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-key"),
          scope: ScopeId.make("test-scope"),
          name: "Updated",
          value: "v2",
        }),
      );

      expect(yield* executor.secrets.get("api-key")).toBe("v2");

      const listed = yield* executor.secrets.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.name).toBe("Updated");
    }),
  );

  it.effect("removes secrets from Vault and metadata store", () =>
    Effect.gen(function* () {
      const executor = yield* makeExecutor(makeTestWorkOSVaultClient());

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("remove-me"),
          scope: ScopeId.make("test-scope"),
          name: "Remove Me",
          value: "gone soon",
        }),
      );

      expect(yield* executor.secrets.get("remove-me")).toBe("gone soon");

      yield* executor.secrets.remove("remove-me");

      expect(yield* executor.secrets.get("remove-me")).toBeNull();
      expect(yield* executor.secrets.list()).toHaveLength(0);
    }),
  );

  it.effect("treats invalid Vault object names as missing during removal", () =>
    Effect.gen(function* () {
      const client = makeTestWorkOSVaultClient({ rejectReadNamesLongerThan: 80 });
      const executor = yield* makeExecutor(client);
      const longSecretId = SecretId.make(
        "openapi-oauth-dealcloud-api-oauth2-user-org-user-01kp6xm1zpvqvtpj77f0yv4eax.access_token",
      );

      yield* executor.secrets.set(
        new SetSecretInput({
          id: longSecretId,
          scope: ScopeId.make("test-scope"),
          name: "Long connection token",
          value: "token",
        }),
      );

      yield* executor.secrets.remove(longSecretId);

      expect(yield* executor.secrets.list()).toHaveLength(0);
    }),
  );

  it.effect("retries secret value writes on 409 version conflicts", () =>
    Effect.gen(function* () {
      // Inject one conflict on the next update against `/secrets/conflict`.
      // Flow: first `set` creates the object (no update). Second `set`
      // takes the update path and hits the injected conflict; the retry
      // loop re-reads and succeeds on the second attempt.
      const executor = yield* makeExecutor(
        makeTestWorkOSVaultClient({ conflictOnNextSecretUpdate: true }),
      );

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("conflict"),
          scope: ScopeId.make("test-scope"),
          name: "Conflict",
          value: "initial",
        }),
      );

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("conflict"),
          scope: ScopeId.make("test-scope"),
          name: "Conflict",
          value: "retry-me",
        }),
      );

      expect(yield* executor.secrets.get("conflict")).toBe("retry-me");

      const listed = yield* executor.secrets.list();
      expect(listed.map((s) => s.id)).toEqual(["conflict"]);
    }),
  );
});

// ---------------------------------------------------------------------------
// Multi-scope regression tests — the plugin ships in the cloud app with
// a two-element stack (`[userOrgScope, orgScope]`). When the same secret
// id exists at both scopes (inner override of an outer default), the
// store's `get` / `upsert` / `remove` must operate on the caller-named
// scope's row only. Previously these methods used `where: [{id}]` with
// no scope pin, letting the scoped adapter widen the filter to
// `scope_id IN (stack)` — so a remove at inner scope could wipe the
// outer metadata row, and an update at inner scope could rewrite the
// outer row's name. Each test shares one adapter + one vault client
// across an outer-only executor and an inner-stacked executor.
// ---------------------------------------------------------------------------

const makeLayeredExecutors = (client: WorkOSVaultClient) =>
  Effect.gen(function* () {
    const plugins = [workosVaultPlugin({ client })] as const;
    const schema = collectSchemas(plugins);
    const adapter = makeMemoryAdapter({ schema });
    const metadataStore = makeWorkosVaultStore({
      adapter: typedAdapter<WorkosVaultSchema>(adapter),
    });
    const blobs = makeInMemoryBlobStore();

    const outerId = ScopeId.make("org");
    const innerId = ScopeId.make("user-org:u1:org");
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
    return { execOuter, execInner, outerId, innerId, metadataStore };
  });

describe("WorkOS Vault secret provider — multi-scope isolation", () => {
  it.effect("encodes personal scope ids before using them in Vault object names", () =>
    Effect.gen(function* () {
      const client = makeTestWorkOSVaultClient({ rejectNamesWithColon: true });
      const { execInner, innerId } = yield* makeLayeredExecutors(client);

      yield* execInner.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: innerId,
          name: "Personal token",
          value: "personal",
        }),
      );

      expect(yield* execInner.secrets.get("api-token")).toBe("personal");
    }),
  );

  it.effect("secrets.remove at the inner scope does not wipe outer-scope metadata", () =>
    Effect.gen(function* () {
      const client = makeTestWorkOSVaultClient();
      const { execOuter, execInner, outerId, innerId } = yield* makeLayeredExecutors(client);

      // Outer admin writes the org-wide default.
      yield* execOuter.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: outerId,
          name: "Org default",
          value: "org-default",
        }),
      );
      // Inner user writes their personal override at the inner scope.
      yield* execInner.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: innerId,
          name: "Personal override",
          value: "personal-override",
        }),
      );

      // Inner caller removes. Should only drop the inner row.
      yield* execInner.secrets.remove("api-token");

      // The outer executor must still see its row and resolve its value.
      const outer = yield* execOuter.secrets.list();
      expect(outer.map((r) => r.id)).toContain("api-token");
      expect(yield* execOuter.secrets.get("api-token")).toBe("org-default");
    }),
  );

  it.effect(
    "shadowed `set` produces independent metadata rows — inner write leaves outer row untouched",
    () =>
      // The SDK's core `secret` table shields the user from the plugin's
      // internal metadata corruption (core wins over provider.list in
      // dedupe + SDK uses the caller-supplied scope for vault lookups,
      // not whatever the metadata row says). We assert against the
      // plugin table directly so we exercise the store contract, not
      // just the SDK's defensive shielding.
      Effect.gen(function* () {
        const client = makeTestWorkOSVaultClient();
        const { execOuter, execInner, outerId, innerId, metadataStore } =
          yield* makeLayeredExecutors(client);

        yield* execOuter.secrets.set(
          new SetSecretInput({
            id: SecretId.make("api-token"),
            scope: outerId,
            name: "Org default",
            value: "org-default",
          }),
        );
        yield* execInner.secrets.set(
          new SetSecretInput({
            id: SecretId.make("api-token"),
            scope: innerId,
            name: "Personal override",
            value: "personal-override",
          }),
        );

        const rows = yield* metadataStore.list();
        const scopes = rows
          .filter((row) => row.id === "api-token")
          .map((row) => row.scope_id)
          .sort();
        expect(scopes).toEqual([outerId, innerId].sort());
      }),
  );

  it.effect("shadowed secrets produce independent metadata rows per scope", () =>
    Effect.gen(function* () {
      const client = makeTestWorkOSVaultClient();
      const { execOuter, execInner, outerId, innerId } = yield* makeLayeredExecutors(client);

      yield* execOuter.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: outerId,
          name: "Org default",
          value: "org-default",
        }),
      );
      yield* execInner.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: innerId,
          name: "Personal override",
          value: "personal-override",
        }),
      );

      // Inner sees its override value.
      expect(yield* execInner.secrets.get("api-token")).toBe("personal-override");
      // Outer sees the unshadowed default.
      expect(yield* execOuter.secrets.get("api-token")).toBe("org-default");
    }),
  );
});

// ---------------------------------------------------------------------------
// KEK context shape — each semantic dimension of a scope id must land in
// its own vault-context key so WorkOS's KEK matcher can key off real
// identities (user, org) rather than an opaque compound string. This
// avoids the `KEK was created but is not yet ready` hang we hit when a
// context value itself contained a `:`.
// ---------------------------------------------------------------------------

const makeExecutorForScope = (client: WorkOSVaultClient, scopeId: string) =>
  Effect.gen(function* () {
    const plugins = [workosVaultPlugin({ client })] as const;
    const schema = collectSchemas(plugins);
    const adapter = makeMemoryAdapter({ schema });
    const blobs = makeInMemoryBlobStore();
    const scope = new Scope({
      id: ScopeId.make(scopeId),
      name: scopeId,
      createdAt: new Date(),
    });
    return yield* createExecutor({
      scopes: [scope],
      adapter,
      blobs,
      plugins,
    });
  });

describe("WorkOS Vault secret provider — KEK context", () => {
  it.effect(
    "splits `user-org:<user>:<org>` scopes into `user_id` + `organization_id` context fields",
    () =>
      Effect.gen(function* () {
        const contexts: Record<string, string>[] = [];
        const fake = makeTestWorkOSVaultClient();
        const recording: WorkOSVaultClient = {
          ...fake,
          createObject: (opts) => {
            contexts.push(opts.context);
            return fake.createObject(opts);
          },
        };
        const executor = yield* makeExecutorForScope(recording, "user-org:u1:org42");

        yield* executor.secrets.set(
          new SetSecretInput({
            id: SecretId.make("api-token"),
            scope: ScopeId.make("user-org:u1:org42"),
            name: "Personal",
            value: "v",
          }),
        );

        expect(contexts).toHaveLength(1);
        expect(contexts[0]).toEqual({
          app: "executor",
          user_id: "u1",
          organization_id: "org42",
        });
      }),
  );

  it.effect("falls back to `{app, organization_id: scopeId}` for bare scope ids", () =>
    Effect.gen(function* () {
      const contexts: Record<string, string>[] = [];
      const fake = makeTestWorkOSVaultClient();
      const recording: WorkOSVaultClient = {
        ...fake,
        createObject: (opts) => {
          contexts.push(opts.context);
          return fake.createObject(opts);
        },
      };
      const executor = yield* makeExecutorForScope(recording, "org42");

      yield* executor.secrets.set(
        new SetSecretInput({
          id: SecretId.make("api-token"),
          scope: ScopeId.make("org42"),
          name: "Org default",
          value: "v",
        }),
      );

      expect(contexts[0]).toEqual({
        app: "executor",
        organization_id: "org42",
      });
    }),
  );
});

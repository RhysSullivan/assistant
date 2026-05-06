import { describe, it, expect } from "@effect/vitest";
import { Data, Effect } from "effect";

import {
  ConnectionId,
  CreateConnectionInput,
  createExecutor,
  definePlugin,
  makeTestConfig,
  Scope,
  ScopeId,
  SecretId,
  type SecretProvider,
  TokenMaterial,
} from "@executor-js/sdk";

import { graphqlPlugin } from "./plugin";
import type { IntrospectionResult } from "./introspect";

const TEST_SCOPE = "test-scope";

class TestServerAddressError extends Data.TaggedError("TestServerAddressError")<{}> {}

// ---------------------------------------------------------------------------
// Mock introspection response
// ---------------------------------------------------------------------------

const introspectionResult: IntrospectionResult = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    types: [
      {
        kind: "OBJECT",
        name: "Query",
        description: null,
        fields: [
          {
            name: "hello",
            description: "Say hello",
            args: [
              {
                name: "name",
                description: null,
                type: { kind: "SCALAR", name: "String", ofType: null },
                defaultValue: null,
              },
            ],
            type: { kind: "SCALAR", name: "String", ofType: null },
          },
        ],
        inputFields: null,
        enumValues: null,
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        description: null,
        fields: [
          {
            name: "setGreeting",
            description: "Set greeting message",
            args: [
              {
                name: "message",
                description: null,
                type: {
                  kind: "NON_NULL",
                  name: null,
                  ofType: { kind: "SCALAR", name: "String", ofType: null },
                },
                defaultValue: null,
              },
            ],
            type: { kind: "SCALAR", name: "String", ofType: null },
          },
        ],
        inputFields: null,
        enumValues: null,
      },
      {
        kind: "SCALAR",
        name: "String",
        description: null,
        fields: null,
        inputFields: null,
        enumValues: null,
      },
    ],
  },
};

const introspectionJson = JSON.stringify({ data: introspectionResult });

const makeMemorySecretsPlugin = () => {
  const store = new Map<string, string>();
  const provider: SecretProvider = {
    key: "memory",
    writable: true,
    get: (id, scope) => Effect.sync(() => store.get(`${scope}\u0000${id}`) ?? null),
    set: (id, value, scope) =>
      Effect.sync(() => {
        store.set(`${scope}\u0000${id}`, value);
      }),
    delete: (id, scope) => Effect.sync(() => store.delete(`${scope}\u0000${id}`)),
    list: () =>
      Effect.sync(() =>
        Array.from(store.keys()).map((key) => {
          const name = key.split("\u0000", 2)[1] ?? key;
          return { id: name, name };
        }),
      ),
  };
  return definePlugin(() => ({
    id: "memory-secrets" as const,
    storage: () => ({}),
    secretProviders: [provider],
  }));
};

describe("graphqlPlugin", () => {
  it.effect("registers tools from introspection JSON", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      const result = yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: "test-scope",
        introspectionJson,
        namespace: "test_api",
      });
      expect(result.toolCount).toBe(2);
      expect(result.namespace).toBe("test_api");

      const tools = yield* executor.tools.list();
      const ids = tools.map((t) => t.id);
      expect(ids).toContain("test_api.query.hello");
      expect(ids).toContain("test_api.mutation.setGreeting");
      // static control tool also present
      expect(ids).toContain("graphql.addSource");

      const queryTool = tools.find((t) => t.id === "test_api.query.hello");
      expect(queryTool?.description).toBe("Say hello");

      const mutationTool = tools.find((t) => t.id === "test_api.mutation.setGreeting");
      expect(mutationTool?.description).toBe("Set greeting message");
    }),
  );

  it.effect("removes a source and its tools", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: "test-scope",
        introspectionJson,
        namespace: "removable",
      });

      let tools = yield* executor.tools.list();
      expect(tools.filter((t) => t.sourceId === "removable").length).toBe(2);

      yield* executor.graphql.removeSource("removable", TEST_SCOPE);

      tools = yield* executor.tools.list();
      expect(tools.filter((t) => t.sourceId === "removable").length).toBe(0);

      const source = yield* executor.graphql.getSource("removable", TEST_SCOPE);
      expect(source).toBeNull();
    }),
  );

  it.effect("lists sources with the static control source", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: "test-scope",
        introspectionJson,
        namespace: "my_gql",
      });

      const sources = yield* executor.sources.list();
      const dynamic = sources.find((s) => s.id === "my_gql");
      expect(dynamic).toBeDefined();
      expect(dynamic!.kind).toBe("graphql");
      expect(dynamic!.canRemove).toBe(true);
      expect(dynamic!.canEdit).toBe(true);
      expect(dynamic!.runtime).toBe(false);

      const control = sources.find((s) => s.id === "graphql");
      expect(control).toBeDefined();
      expect(control!.runtime).toBe(true);
    }),
  );

  it.effect("mutations require approval via resolveAnnotations", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: "test-scope",
        introspectionJson,
        namespace: "approval_test",
      });

      const tools = yield* executor.tools.list();
      const mutationTool = tools.find((t) => t.id === "approval_test.mutation.setGreeting");
      expect(mutationTool).toBeDefined();
      expect(mutationTool!.annotations?.requiresApproval).toBe(true);
      expect(mutationTool!.annotations?.approvalDescription).toBe("mutation setGreeting");

      const queryTool = tools.find((t) => t.id === "approval_test.query.hello");
      expect(queryTool).toBeDefined();
      expect(queryTool!.annotations?.requiresApproval).toBeFalsy();
    }),
  );

  it.effect("updateSource patches endpoint/headers without re-registering", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: "test-scope",
        introspectionJson,
        namespace: "patched",
      });

      yield* executor.graphql.updateSource("patched", TEST_SCOPE, {
        endpoint: "http://localhost:5000/graphql",
        headers: { "x-custom": "abc" },
      });

      const source = yield* executor.graphql.getSource("patched", TEST_SCOPE);
      expect(source?.endpoint).toBe("http://localhost:5000/graphql");
      expect(source?.headers).toEqual({ "x-custom": "abc" });

      // Tools still present (no re-register happened, but they were
      // already there from addSource and haven't been removed).
      const tools = yield* executor.tools.list();
      expect(tools.filter((t) => t.sourceId === "patched").length).toBe(2);
    }),
  );

  it.effect("invokes OAuth-backed sources with a bearer token", () =>
    Effect.gen(function* () {
      const http = yield* Effect.promise(() => import("node:http"));
      let authorizationHeader: string | null = null;
      const server = yield* Effect.acquireRelease(
        Effect.callback<
          {
            readonly server: ReturnType<typeof http.createServer>;
            readonly port: number;
          },
          Error | TestServerAddressError
        >((resume) => {
          const server = http.createServer((req, res) => {
            authorizationHeader = req.headers.authorization ?? null;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ data: { hello: "Hello Ada" } }));
          });
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
              resume(Effect.fail(new TestServerAddressError()));
              return;
            }
            resume(Effect.succeed({ server, port: address.port }));
          });
          server.once("error", (error) => resume(Effect.fail(error)));
        }),
        ({ server }) =>
          Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          }).pipe(Effect.ignore),
      );

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [makeMemorySecretsPlugin()(), graphqlPlugin()] as const,
        }),
      );

      const connectionId = ConnectionId.make("graphql-oauth2-test");
      yield* executor.connections.create(
        new CreateConnectionInput({
          id: connectionId,
          scope: ScopeId.make(TEST_SCOPE),
          provider: "oauth2",
          identityLabel: "GraphQL Test",
          accessToken: new TokenMaterial({
            secretId: SecretId.make(`${connectionId}.access_token`),
            name: "GraphQL Access Token",
            value: "secret-token",
          }),
          refreshToken: null,
          expiresAt: null,
          oauthScope: null,
          providerState: null,
        }),
      );

      yield* executor.graphql.addSource({
        endpoint: `http://127.0.0.1:${server.port}/graphql`,
        scope: TEST_SCOPE,
        introspectionJson,
        namespace: "oauth_graph",
        auth: { kind: "oauth2", connectionId },
      });

      const result = yield* executor.tools.invoke("oauth_graph.query.hello", {
        name: "Ada",
      });

      expect(result).toEqual({
        status: 200,
        data: { hello: "Hello Ada" },
        errors: null,
      });
      expect(authorizationHeader).toBe("Bearer secret-token");
    }),
  );

  it.effect("static graphql.addSource delegates to extension", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [graphqlPlugin()] as const }),
      );

      const result = yield* executor.tools.invoke(
        "graphql.addSource",
        {
          endpoint: "http://localhost:4000/graphql",
          introspectionJson,
          namespace: "via_static",
        },
        { onElicitation: "accept-all" },
      );
      expect(result).toEqual({ toolCount: 2, namespace: "via_static" });

      const tools = yield* executor.tools.list();
      expect(tools.filter((t) => t.sourceId === "via_static").length).toBe(2);
    }),
  );

  // -------------------------------------------------------------------------
  // Multi-scope shadowing — regression suite covering the bug class where
  // store reads/writes that don't pin scope_id collapse onto whichever row
  // the scoped adapter's `scope_id IN (stack)` filter sees first. Each
  // scenario is reproducible against the pre-fix store.
  // -------------------------------------------------------------------------

  const ORG_SCOPE = "org-scope";
  const USER_SCOPE = "user-scope";

  const stackedScopes = [
    new Scope({
      id: ScopeId.make(USER_SCOPE),
      name: "user",
      createdAt: new Date(),
    }),
    new Scope({
      id: ScopeId.make(ORG_SCOPE),
      name: "org",
      createdAt: new Date(),
    }),
  ] as const;

  it.effect("shadowed addSource does not wipe the outer-scope source", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [graphqlPlugin()] as const,
        }),
      );

      // Org-level base source
      yield* executor.graphql.addSource({
        endpoint: "http://org.example.com/graphql",
        scope: ORG_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "Org Source",
      });

      // Per-user shadow with the same namespace
      yield* executor.graphql.addSource({
        endpoint: "http://user.example.com/graphql",
        scope: USER_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "User Source",
      });

      const userView = yield* executor.graphql.getSource("shared", USER_SCOPE);
      const orgView = yield* executor.graphql.getSource("shared", ORG_SCOPE);

      // Both rows must coexist — innermost-wins reads come from the
      // executor; the store's scope-pinned getters return the exact row.
      expect(userView?.name).toBe("User Source");
      expect(userView?.scope).toBe(USER_SCOPE);
      expect(userView?.endpoint).toBe("http://user.example.com/graphql");
      expect(orgView?.name).toBe("Org Source");
      expect(orgView?.scope).toBe(ORG_SCOPE);
      expect(orgView?.endpoint).toBe("http://org.example.com/graphql");
    }),
  );

  it.effect("removeSource on user shadow leaves the org row intact", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [graphqlPlugin()] as const,
        }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://org.example.com/graphql",
        scope: ORG_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "Org Source",
      });
      yield* executor.graphql.addSource({
        endpoint: "http://user.example.com/graphql",
        scope: USER_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "User Source",
      });

      yield* executor.graphql.removeSource("shared", USER_SCOPE);

      const userView = yield* executor.graphql.getSource("shared", USER_SCOPE);
      const orgView = yield* executor.graphql.getSource("shared", ORG_SCOPE);

      expect(userView).toBeNull();
      expect(orgView?.name).toBe("Org Source");
      expect(orgView?.endpoint).toBe("http://org.example.com/graphql");
    }),
  );

  it.effect("updateSource on user shadow does not mutate the org row", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          scopes: stackedScopes,
          plugins: [graphqlPlugin()] as const,
        }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://org.example.com/graphql",
        scope: ORG_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "Org Source",
      });
      yield* executor.graphql.addSource({
        endpoint: "http://user.example.com/graphql",
        scope: USER_SCOPE,
        introspectionJson,
        namespace: "shared",
        name: "User Source",
      });

      yield* executor.graphql.updateSource("shared", USER_SCOPE, {
        name: "User Renamed",
        endpoint: "http://user-new.example.com/graphql",
      });

      const userView = yield* executor.graphql.getSource("shared", USER_SCOPE);
      const orgView = yield* executor.graphql.getSource("shared", ORG_SCOPE);

      expect(userView?.name).toBe("User Renamed");
      expect(userView?.endpoint).toBe("http://user-new.example.com/graphql");
      expect(orgView?.name).toBe("Org Source");
      expect(orgView?.endpoint).toBe("http://org.example.com/graphql");
    }),
  );

  // -------------------------------------------------------------------------
  // Usage tracking — `usagesForSecret` and `usagesForConnection` should
  // surface every reference to a secret/connection across the plugin's
  // normalized child tables, and `secrets.remove` / `connections.remove`
  // should refuse while a reference exists.
  // -------------------------------------------------------------------------

  it.effect("usagesForSecret returns one Usage per header/query_param ref", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [makeMemorySecretsPlugin()(), graphqlPlugin()] as const,
        }),
      );

      yield* executor.secrets.set({
        id: SecretId.make("api-key"),
        scope: ScopeId.make(TEST_SCOPE),
        name: "API Key",
        value: "abc123",
        provider: "memory",
      });

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: TEST_SCOPE,
        introspectionJson,
        namespace: "with_secret",
        headers: {
          Authorization: { secretId: "api-key", prefix: "Bearer " },
        },
        queryParams: { token: { secretId: "api-key" } },
      });

      const usages = yield* executor.secrets.usages(SecretId.make("api-key"));
      // Two refs: one header, one query param.
      expect(usages.length).toBe(2);
      const slots = usages.map((u) => u.slot).sort();
      expect(slots).toEqual(["header:Authorization", "query_param:token"]);
      expect(usages.every((u) => u.pluginId === "graphql")).toBe(true);
      expect(usages.every((u) => u.ownerId === "with_secret")).toBe(true);
    }),
  );

  it.effect("secrets.remove refuses while a graphql source still uses it", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [makeMemorySecretsPlugin()(), graphqlPlugin()] as const,
        }),
      );

      yield* executor.secrets.set({
        id: SecretId.make("locked"),
        scope: ScopeId.make(TEST_SCOPE),
        name: "Locked",
        value: "v",
        provider: "memory",
      });

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: TEST_SCOPE,
        introspectionJson,
        namespace: "ref",
        headers: { "X-Token": { secretId: "locked" } },
      });

      const result = yield* executor.secrets.remove(SecretId.make("locked")).pipe(
        Effect.as("removed"),
        Effect.catchTag("SecretInUseError", () => Effect.succeed("SecretInUseError" as const)),
      );
      expect(result).toBe("SecretInUseError");

      // After detaching the source, remove succeeds.
      yield* executor.graphql.removeSource("ref", TEST_SCOPE);
      yield* executor.secrets.remove(SecretId.make("locked"));
    }),
  );

  it.effect("usagesForConnection returns one Usage per source", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [makeMemorySecretsPlugin()(), graphqlPlugin()] as const,
        }),
      );

      const connectionId = ConnectionId.make("graphql-conn");
      yield* executor.connections.create(
        new CreateConnectionInput({
          id: connectionId,
          scope: ScopeId.make(TEST_SCOPE),
          provider: "oauth2",
          identityLabel: "Conn",
          accessToken: new TokenMaterial({
            secretId: SecretId.make(`${connectionId}.access_token`),
            name: "Access Token",
            value: "tok",
          }),
          refreshToken: null,
          expiresAt: null,
          oauthScope: null,
          providerState: null,
        }),
      );

      yield* executor.graphql.addSource({
        endpoint: "http://localhost:4000/graphql",
        scope: TEST_SCOPE,
        introspectionJson,
        namespace: "oauth_ref",
        auth: { kind: "oauth2", connectionId },
      });

      const usages = yield* executor.connections.usages(connectionId);
      expect(usages.length).toBe(1);
      expect(usages[0]).toMatchObject({
        pluginId: "graphql",
        ownerKind: "graphql-source-auth",
        ownerId: "oauth_ref",
        slot: "auth.oauth2",
      });
    }),
  );
});

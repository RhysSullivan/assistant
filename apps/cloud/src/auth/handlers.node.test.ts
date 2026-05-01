import { HttpApiBuilder, HttpApi } from "effect/unstable/httpapi";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Effect as EffectType } from "effect/Effect";

import { CloudAuthPublicApi } from "./api";
import { CloudAuthPublicHandlers } from "./handlers";
import { UserStoreService } from "./context";
import { WorkOSAuth } from "./workos";

const TestAuthPublicApi = HttpApi.make("cloudWeb").add(CloudAuthPublicApi);
type EffectSuccess<T> = T extends EffectType<infer A, infer _E, infer _R> ? A : never;
type AuthenticateWithCodeResult = EffectSuccess<
  ReturnType<WorkOSAuth["Service"]["authenticateWithCode"]>
>;
const fakeUser: AuthenticateWithCodeResult["user"] = {
  object: "user",
  id: "user_1",
  email: "test@example.com",
  emailVerified: true,
  profilePictureUrl: null,
  firstName: null,
  lastName: null,
  lastSignInAt: null,
  locale: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  externalId: null,
  metadata: {},
};

const makeAuthFetch = (workos: Partial<WorkOSAuth["Service"]>) => {
  const WorkOSTest = Layer.succeed(
    WorkOSAuth,
    new Proxy(workos as WorkOSAuth["Service"], {
      get: (target, prop) => {
        if (prop in target) return target[prop as keyof typeof target];
        return () => {
          throw new Error(`WorkOSAuth.${String(prop)} not stubbed`);
        };
      },
    }),
  );
  const UserStoreTest = Layer.succeed(UserStoreService)({
    use: <A>() => Effect.sync(() => undefined as A),
  });
  const apiLayer = HttpApiBuilder.layer(TestAuthPublicApi).pipe(
    Layer.provide(CloudAuthPublicHandlers),
    Layer.provideMerge(WorkOSTest),
    Layer.provideMerge(UserStoreTest),
    Layer.provideMerge(HttpServer.layerServices),
    Layer.provideMerge(Layer.succeed(HttpRouter.RouterConfig)({ maxParamLength: 1000 })),
  );
  const web = HttpRouter.toWebHandler(apiLayer, { disableLogger: true });
  return web.handler as (request: Request) => Promise<Response>;
};

describe("Auth callback handlers", () => {
  it.effect("routes login", () =>
    Effect.gen(function* () {
      let observedState: string | undefined;
      const fetch = makeAuthFetch({
        getAuthorizationUrl: (_redirectUri: string, state?: string) => {
          observedState = state;
          return `https://auth.example.test?state=${state}`;
        },
      });
      const response = yield* Effect.promise(() =>
        fetch(new Request("http://test.local/auth/login")),
      );
      expect(response.status).toBe(302);
      expect(observedState).toMatch(/^[0-9a-f]{64}$/);
      expect(response.headers.get("location")).toBe(
        `https://auth.example.test?state=${observedState}`,
      );
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`wos-login-state=${observedState}`);
      expect(setCookie).toContain("Max-Age=600");
    }),
  );

  it.effect("rejects callback state without the matching login state cookie", () =>
    Effect.gen(function* () {
      let authenticateCalls = 0;
      const fetch = makeAuthFetch({
        authenticateWithCode: () =>
          Effect.sync(() => {
            authenticateCalls++;
            const result: AuthenticateWithCodeResult = {
              user: fakeUser,
              accessToken: "access_token",
              refreshToken: "refresh_token",
              sealedSession: "sealed_session",
            };
            return result;
          }),
      });

      const response = yield* Effect.promise(() =>
        fetch(
          new Request("http://test.local/auth/callback?code=attacker-code&state=attacker-state"),
        ),
      );

      expect(response.status).toBe(400);
      expect(authenticateCalls).toBe(0);
    }),
  );

  it.effect("sets the session cookie and clears login state on matching callback state", () =>
    Effect.gen(function* () {
      const fetch = makeAuthFetch({
        authenticateWithCode: () =>
          Effect.succeed({
            user: fakeUser,
            accessToken: "access_token",
            refreshToken: "refresh_token",
            organizationId: "org_1",
            sealedSession: "sealed_session",
          } satisfies AuthenticateWithCodeResult),
      });

      const response = yield* Effect.promise(() =>
        fetch(
          new Request("http://test.local/auth/callback?code=code&state=state_1", {
            headers: { cookie: "wos-login-state=state_1" },
          }),
        ),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("wos-session=sealed_session");
      expect(setCookie).toContain("Max-Age=604800");
      expect(setCookie).toContain("wos-login-state=");
      expect(setCookie).toContain("Max-Age=0");
    }),
  );
});

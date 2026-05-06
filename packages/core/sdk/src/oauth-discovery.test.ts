import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Ref, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import {
  OAuthDiscoveryError,
  beginDynamicAuthorization,
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  registerDynamicClient,
} from "./oauth-discovery";
import { serveTestHttpApp } from "./testing";

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type Handler = (request: CapturedRequest, baseUrl: string) => HttpServerResponse.HttpServerResponse;

const DcrRequestBody = Schema.Struct({
  redirect_uris: Schema.Array(Schema.String),
  token_endpoint_auth_method: Schema.String,
  scope: Schema.optional(Schema.String),
});
const decodeDcrRequestBody = Schema.decodeUnknownSync(Schema.fromJsonString(DcrRequestBody));

const sendJson = (body: unknown, status = 200): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(body, { status });

const notFound = (): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.empty({ status: 404 });

const serveOAuthFixture = (handler: Handler) =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<readonly CapturedRequest[]>([]);
    const baseUrlRef = { value: "" };
    const server = yield* serveTestHttpApp((request) =>
      Effect.gen(function* () {
        const body = yield* request.text;
        const captured = {
          method: request.method,
          url: request.url ?? "/",
          headers: request.headers,
          body,
        };
        yield* Ref.update(requests, (all) => [...all, captured]);
        return handler(captured, baseUrlRef.value);
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("oauth fixture failed", { status: 500 })),
        ),
      ),
    );
    baseUrlRef.value = server.baseUrl;

    return {
      baseUrl: baseUrlRef.value,
      requests: Ref.get(requests),
    } as const;
  });

const withOAuthFixture = <A, E>(
  handler: Handler,
  use: (fixture: {
    readonly baseUrl: string;
    readonly requests: Effect.Effect<readonly CapturedRequest[]>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* serveOAuthFixture(handler);
      return yield* use(fixture);
    }),
  );

describe("discoverProtectedResourceMetadata", () => {
  it.effect("fetches RFC 9728 well-known metadata on the resource's origin", () =>
    withOAuthFixture(
      (request, baseUrl) => {
        if (request.url === "/.well-known/oauth-protected-resource/graphql") {
          return notFound();
        }
        if (request.url === "/.well-known/oauth-protected-resource") {
          return sendJson({
            resource: baseUrl,
            authorization_servers: [baseUrl],
            scopes_supported: ["read"],
          });
        }
        return notFound();
      },
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const result = yield* discoverProtectedResourceMetadata(`${baseUrl}/graphql`);
          expect(result).not.toBeNull();
          expect(result!.metadata.authorization_servers?.[0]).toBe(baseUrl);
          expect(result!.metadataUrl).toBe(`${baseUrl}/.well-known/oauth-protected-resource`);
        }),
    ),
  );

  it.effect("returns null when every well-known candidate 404s", () =>
    withOAuthFixture(
      () => notFound(),
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const result = yield* discoverProtectedResourceMetadata(`${baseUrl}/graphql`);
          expect(result).toBeNull();
        }),
    ),
  );

  it.effect("surfaces malformed metadata bodies as OAuthDiscoveryError", () =>
    withOAuthFixture(
      () => HttpServerResponse.text("not json", { status: 200, contentType: "application/json" }),
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(discoverProtectedResourceMetadata(baseUrl));
          expect(Exit.isFailure(exit)).toBe(true);
          if (!Exit.isFailure(exit)) return;
          const reason = exit.cause.reasons.find(Cause.isFailReason);
          expect(reason?.error).toBeInstanceOf(OAuthDiscoveryError);
        }),
    ),
  );
});

describe("discoverAuthorizationServerMetadata", () => {
  it.effect("falls back to openid-configuration when oauth-authorization-server is absent", () =>
    withOAuthFixture(
      (request, baseUrl) => {
        if (request.url === "/.well-known/oauth-authorization-server") {
          return notFound();
        }
        if (request.url === "/.well-known/openid-configuration") {
          return sendJson({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            code_challenge_methods_supported: ["S256"],
            response_types_supported: ["code"],
          });
        }
        return notFound();
      },
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const result = yield* discoverAuthorizationServerMetadata(baseUrl);
          expect(result).not.toBeNull();
          expect(result!.metadata.token_endpoint).toBe(`${baseUrl}/token`);
          expect(result!.metadataUrl.endsWith("openid-configuration")).toBe(true);
        }),
    ),
  );

  it.effect("requires issuer + authorize + token endpoints", () =>
    withOAuthFixture(
      () => sendJson({ issuer: "http://127.0.0.1" }),
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(discoverAuthorizationServerMetadata(baseUrl));
          expect(Exit.isFailure(exit)).toBe(true);
        }),
    ),
  );
});

describe("registerDynamicClient", () => {
  it.effect("POSTs RFC 7591 metadata and parses the client information response", () =>
    withOAuthFixture(
      (request) => {
        if (request.url !== "/register") {
          return notFound();
        }
        return sendJson(
          {
            client_id: "generated-client-id",
            client_id_issued_at: 1_700_000_000,
            redirect_uris: ["https://app.example.com/cb"],
            token_endpoint_auth_method: "none",
          },
          201,
        );
      },
      ({ baseUrl, requests }) =>
        Effect.gen(function* () {
          const info = yield* registerDynamicClient({
            registrationEndpoint: `${baseUrl}/register`,
            metadata: {
              redirect_uris: ["https://app.example.com/cb"],
              client_name: "Executor",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
          });
          expect(info.client_id).toBe("generated-client-id");

          const call = (yield* requests)[0]!;
          expect(call.method).toBe("POST");
          const body = decodeDcrRequestBody(call.body);
          expect(body.redirect_uris).toEqual(["https://app.example.com/cb"]);
          expect(body.token_endpoint_auth_method).toBe("none");
        }),
    ),
  );

  it.effect("treats HTTP 200 as success (Todoist-style non-conformance)", () =>
    withOAuthFixture(
      () =>
        sendJson({
          client_id: "tdd_abc",
          redirect_uris: ["https://app.example.com/cb"],
        }),
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const info = yield* registerDynamicClient({
            registrationEndpoint: `${baseUrl}/register`,
            metadata: { redirect_uris: ["https://app.example.com/cb"] },
          });
          expect(info.client_id).toBe("tdd_abc");
        }),
    ),
  );

  it.effect("surfaces AS error responses with the error body", () =>
    withOAuthFixture(
      () =>
        sendJson(
          {
            error: "invalid_client_metadata",
            error_description: "redirect_uris must be https",
          },
          400,
        ),
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            registerDynamicClient({
              registrationEndpoint: `${baseUrl}/register`,
              metadata: { redirect_uris: ["http://localhost/cb"] },
            }),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (!Exit.isFailure(exit)) return;
          const reason = exit.cause.reasons.find(Cause.isFailReason);
          const error = reason?.error;
          expect(error).toEqual(
            expect.objectContaining({
              _tag: "OAuthDiscoveryError",
              status: 400,
              message: expect.stringMatching(/invalid_client_metadata/),
            }),
          );
        }),
    ),
  );
});

describe("beginDynamicAuthorization", () => {
  it.effect("runs the full discovery + DCR + PKCE chain for a Railway-shaped endpoint", () =>
    withOAuthFixture(
      (request, baseUrl) => {
        if (request.url === "/.well-known/oauth-protected-resource/graphql/v2") {
          return notFound();
        }
        if (request.url === "/.well-known/oauth-protected-resource") {
          return sendJson({
            resource: baseUrl,
            authorization_servers: [baseUrl],
            scopes_supported: ["openid", "profile", "email", "offline_access", "workspace:member"],
          });
        }
        if (request.url === "/.well-known/oauth-authorization-server") {
          return sendJson({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/auth`,
            token_endpoint: `${baseUrl}/oauth/token`,
            registration_endpoint: `${baseUrl}/oauth/register`,
            scopes_supported: ["openid", "profile", "email", "offline_access", "workspace:member"],
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          });
        }
        if (request.url === "/oauth/register") {
          return sendJson(
            {
              client_id: "dyn-client-42",
              redirect_uris: ["https://app.example/cb"],
              token_endpoint_auth_method: "none",
            },
            201,
          );
        }
        return notFound();
      },
      ({ baseUrl }) =>
        Effect.gen(function* () {
          const result = yield* beginDynamicAuthorization({
            endpoint: `${baseUrl}/graphql/v2`,
            redirectUrl: "https://app.example/cb",
            state: "state-xyz",
          });

          const url = new URL(result.authorizationUrl);
          expect(url.origin + url.pathname).toBe(`${baseUrl}/oauth/auth`);
          expect(url.searchParams.get("client_id")).toBe("dyn-client-42");
          expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
          expect(url.searchParams.get("response_type")).toBe("code");
          expect(url.searchParams.get("state")).toBe("state-xyz");
          expect(url.searchParams.get("code_challenge_method")).toBe("S256");
          expect(result.state.authorizationServerMetadata.token_endpoint).toBe(
            `${baseUrl}/oauth/token`,
          );
        }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Shared OAuth HTTP handlers — thin forwarders over `executor.oauth.*`.
// Replaces the four per-plugin copies (mcp / openapi / google-discovery
// each had its own start / complete / callback handler).
// ---------------------------------------------------------------------------

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerResponse } from "effect/unstable/http";
import { Effect, Option, Schema } from "effect";

import { runOAuthCallback } from "../oauth-popup";
import {
  OAUTH_POPUP_MESSAGE_TYPE,
  OAuthCompleteError,
  OAuthProbeError,
  OAuthSessionNotFoundError,
  OAuthStartError,
  resolveSecretBackedMap,
  type Executor,
  type OAuthStrategy,
  type SecretBackedValue,
} from "@executor-js/sdk";

import { ExecutorApi } from "../api";
import { capture } from "../observability";
import { ExecutorService } from "../services";

const OAUTH_POPUP_CHANNEL = OAUTH_POPUP_MESSAGE_TYPE;

const resolveOAuthSecretBackedMap = <E extends OAuthProbeError | OAuthStartError>(
  executor: Executor,
  values: Record<string, SecretBackedValue> | undefined,
  makeError: (message: string) => E,
) =>
  resolveSecretBackedMap({
    values,
    getSecret: (secretId) =>
      executor.secrets.get(secretId).pipe(
        Effect.mapError(() => makeError(`Secret resolution failed for "${secretId}"`)),
      ),
    onMissing: (name) => makeError(`Secret not found for "${name}"`),
    onError: (_error, name) => makeError(`Secret not found for "${name}"`),
  });

const toPopupErrorMessage = (error: unknown): string => {
  const startError = Schema.decodeUnknownOption(OAuthStartError)(error);
  if (Option.isSome(startError)) return startError.value.message;

  const completeError = Schema.decodeUnknownOption(OAuthCompleteError)(error);
  if (Option.isSome(completeError)) return completeError.value.message;

  const probeError = Schema.decodeUnknownOption(OAuthProbeError)(error);
  if (Option.isSome(probeError)) return probeError.value.message;

  const sessionNotFoundError = Schema.decodeUnknownOption(OAuthSessionNotFoundError)(error);
  if (Option.isSome(sessionNotFoundError)) {
    return `OAuth session not found: ${sessionNotFoundError.value.sessionId}`;
  }

  return "Authentication failed";
};

export const OAuthHandlers = HttpApiBuilder.group(ExecutorApi, "oauth", (handlers) =>
  handlers
    .handle("probe", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const executor = yield* ExecutorService;
          const headers = yield* resolveOAuthSecretBackedMap(
            executor,
            payload.headers,
            (message) => new OAuthProbeError({ message }),
          );
          const queryParams = yield* resolveOAuthSecretBackedMap(
            executor,
            payload.queryParams,
            (message) => new OAuthProbeError({ message }),
          );
          return yield* executor.oauth.probe({
            endpoint: payload.endpoint,
            headers,
            queryParams,
          });
        }),
      ),
    )
    .handle("start", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const executor = yield* ExecutorService;
          const tokenScope = payload.tokenScope ?? String(executor.scopes[0]!.id);
          const headers = yield* resolveOAuthSecretBackedMap(
            executor,
            payload.headers,
            (message) => new OAuthStartError({ message }),
          );
          const queryParams = yield* resolveOAuthSecretBackedMap(
            executor,
            payload.queryParams,
            (message) => new OAuthStartError({ message }),
          );
          return yield* executor.oauth.start({
            endpoint: payload.endpoint,
            headers,
            queryParams,
            redirectUrl: payload.redirectUrl,
            connectionId: payload.connectionId,
            tokenScope,
            strategy: payload.strategy as OAuthStrategy,
            pluginId: payload.pluginId,
            identityLabel: payload.identityLabel,
          });
        }),
      ),
    )
    .handle("complete", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const executor = yield* ExecutorService;
          return yield* executor.oauth.complete({
            state: payload.state,
            code: payload.code,
            error: payload.error,
          });
        }),
      ),
    )
    .handle("cancel", ({ payload }) =>
      capture(
        Effect.gen(function* () {
          const executor = yield* ExecutorService;
          yield* executor.oauth.cancel(payload.sessionId);
          return { cancelled: true };
        }),
      ),
    )
    .handle("callback", ({ query: urlParams }) =>
      // The callback always renders HTML, even on failure — the popup
      // shows the error + messages it back to the opener.
      capture(
        Effect.gen(function* () {
          const executor = yield* ExecutorService;
          const html = yield* runOAuthCallback({
            complete: ({ state, code, error }) =>
              executor.oauth
                .complete({
                  state,
                  code: code ?? undefined,
                  error: error ?? undefined,
                })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logError("OAuth callback completion failed", cause),
                  ),
                  Effect.catchCause(() =>
                    Effect.fail(new OAuthCompleteError({ message: "Authentication failed" })),
                  ),
                ),
            urlParams,
            toErrorMessage: toPopupErrorMessage,
            channelName: OAUTH_POPUP_CHANNEL,
          });
          return HttpServerResponse.html(html);
        }),
      ),
    ),
);

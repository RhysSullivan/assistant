import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpServerResponse,
} from "@effect/platform";
import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
  type ExecutorHttpApiExtension,
  type ExecutorHttpPlugin,
} from "@executor/platform-api";
import { resolveRequestedLocalWorkspace } from "@executor/platform-api/local-context";
import {
  ScopeIdSchema,
  SourceIdSchema,
  SourceSchema,
  type Source,
} from "@executor/platform-sdk/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  GoogleDiscoveryConnectInputSchema,
  GoogleDiscoveryOAuthPopupResultSchema,
  GoogleDiscoverySourceConfigPayloadSchema,
  GoogleDiscoveryStartOAuthInputSchema,
  GoogleDiscoveryStartOAuthResultSchema,
  type GoogleDiscoveryConnectInput,
  type GoogleDiscoveryOAuthPopupResult,
  type GoogleDiscoverySourceConfigPayload,
  type GoogleDiscoveryStartOAuthInput,
  type GoogleDiscoveryStartOAuthResult,
  type GoogleDiscoveryUpdateSourceInput,
} from "@executor/plugin-google-discovery-shared";

type GoogleDiscoveryExecutorExtension = {
  googleDiscovery: {
    createSource: (
      input: GoogleDiscoveryConnectInput,
    ) => Effect.Effect<Source, Error>;
    getSourceConfig: (
      sourceId: Source["id"],
    ) => Effect.Effect<GoogleDiscoverySourceConfigPayload, Error>;
    updateSource: (
      input: GoogleDiscoveryUpdateSourceInput,
    ) => Effect.Effect<Source, Error>;
    removeSource: (
      sourceId: Source["id"],
    ) => Effect.Effect<boolean, Error>;
    startOAuth: (
      input: GoogleDiscoveryStartOAuthInput,
    ) => Effect.Effect<GoogleDiscoveryStartOAuthResult, Error>;
    completeOAuth: (input: {
      state: string;
      code?: string;
      error?: string;
      errorDescription?: string;
    }) => Effect.Effect<Extract<GoogleDiscoveryOAuthPopupResult, { ok: true }>, Error>;
  };
};

const workspaceIdParam = HttpApiSchema.param("workspaceId", ScopeIdSchema);
const sourceIdParam = HttpApiSchema.param("sourceId", SourceIdSchema);
const htmlSchema = HttpApiSchema.Text({
  contentType: "text/html",
});

const callbackParamsSchema = Schema.Struct({
  state: Schema.String,
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

export const GoogleDiscoveryHttpGroup = HttpApiGroup.make("googleDiscovery")
  .add(
    HttpApiEndpoint.post("createSource")`/workspaces/${workspaceIdParam}/plugins/google-discovery/sources`
      .setPayload(GoogleDiscoveryConnectInputSchema)
      .addSuccess(SourceSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("getSourceConfig")`/workspaces/${workspaceIdParam}/plugins/google-discovery/sources/${sourceIdParam}`
      .addSuccess(GoogleDiscoverySourceConfigPayloadSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.put("updateSource")`/workspaces/${workspaceIdParam}/plugins/google-discovery/sources/${sourceIdParam}`
      .setPayload(GoogleDiscoverySourceConfigPayloadSchema)
      .addSuccess(SourceSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.del("removeSource")`/workspaces/${workspaceIdParam}/plugins/google-discovery/sources/${sourceIdParam}`
      .addSuccess(Schema.Struct({ removed: Schema.Boolean }))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("startOAuth")`/workspaces/${workspaceIdParam}/plugins/google-discovery/oauth/start`
      .setPayload(GoogleDiscoveryStartOAuthInputSchema)
      .addSuccess(GoogleDiscoveryStartOAuthResultSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("oauthCallback")`/plugins/google-discovery/oauth/callback`
      .setUrlParams(callbackParamsSchema)
      .addSuccess(htmlSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1");

export const googleDiscoveryHttpApiExtension = {
  key: "googleDiscovery",
  group: GoogleDiscoveryHttpGroup,
} satisfies ExecutorHttpApiExtension<typeof GoogleDiscoveryHttpGroup>;

const GoogleDiscoveryHttpApi = HttpApi.make("executor").add(GoogleDiscoveryHttpGroup);

const toBadRequestError = (operation: string, cause: unknown) =>
  new ControlPlaneBadRequestError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    details: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
  });

const toStorageError = (operation: string, cause: unknown) =>
  new ControlPlaneStorageError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    details: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
  });

const toNotFoundError = (operation: string, cause: unknown) =>
  new ControlPlaneNotFoundError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    details: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
  });

const mapPluginStorageError = (operation: string, cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("not found") || message.includes("Not found")) {
    return toNotFoundError(operation, cause);
  }

  return toStorageError(operation, cause);
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const popupDocument = (payload: GoogleDiscoveryOAuthPopupResult): string => {
  const serialized = JSON.stringify(payload)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  const title = payload.ok ? "Google OAuth connected" : "Google OAuth failed";
  const message = payload.ok
    ? "Google credentials are ready. Return to the source form to finish saving."
    : payload.error;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
    <script>
      (() => {
        const payload = ${serialized};
        try {
          window.localStorage.setItem("executor:google-discovery-oauth:" + (payload.ok ? payload.sessionId : "failed"), JSON.stringify(payload));
        } catch {}
        try {
          if (window.opener) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } finally {
          window.setTimeout(() => window.close(), 120);
        }
      })();
    </script>
  </body>
</html>`;
};

export const googleDiscoveryHttpPlugin = (): ExecutorHttpPlugin<
  typeof GoogleDiscoveryHttpGroup,
  GoogleDiscoveryExecutorExtension
> => ({
  key: "googleDiscovery",
  group: GoogleDiscoveryHttpGroup,
  build: ({ executor }) =>
    HttpApiBuilder.group(GoogleDiscoveryHttpApi, "googleDiscovery", (handlers) =>
      handlers
        .handle("createSource", ({ path, payload }) =>
          resolveRequestedLocalWorkspace(
            "googleDiscovery.createSource",
            path.workspaceId,
          ).pipe(
            Effect.flatMap(() => executor.googleDiscovery.createSource(payload)),
            Effect.mapError((cause) =>
              toStorageError("googleDiscovery.createSource", cause)
            ),
          )
        )
        .handle("getSourceConfig", ({ path }) =>
          resolveRequestedLocalWorkspace(
            "googleDiscovery.getSourceConfig",
            path.workspaceId,
          ).pipe(
            Effect.flatMap(() =>
              executor.googleDiscovery.getSourceConfig(path.sourceId)
            ),
            Effect.mapError((cause) =>
              mapPluginStorageError("googleDiscovery.getSourceConfig", cause)
            ),
          )
        )
        .handle("updateSource", ({ path, payload }) =>
          resolveRequestedLocalWorkspace(
            "googleDiscovery.updateSource",
            path.workspaceId,
          ).pipe(
            Effect.flatMap(() =>
              executor.googleDiscovery.updateSource({
                sourceId: path.sourceId,
                config: payload,
              })
            ),
            Effect.mapError((cause) =>
              mapPluginStorageError("googleDiscovery.updateSource", cause)
            ),
          )
        )
        .handle("removeSource", ({ path }) =>
          resolveRequestedLocalWorkspace(
            "googleDiscovery.removeSource",
            path.workspaceId,
          ).pipe(
            Effect.flatMap(() =>
              executor.googleDiscovery.removeSource(path.sourceId)
            ),
            Effect.map((removed) => ({ removed })),
            Effect.mapError((cause) =>
              mapPluginStorageError("googleDiscovery.removeSource", cause)
            ),
          )
        )
        .handle("startOAuth", ({ path, payload }) =>
          resolveRequestedLocalWorkspace(
            "googleDiscovery.startOAuth",
            path.workspaceId,
          ).pipe(
            Effect.flatMap(() => executor.googleDiscovery.startOAuth(payload)),
            Effect.mapError((cause) =>
              toStorageError("googleDiscovery.startOAuth", cause)
            ),
          )
        )
        .handle("oauthCallback", ({ urlParams }) =>
          executor.googleDiscovery.completeOAuth({
            state: urlParams.state,
            code: urlParams.code,
            error: urlParams.error,
            errorDescription: urlParams.error_description,
          }).pipe(
            Effect.map((payload) => popupDocument(payload)),
            Effect.mapError((cause) =>
              toStorageError("googleDiscovery.oauthCallback", cause)
            ),
            Effect.catchAll((error) =>
              Effect.succeed(
                popupDocument({
                  type: "executor:oauth-result",
                  ok: false,
                  sessionId: null,
                  error: error.message,
                }),
              )
            ),
            Effect.flatMap((html) => HttpServerResponse.html(html)),
          )
        )
    ),
});

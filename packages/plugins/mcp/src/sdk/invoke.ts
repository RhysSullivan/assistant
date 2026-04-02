// ---------------------------------------------------------------------------
// MCP tool invoker — bridges the binding store + MCP client into SDK invoker
// ---------------------------------------------------------------------------

import { Effect, Schema } from "effect";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  type ToolId,
  type ToolInvoker,
  ToolInvocationResult,
  ToolInvocationError,
  ToolAnnotations,
  ElicitationResponse,
  FormElicitation,
  UrlElicitation,
  type ElicitationHandler,
  type ElicitationRequest,
  type ScopeId,
  type SecretId,
  type InvokeOptions,
} from "@executor/sdk";

import type { McpBindingStore } from "./binding-store";
import type { McpStoredSourceData } from "./types";
import { McpConnectionError } from "./errors";
import {
  createMcpConnector,
  type McpConnection,
  type ConnectorInput,
} from "./connection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type Secrets = {
  readonly resolve: (
    secretId: SecretId,
    scopeId: ScopeId,
  ) => Effect.Effect<string, unknown>;
};

const makeOAuthProvider = (
  accessToken: string,
  tokenType: string,
  refreshToken?: string,
): OAuthClientProvider => ({
  get redirectUrl() { return "http://localhost/oauth/callback"; },
  get clientMetadata() {
    return {
      redirect_uris: ["http://localhost/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none" as const,
      client_name: "Executor",
    };
  },
  clientInformation: () => undefined,
  saveClientInformation: () => {},
  tokens: async (): Promise<OAuthTokens> => ({
    access_token: accessToken,
    token_type: tokenType,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  }),
  saveTokens: async () => {},
  redirectToAuthorization: async () => {
    throw new Error("MCP OAuth re-authorization required");
  },
  saveCodeVerifier: () => {},
  codeVerifier: () => { throw new Error("No active PKCE verifier"); },
  saveDiscoveryState: () => {},
  discoveryState: () => undefined,
});

// ---------------------------------------------------------------------------
// Elicitation bridge — MCP elicit request ↔ SDK ElicitationHandler
// ---------------------------------------------------------------------------

const McpFormElicitParams = Schema.Struct({
  mode: Schema.optional(Schema.Literal("form")),
  message: Schema.String,
  requestedSchema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const McpUrlElicitParams = Schema.Struct({
  mode: Schema.Literal("url"),
  message: Schema.String,
  url: Schema.String,
  elicitationId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
});

const McpElicitParams = Schema.Union(McpUrlElicitParams, McpFormElicitParams);
type McpElicitParams = typeof McpElicitParams.Type;

const decodeElicitParams = Schema.decodeUnknownSync(McpElicitParams);

const toElicitationRequest = (params: McpElicitParams): ElicitationRequest =>
  params.mode === "url"
    ? new UrlElicitation({
        message: params.message,
        url: params.url,
        elicitationId: params.elicitationId ?? params.id ?? "",
      })
    : new FormElicitation({
        message: params.message,
        requestedSchema: params.requestedSchema,
      });

const installElicitationHandler = (
  client: McpConnection["client"],
  toolId: ToolId,
  args: unknown,
  handler: ElicitationHandler,
): void => {
  client.setRequestHandler(
    ElicitRequestSchema,
    async (request: { params: unknown }) => {
    const params = decodeElicitParams(request.params);
    const response = await Effect.runPromise(
      handler({ toolId, args, request: toElicitationRequest(params) }),
    );

    return {
      action: response.action,
      ...(response.action === "accept" && response.content
        ? { content: response.content }
        : {}),
    };
  });
};

// ---------------------------------------------------------------------------
// Resolve ConnectorInput from stored source data
// ---------------------------------------------------------------------------

const resolveConnectorInput = (
  sourceData: McpStoredSourceData,
  secrets: Secrets,
  scopeId: ScopeId,
): Effect.Effect<ConnectorInput, ToolInvocationError> => {
  if (sourceData.transport === "stdio") {
    return Effect.succeed({
      transport: "stdio" as const,
      command: sourceData.command,
      args: sourceData.args,
      env: sourceData.env,
      cwd: sourceData.cwd,
    });
  }

  return Effect.gen(function* () {
    const headers: Record<string, string> = { ...(sourceData.headers ?? {}) };
    let authProvider: OAuthClientProvider | undefined;

    const auth = sourceData.auth;
    if (auth.kind === "header") {
      const secretValue = yield* secrets
        .resolve(auth.secretId as SecretId, scopeId)
        .pipe(
          Effect.mapError(
            () =>
              new ToolInvocationError({
                toolId: "" as ToolId,
                message: `Failed to resolve secret "${auth.secretId}" for MCP auth`,
                cause: undefined,
              }),
          ),
        );
      headers[auth.headerName] = auth.prefix
        ? `${auth.prefix}${secretValue}`
        : secretValue;
    } else if (auth.kind === "oauth2") {
      const accessToken = yield* secrets
        .resolve(auth.accessTokenSecretId as SecretId, scopeId)
        .pipe(
          Effect.mapError(
            () =>
              new ToolInvocationError({
                toolId: "" as ToolId,
                message: "Failed to resolve OAuth access token for MCP auth",
                cause: undefined,
              }),
          ),
        );

      let refreshToken: string | undefined;
      if (auth.refreshTokenSecretId) {
        refreshToken = yield* secrets
          .resolve(auth.refreshTokenSecretId as SecretId, scopeId)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed(undefined as string | undefined),
            ),
          );
      }

      authProvider = makeOAuthProvider(
        accessToken,
        auth.tokenType ?? "Bearer",
        refreshToken,
      );
    }

    return {
      transport: "remote" as const,
      endpoint: sourceData.endpoint,
      remoteTransport: sourceData.remoteTransport,
      queryParams: sourceData.queryParams,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      authProvider,
    };
  });
};

/** Execute a single MCP tool call */
const callMcpTool = (
  connection: McpConnection,
  toolName: string,
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolInvocationError> =>
  Effect.tryPromise({
    try: () =>
      connection.client.callTool({ name: toolName, arguments: args }),
    catch: (cause) =>
      new ToolInvocationError({
        toolId: "" as ToolId,
        message: `MCP tool call failed for ${toolName}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      }),
  });

// ---------------------------------------------------------------------------
// Resolve elicitation handler from options
// ---------------------------------------------------------------------------

const resolveElicitationHandler = (
  options: InvokeOptions,
): ElicitationHandler =>
  options.onElicitation === "accept-all"
    ? () => Effect.succeed(new ElicitationResponse({ action: "accept" }))
    : options.onElicitation;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const makeMcpInvoker = (opts: {
  readonly bindingStore: McpBindingStore;
  readonly secrets: Secrets;
  readonly scopeId: ScopeId;
}): ToolInvoker => ({
  resolveAnnotations: () =>
    Effect.succeed(
      new ToolAnnotations({
        requiresApproval: false,
      }),
    ),

  invoke: (toolId: ToolId, args: unknown, options: InvokeOptions) =>
    Effect.gen(function* () {
      const entry = yield* opts.bindingStore.get(toolId);
      if (!entry) {
        return yield* new ToolInvocationError({
          toolId,
          message: `No MCP binding found for tool "${toolId}"`,
          cause: undefined,
        });
      }

      const { binding, sourceData } = entry;

      const connector = Effect.gen(function* () {
        const ci = yield* resolveConnectorInput(sourceData, opts.secrets, opts.scopeId);
        return yield* createMcpConnector(ci);
      }).pipe(
        Effect.mapError((err) =>
          new McpConnectionError({
            transport: "auto",
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );

      const connection = yield* connector.pipe(
        Effect.mapError(
          (err) =>
            new ToolInvocationError({
              toolId,
              message: `Failed connecting to MCP server: ${err.message}`,
              cause: err,
            }),
        ),
      );

      // Install elicitation handler before calling the tool
      const elicitationHandler = resolveElicitationHandler(options);
      installElicitationHandler(
        connection.client,
        toolId,
        args,
        elicitationHandler,
      );

      const result = yield* callMcpTool(
        connection,
        binding.toolName,
        asRecord(args),
      );

      yield* Effect.promise(() => connection.close().catch(() => {}));

      const resultRecord = asRecord(result);
      const isError = resultRecord.isError === true;

      return new ToolInvocationResult({
        data: isError ? null : (result ?? null),
        error: isError ? result : null,
      });
    }).pipe(
      Effect.catchAll((err) => {
        if (
          typeof err === "object" &&
          err !== null &&
          "_tag" in err &&
          (err as { _tag: string })._tag === "ToolInvocationError"
        ) {
          return Effect.fail(err as ToolInvocationError);
        }
        return Effect.fail(
          new ToolInvocationError({
            toolId,
            message: `MCP invocation failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            cause: err,
          }),
        );
      }),
    ),
});

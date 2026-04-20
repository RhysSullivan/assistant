import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Remote transport type
// ---------------------------------------------------------------------------

export const McpRemoteTransport = Schema.Literal("streamable-http", "sse", "auto");
export type McpRemoteTransport = typeof McpRemoteTransport.Type;

/** All transport types (used in the connector layer) */
export const McpTransport = Schema.Literal("streamable-http", "sse", "stdio", "auto");
export type McpTransport = typeof McpTransport.Type;

// ---------------------------------------------------------------------------
// Connection auth (only applies to remote sources)
// ---------------------------------------------------------------------------

/** JSON object loosely typed — used for opaque OAuth state we just round-trip. */
const JsonObject = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const McpConnectionAuth = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("header"),
    headerName: Schema.String,
    secretId: Schema.String,
    prefix: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth2"),
    accessTokenSecretId: Schema.String,
    refreshTokenSecretId: Schema.NullOr(Schema.String),
    tokenType: Schema.optionalWith(Schema.String, { default: () => "Bearer" }),
    expiresAt: Schema.NullOr(Schema.Number),
    scope: Schema.NullOr(Schema.String),
    /**
     * Source-level OAuth state shared by every user. Lives on the
     * source row (org scope) so DCR runs once per source instead of
     * once per user, and so refresh can use the same client_id the
     * upstream auth server originally registered.
     *
     * - `clientInformation`: DCR-issued client credentials (client_id,
     *   optional client_secret). When present, no DCR happens on
     *   subsequent OAuth flows or refreshes.
     * - `authorizationServerUrl` / `resourceMetadataUrl`: discovery
     *   URLs captured at first OAuth so refreshes don't re-discover.
     */
    clientInformation: Schema.optionalWith(Schema.NullOr(JsonObject), {
      default: () => null,
    }),
    authorizationServerUrl: Schema.optionalWith(Schema.NullOr(Schema.String), {
      default: () => null,
    }),
    resourceMetadataUrl: Schema.optionalWith(Schema.NullOr(Schema.String), {
      default: () => null,
    }),
  }),
);
export type McpConnectionAuth = typeof McpConnectionAuth.Type;

// ---------------------------------------------------------------------------
// Stored source data — discriminated union on transport
// ---------------------------------------------------------------------------

/** Common fields for remote string map schemas */
const StringMap = Schema.Record({ key: Schema.String, value: Schema.String });

export const McpRemoteSourceData = Schema.Struct({
  transport: Schema.Literal("remote"),
  /** The MCP server endpoint URL */
  endpoint: Schema.String,
  /** Transport preference for this remote source */
  remoteTransport: Schema.optionalWith(McpRemoteTransport, { default: () => "auto" as const }),
  /** Extra query params appended to the endpoint URL */
  queryParams: Schema.optional(StringMap),
  /** Extra headers sent on every request */
  headers: Schema.optional(StringMap),
  /** Auth configuration */
  auth: McpConnectionAuth,
});
export type McpRemoteSourceData = typeof McpRemoteSourceData.Type;

export const McpStdioSourceData = Schema.Struct({
  transport: Schema.Literal("stdio"),
  /** The command to run */
  command: Schema.String,
  /** Arguments to the command */
  args: Schema.optional(Schema.Array(Schema.String)),
  /** Environment variables */
  env: Schema.optional(StringMap),
  /** Working directory */
  cwd: Schema.optional(Schema.String),
});
export type McpStdioSourceData = typeof McpStdioSourceData.Type;

export const McpStoredSourceData = Schema.Union(McpRemoteSourceData, McpStdioSourceData);
export type McpStoredSourceData = typeof McpStoredSourceData.Type;

// ---------------------------------------------------------------------------
// Tool binding — maps a registered ToolId back to the MCP tool name
// ---------------------------------------------------------------------------

export class McpToolBinding extends Schema.Class<McpToolBinding>("McpToolBinding")({
  toolId: Schema.String,
  toolName: Schema.String,
  description: Schema.NullOr(Schema.String),
  inputSchema: Schema.optional(Schema.Unknown),
  outputSchema: Schema.optional(Schema.Unknown),
}) {}

// ---------------------------------------------------------------------------
// Annotation policy — per-source override for whether MCP tool calls from
// this source require approval. MCP tools default to no approval because
// servers handle elicitation mid-invocation; flipping this to `true`
// reintroduces a pre-call gate for every tool from the source.
// ---------------------------------------------------------------------------

export class AnnotationPolicy extends Schema.Class<AnnotationPolicy>(
  "McpAnnotationPolicy",
)({
  requireApprovalForAll: Schema.optional(Schema.Boolean),
}) {}

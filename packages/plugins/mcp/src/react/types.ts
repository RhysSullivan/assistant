// ---------------------------------------------------------------------------
// Shared types + constants for MCP react components (Add/Edit flows).
//
// Keeping these in one place lets both Add and Edit use the same OAuth
// popup channel + popup name, and keeps the OAuth tokens shape in sync.
// ---------------------------------------------------------------------------

/**
 * Result of a successful OAuth flow for an MCP source — the shape the
 * popup posts back via `@executor/plugin-oauth2/react#openOAuthPopup` and
 * the shape we hand to the `addMcpSource` / `updateMcpSource` mutations.
 */
export type McpOAuthTokens = {
  readonly accessTokenSecretId: string;
  readonly refreshTokenSecretId: string | null;
  readonly tokenType: string;
  readonly expiresAt: number | null;
  readonly scope: string | null;
};

/** BroadcastChannel name used by the MCP OAuth popup to post back. */
export const MCP_OAUTH_CHANNEL = "executor:mcp-oauth-result";

/** `window.open` popup target name for MCP OAuth popups. */
export const MCP_OAUTH_POPUP_NAME = "mcp-oauth";

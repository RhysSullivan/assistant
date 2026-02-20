import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { handleMcpRequest, type McpWorkspaceContext } from "../../../core/src/mcp-server";
import { isMcpApiKeyConfigured, verifyMcpApiKey } from "../../src/auth/mcp_api_key";
import {
  getMcpAuthConfig,
  MCP_ANONYMOUS_PATH,
  parseMcpContext,
  unauthorizedMcpResponse,
  verifyMcpToken,
} from "./mcp_auth";
import { createMcpExecutorService } from "./mcp_service";
import { enforceMcpRateLimit } from "./rate_limit";

type McpEndpointMode = "default" | "anonymous";

function parseMcpApiKey(request: Request): string | null {
  const fromHeader = request.headers.get("x-api-key")?.trim();
  if (fromHeader) {
    return fromHeader;
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    const bearer = authorization.slice("Bearer ".length).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }

  return null;
}

function createMcpHandler(mode: McpEndpointMode) {
  return httpAction(async (ctx, request) => {
    const rateLimit = await enforceMcpRateLimit(ctx, request);
    if (rateLimit) {
      return rateLimit;
    }

    const url = new URL(request.url);
    const mcpAuthConfig = getMcpAuthConfig();
    const requestedContext = parseMcpContext(url);

    let context: McpWorkspaceContext | undefined;

    if (mode === "anonymous") {
      try {
        const workspaceId = requestedContext?.workspaceId;
        if (!workspaceId) {
          return Response.json(
            { error: `workspaceId query parameter is required for ${MCP_ANONYMOUS_PATH}` },
            { status: 400 },
          );
        }

        if (!isMcpApiKeyConfigured()) {
          return Response.json(
            { error: "MCP API key signing is not configured" },
            { status: 503 },
          );
        }

        const apiKey = parseMcpApiKey(request);
        if (!apiKey) {
          return Response.json(
            { error: `API key is required for ${MCP_ANONYMOUS_PATH}` },
            { status: 401 },
          );
        }

        const apiKeyIdentity = await verifyMcpApiKey(apiKey);
        if (!apiKeyIdentity) {
          return Response.json(
            { error: "Invalid API key" },
            { status: 401 },
          );
        }

        if (apiKeyIdentity.workspaceId !== workspaceId) {
          return Response.json(
            { error: "API key does not match requested workspace" },
            { status: 403 },
          );
        }

        const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForAccount, {
          workspaceId,
          accountId: apiKeyIdentity.accountId,
        });

        if (access.provider !== "anonymous") {
          return Response.json(
            { error: "API key auth is currently enabled for anonymous accounts only" },
            { status: 403 },
          );
        }

        context = {
          workspaceId,
          accountId: access.accountId,
          clientId: "mcp",
        };
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Workspace authorization failed" },
          { status: 403 },
        );
      }
    } else {
      if (!mcpAuthConfig.enabled) {
        const detail = mcpAuthConfig.required
          ? "MCP OAuth must be configured for cloud deployments"
          : "MCP OAuth is not configured";
        return Response.json(
          { error: detail },
          { status: 503 },
        );
      }

      const auth = await verifyMcpToken(ctx, request, mcpAuthConfig);
      if (!auth) {
        return unauthorizedMcpResponse(request, "No valid bearer token provided.");
      }

      if (!requestedContext?.workspaceId) {
        return Response.json(
          { error: "workspaceId query parameter is required when MCP OAuth is enabled" },
          { status: 400 },
        );
      }

      try {
        const workspaceId = requestedContext.workspaceId;
        const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForWorkosSubject, {
          workspaceId,
          subject: auth.subject,
        });

        context = {
          workspaceId,
          accountId: access.accountId,
          clientId: "mcp",
        };
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Workspace authorization failed" },
          { status: 403 },
        );
      }
    }

    const service = createMcpExecutorService(ctx);
    return await handleMcpRequest(service, request, context);
  });
}

export const mcpHandler = createMcpHandler("default");
export const mcpAnonymousHandler = createMcpHandler("anonymous");

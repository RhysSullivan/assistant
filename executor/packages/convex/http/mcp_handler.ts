import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { handleMcpRequest, type McpWorkspaceContext } from "../../core/src/mcp-server";
import {
  getMcpAuthConfig,
  isAnonymousSessionId,
  parseMcpContext,
  unauthorizedMcpResponse,
  verifyMcpToken,
} from "./mcp_auth";
import { createMcpExecutorService } from "./mcp_service";

type McpEndpointMode = "default" | "anonymous";

function createMcpHandler(mode: McpEndpointMode) {
  return httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const mcpAuthConfig = getMcpAuthConfig();
    const requestedContext = parseMcpContext(url);

    const hasAnonymousContextHint = isAnonymousSessionId(requestedContext?.sessionId)
      || requestedContext?.actorId?.startsWith("anon_")
      || false;

    if (mode === "default" && hasAnonymousContextHint) {
      return Response.json(
        { error: "Anonymous context must use /mcp/anonymous" },
        { status: 400 },
      );
    }

    let context: McpWorkspaceContext | undefined;

    if (mode === "anonymous") {
      try {
        const workspaceId = requestedContext?.workspaceId;
        if (!workspaceId) {
          return Response.json(
            { error: "workspaceId query parameter is required for /mcp/anonymous" },
            { status: 400 },
          );
        }

        const requestedSessionId = requestedContext?.sessionId;
        const requestedActorId = requestedContext?.actorId?.trim();

        if (requestedSessionId && !isAnonymousSessionId(requestedSessionId)) {
          return Response.json(
            { error: "sessionId for /mcp/anonymous must be an anonymous session" },
            { status: 400 },
          );
        }

        if (requestedSessionId) {
          const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForRequest, {
            workspaceId,
            sessionId: requestedSessionId,
          });

          if (access.provider !== "anonymous") {
            return Response.json({ error: "Anonymous MCP endpoint requires an anonymous session" }, { status: 403 });
          }

          if (requestedActorId && requestedActorId !== access.actorId) {
            return Response.json({ error: "actorId does not match the provided anonymous session" }, { status: 403 });
          }

          context = {
            workspaceId,
            actorId: access.actorId,
            clientId: requestedContext?.clientId,
            sessionId: requestedSessionId,
          };
        } else {
          if (!requestedActorId || !requestedActorId.startsWith("anon_")) {
            return Response.json(
              { error: "actorId query parameter is required for /mcp/anonymous when sessionId is omitted" },
              { status: 400 },
            );
          }

          const ensured = await ctx.runMutation(internal.database.ensureAnonymousMcpSession, {
            workspaceId,
            actorId: requestedActorId,
          });

          context = {
            workspaceId,
            actorId: ensured.actorId,
            clientId: requestedContext?.clientId,
            sessionId: ensured.sessionId,
          };
        }
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Workspace authorization failed" },
          { status: 403 },
        );
      }
    } else {
      const auth = await verifyMcpToken(ctx, request, mcpAuthConfig);
      if (mcpAuthConfig.enabled && !auth) {
        return unauthorizedMcpResponse(request, "No valid bearer token provided.");
      }

      if (mcpAuthConfig.enabled && auth?.provider === "workos" && !requestedContext?.workspaceId) {
        return Response.json(
          { error: "workspaceId query parameter is required when MCP OAuth is enabled" },
          { status: 400 },
        );
      }

      const hasRequestedWorkspace = Boolean(requestedContext?.workspaceId);
      if (hasRequestedWorkspace) {
        try {
          const workspaceId = requestedContext?.workspaceId;
          if (!workspaceId) {
            return Response.json(
              { error: "workspaceId query parameter is required" },
              { status: 400 },
            );
          }

          if (auth?.provider === "workos") {
            const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForWorkosSubject, {
              workspaceId,
              subject: auth.subject,
            });

            context = {
              workspaceId,
              actorId: access.actorId,
              clientId: requestedContext?.clientId,
            };
          } else {
            if (mcpAuthConfig.enabled && !requestedContext?.sessionId) {
              return unauthorizedMcpResponse(request, "No valid bearer token provided.");
            }

            const access = await ctx.runQuery(internal.workspaceAuthInternal.getWorkspaceAccessForRequest, {
              workspaceId,
              sessionId: requestedContext?.sessionId,
            });

            if (mcpAuthConfig.enabled && access.provider !== "anonymous") {
              return unauthorizedMcpResponse(
                request,
                "Bearer token required for non-anonymous sessions.",
              );
            }

            context = {
              workspaceId,
              actorId: access.actorId,
              clientId: requestedContext?.clientId,
              sessionId: requestedContext?.sessionId,
            };
          }
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Workspace authorization failed" },
            { status: 403 },
          );
        }
      }
    }

    const service = createMcpExecutorService(ctx);
    return await handleMcpRequest(service, request, context);
  });
}

export const mcpHandler = createMcpHandler("default");
export const mcpAnonymousHandler = createMcpHandler("anonymous");

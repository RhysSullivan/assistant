// ---------------------------------------------------------------------------
// Cloud MCP handler — OAuth + routing to session Durable Objects
// ---------------------------------------------------------------------------

import { env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";
import { trace, type Attributes } from "@opentelemetry/api";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { server } from "./env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTHKIT_DOMAIN = server.MCP_AUTHKIT_DOMAIN;
const RESOURCE_ORIGIN = server.MCP_RESOURCE_ORIGIN;
const JWKS_URL = new URL(`${AUTHKIT_DOMAIN}/oauth2/jwks`);

const jwks = createRemoteJWKSet(JWKS_URL);

// ---------------------------------------------------------------------------
// OAuth metadata endpoints
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });

const protectedResourceMetadata = () =>
  jsonResponse({
    resource: RESOURCE_ORIGIN,
    authorization_servers: [AUTHKIT_DOMAIN],
    bearer_methods_supported: ["header"],
    scopes_supported: [],
  });

const authorizationServerMetadata = async () => {
  try {
    const res = await fetch(`${AUTHKIT_DOMAIN}/.well-known/oauth-authorization-server`);
    if (!res.ok) return jsonResponse({ error: "upstream_error" }, 502);
    return jsonResponse(await res.json());
  } catch {
    return jsonResponse({ error: "upstream_error" }, 502);
  }
};

// ---------------------------------------------------------------------------
// JWT verification
// ---------------------------------------------------------------------------

type VerifiedToken = {
  /** The WorkOS account ID (user ID). */
  accountId: string;
  /** The WorkOS organization ID, if the session has org context. */
  organizationId: string | null;
};

const BEARER_PREFIX = "Bearer ";

const verifyBearerToken = async (request: Request): Promise<VerifiedToken | null> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith(BEARER_PREFIX)) return null;

  const token = authHeader.slice(BEARER_PREFIX.length);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTHKIT_DOMAIN,
    });
    if (!payload.sub) return null;
    return {
      accountId: payload.sub,
      organizationId: (payload.org_id as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
};

const unauthorized = () =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${RESOURCE_ORIGIN}/.well-known/oauth-protected-resource"`,
      "access-control-allow-origin": "*",
    },
  });

// ---------------------------------------------------------------------------
// Client-fingerprint capture
// ---------------------------------------------------------------------------
// Dumps everything we can learn about a connecting MCP client onto the
// enclosing fetch span's attributes. Lets us compare what each client
// (Claude Code, Claude.ai web, Cursor, Windsurf, custom scripts, ...) actually
// reports over the wire.
// ---------------------------------------------------------------------------

type CfRequestMetadata = {
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  asn?: number;
  asOrganization?: string;
  tlsVersion?: string;
  tlsCipher?: string;
  httpProtocol?: string;
  colo?: string;
};

const getCfMeta = (request: Request): CfRequestMetadata =>
  ((request as unknown as { cf?: CfRequestMetadata }).cf ?? {}) as CfRequestMetadata;

const HEADERS_TO_DUMP = [
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "mcp-protocol-version",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
  "x-client-name",
  "x-client-version",
  "x-requested-with",
] as const;

const dumpHeaders = (request: Request): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of HEADERS_TO_DUMP) {
    const value = request.headers.get(name);
    if (value !== null) out[`mcp.http.header.${name}`] = value;
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    out["mcp.http.header.authorization.scheme"] = authHeader.split(" ", 1)[0] ?? "";
    out["mcp.http.header.authorization.length"] = String(authHeader.length);
  }
  // Record the full header name list too — surfaces anything unexpected
  // without us having to enumerate every possibility up front.
  out["mcp.http.header.names"] = Array.from(request.headers.keys()).sort().join(",");
  return out;
};

type JsonRpcRequestLike = {
  method?: string;
  id?: string | number;
  params?: Record<string, unknown>;
};

const safeParseJson = async (request: Request): Promise<JsonRpcRequestLike | null> => {
  try {
    const clone = request.clone();
    const text = await clone.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as JsonRpcRequestLike;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
};

const rpcPayloadAttributes = (payload: JsonRpcRequestLike | null): Attributes => {
  if (!payload) return {};
  const attrs: Attributes = {};
  if (typeof payload.method === "string") attrs["mcp.rpc.method"] = payload.method;
  if (payload.id !== undefined) attrs["mcp.rpc.id"] = String(payload.id);

  const params = (payload.params ?? {}) as Record<string, unknown>;

  if (payload.method === "initialize") {
    const clientInfo = (params.clientInfo ?? {}) as Record<string, unknown>;
    const capabilities = (params.capabilities ?? {}) as Record<string, unknown>;
    if (typeof clientInfo.name === "string") attrs["mcp.client.name"] = clientInfo.name;
    if (typeof clientInfo.version === "string") attrs["mcp.client.version"] = clientInfo.version;
    if (typeof clientInfo.title === "string") attrs["mcp.client.title"] = clientInfo.title;
    if (typeof params.protocolVersion === "string") {
      attrs["mcp.client.protocol_version"] = params.protocolVersion;
    }
    attrs["mcp.client.capability.keys"] = Object.keys(capabilities).sort().join(",");
    // Capture full clientInfo + capabilities as JSON for ad-hoc inspection.
    // Keep these bounded so one pathological client can't bloat a span.
    attrs["mcp.client.info.json"] = JSON.stringify(clientInfo).slice(0, 2000);
    attrs["mcp.client.capabilities.json"] = JSON.stringify(capabilities).slice(0, 2000);
  } else if (payload.method === "tools/call") {
    const name = params.name;
    if (typeof name === "string") attrs["mcp.tool.name"] = name;
  } else if (payload.method === "resources/read" || payload.method === "resources/subscribe") {
    const uri = params.uri;
    if (typeof uri === "string") attrs["mcp.resource.uri"] = uri;
  } else if (payload.method === "prompts/get") {
    const name = params.name;
    if (typeof name === "string") attrs["mcp.prompt.name"] = name;
  }

  return attrs;
};

const annotateMcpClientSpan = async (
  request: Request,
  opts: { token: VerifiedToken | null; parseBody: boolean },
): Promise<void> => {
  const span = trace.getActiveSpan();
  if (!span) return;

  const cf = getCfMeta(request);
  const attrs: Attributes = {
    "mcp.request.method": request.method,
    "mcp.request.session_id_present": !!request.headers.get("mcp-session-id"),
    "mcp.request.session_id": request.headers.get("mcp-session-id") ?? "",
    "mcp.auth.has_bearer": (request.headers.get("authorization") ?? "").startsWith("Bearer "),
    "mcp.auth.verified": !!opts.token,
    "mcp.auth.organization_id": opts.token?.organizationId ?? "",
    "mcp.auth.account_id": opts.token?.accountId ?? "",
    "cf.country": cf.country ?? "",
    "cf.city": cf.city ?? "",
    "cf.region": cf.region ?? "",
    "cf.timezone": cf.timezone ?? "",
    "cf.asn": cf.asn ?? 0,
    "cf.as_organization": cf.asOrganization ?? "",
    "cf.tls_version": cf.tlsVersion ?? "",
    "cf.tls_cipher": cf.tlsCipher ?? "",
    "cf.http_protocol": cf.httpProtocol ?? "",
    "cf.colo": cf.colo ?? "",
  };

  Object.assign(attrs, dumpHeaders(request));

  if (opts.parseBody) {
    const payload = await safeParseJson(request);
    Object.assign(attrs, rpcPayloadAttributes(payload));
  }

  span.setAttributes(attrs);
};

// ---------------------------------------------------------------------------
// DO routing
// ---------------------------------------------------------------------------

const jsonRpcError = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Route an MCP request to a session DO.
 *
 * - No session header → create a new DO (initialize flow)
 * - With session header → route to existing DO
 */
const handleMcpRequest_POST = async (request: Request, token: VerifiedToken): Promise<Response> => {
  if (!token.organizationId) {
    return jsonRpcError(403, -32001, "No organization in session — log in via the web app first");
  }

  try {
    const ns = env.MCP_SESSION;
    const sessionId = request.headers.get("mcp-session-id");

    if (sessionId) {
      const id = ns.idFromString(sessionId);
      const stub = ns.get(id);
      return await stub.handleRequest(request);
    }

    // New session — create a DO and initialize it
    const id = ns.newUniqueId();
    const stub = ns.get(id);

    await stub.init({ organizationId: token.organizationId });

    return await stub.handleRequest(request);
  } catch (err) {
    console.error("[mcp] POST handler error:", err instanceof Error ? err.stack : err);
    Sentry.captureException(err);
    return jsonRpcError(500, -32603, "Internal server error");
  }
};

const handleMcpRequest_DELETE = async (request: Request): Promise<Response> => {
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) return new Response(null, { status: 204 });

  // Let the DO handle the DELETE — its transport will clean up
  const ns = env.MCP_SESSION;
  const id = ns.idFromString(sessionId);
  const stub = ns.get(id);
  return stub.handleRequest(request);
};

const handleMcpRequest_GET = async (request: Request): Promise<Response> => {
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return jsonRpcError(400, -32000, "mcp-session-id header required for SSE");
  }

  const ns = env.MCP_SESSION;
  const id = ns.idFromString(sessionId);
  const stub = ns.get(id);
  return stub.handleRequest(request);
};

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

export const handleMcpRequest = async (request: Request): Promise<Response | null> => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight for MCP paths
  if (
    request.method === "OPTIONS" &&
    (pathname === "/mcp" || pathname.startsWith("/.well-known/"))
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers":
          "authorization, content-type, mcp-session-id, accept, mcp-protocol-version",
        "access-control-expose-headers": "mcp-session-id",
      },
    });
  }

  // Well-known endpoints (public, no auth)
  if (pathname === "/.well-known/oauth-protected-resource") {
    return protectedResourceMetadata();
  }
  if (pathname === "/.well-known/oauth-authorization-server") {
    return authorizationServerMetadata();
  }

  // MCP endpoint
  if (pathname !== "/mcp") return null;

  // Auth required for all MCP methods
  const token = await verifyBearerToken(request);

  // Capture fingerprint attrs on the enclosing fetch span BEFORE dispatch.
  // Only POSTs carry a JSON body worth parsing; GET (SSE) and DELETE don't.
  await annotateMcpClientSpan(request, {
    token,
    parseBody: request.method === "POST",
  });

  if (!token) return unauthorized();

  switch (request.method) {
    case "POST":
      return handleMcpRequest_POST(request, token);
    case "GET":
      return handleMcpRequest_GET(request);
    case "DELETE":
      return handleMcpRequest_DELETE(request);
    default:
      return jsonRpcError(405, -32001, "Method not allowed");
  }
};

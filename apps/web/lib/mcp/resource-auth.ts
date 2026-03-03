import { createRemoteJWKSet, jwtVerify } from "jose";

import { webServerEnvironment } from "../env/server";
import { externalOriginFromRequest } from "../workos";

type McpAuthConfig = {
  enabled: boolean;
  authorizationServer: string | null;
  jwks: ReturnType<typeof createRemoteJWKSet> | null;
};

export type VerifiedMcpToken = {
  subject: string;
  email: string | null;
  displayName: string | null;
};

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const toAuthorizationServerUrl = (value: string): string | null => {
  const candidate =
    value.startsWith("http://") || value.startsWith("https://")
      ? value
      : `https://${value}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
};

const resolveAuthorizationServer = (): string | null => {
  const candidates = [
    webServerEnvironment.mcpAuthorizationServer,
    webServerEnvironment.mcpAuthorizationServerUrl,
    webServerEnvironment.workosAuthkitIssuer,
    webServerEnvironment.workosAuthkitDomain,
  ];

  for (const candidate of candidates) {
    const normalized = trim(candidate);
    if (!normalized) {
      continue;
    }

    const parsed = toAuthorizationServerUrl(normalized);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

let cachedAuthConfig: McpAuthConfig | null = null;

export const getMcpAuthConfig = (): McpAuthConfig => {
  const authorizationServer = resolveAuthorizationServer();

  if (
    cachedAuthConfig
    && cachedAuthConfig.authorizationServer === authorizationServer
  ) {
    return cachedAuthConfig;
  }

  if (!authorizationServer) {
    cachedAuthConfig = {
      enabled: false,
      authorizationServer: null,
      jwks: null,
    };
    return cachedAuthConfig;
  }

  cachedAuthConfig = {
    enabled: true,
    authorizationServer,
    jwks: createRemoteJWKSet(new URL("/oauth2/jwks", authorizationServer)),
  };

  return cachedAuthConfig;
};

const parseBearerToken = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

export const resourceMetadataUrl = (request: Request): string => {
  const url = new URL(request.url);
  const origin = externalOriginFromRequest(request);
  const metadata = new URL(
    "/.well-known/oauth-protected-resource",
    origin,
  );
  metadata.search = url.search;

  const resource = new URL(url.pathname, origin);
  resource.search = url.search;
  metadata.searchParams.set("resource", resource.toString());

  return metadata.toString();
};

export const unauthorizedMcpResponse = (
  request: Request,
  message: string,
): Response => {
  const challenge = [
    'Bearer error="unauthorized"',
    'error_description="Authorization needed"',
    `resource_metadata="${resourceMetadataUrl(request)}"`,
  ].join(", ");

  return Response.json(
    { error: message },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": challenge,
      },
    },
  );
};

const readDisplayName = (payload: Record<string, unknown>): string | null => {
  const direct = payload.name;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const given = typeof payload.given_name === "string" ? payload.given_name.trim() : "";
  const family = typeof payload.family_name === "string" ? payload.family_name.trim() : "";
  const combined = [given, family].filter((part) => part.length > 0).join(" ");

  return combined.length > 0 ? combined : null;
};

export const verifyMcpBearerToken = async (
  request: Request,
  config: McpAuthConfig,
): Promise<VerifiedMcpToken | null> => {
  if (!config.enabled || !config.authorizationServer || !config.jwks) {
    return null;
  }

  const token = parseBearerToken(request);
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, config.jwks, {
      issuer: config.authorizationServer,
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }

    const email = typeof payload.email === "string" ? payload.email : null;
    const displayName = readDisplayName(payload);

    return {
      subject: payload.sub,
      email,
      displayName,
    };
  } catch {
    return null;
  }
};

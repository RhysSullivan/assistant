import { Result } from "better-result";
import {
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { resultErrorMessage } from "@/lib/error-utils";
import { fetchMcpOAuth } from "@/lib/mcp/oauth-fetch";
import { parseMcpSourceUrl } from "@/lib/mcp/oauth-url";

type DetectResponse = {
  oauth: boolean;
  authorizationServers: string[];
  detail?: string;
};

const MCP_OAUTH_CHALLENGE_PROBE_TIMEOUT_MS = 2_500;
const MCP_OAUTH_METADATA_TIMEOUT_MS = 12_000;

const oauthMetadataSchema = z.object({
  authorization_servers: z.array(z.string()).optional(),
}).passthrough();

function noStoreDetectJson(payload: DetectResponse, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

async function withTimeout<T>(factory: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    factory().then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function probeOAuthChallenge(sourceUrl: URL): Promise<boolean> {
  const response = await fetchMcpOAuth(
    sourceUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "oauth-detect",
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "Executor OAuth Detector",
            version: "1.0.0",
          },
        },
      }),
    },
    {
      timeoutMs: MCP_OAUTH_CHALLENGE_PROBE_TIMEOUT_MS,
      label: "OAuth challenge probe",
    },
  );

  const hasBearerChallenge = /^Bearer\s/i.test(response.headers.get("WWW-Authenticate") ?? "");
  const challenge = extractWWWAuthenticateParams(response);
  await response.body?.cancel();

  if ((response.status === 401 || response.status === 403) && hasBearerChallenge) {
    return true;
  }

  return Boolean(challenge.resourceMetadataUrl);
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const sourceUrlRaw = requestUrl.searchParams.get("sourceUrl")?.trim() ?? "";
  if (!sourceUrlRaw) {
    return noStoreDetectJson({ oauth: false, authorizationServers: [], detail: "Missing sourceUrl" }, 400);
  }

  const sourceUrlResult = parseMcpSourceUrl(sourceUrlRaw);
  if (!sourceUrlResult.isOk()) {
    return noStoreDetectJson(
      {
        oauth: false,
        authorizationServers: [],
        detail: resultErrorMessage(sourceUrlResult.error, "Invalid sourceUrl"),
      },
      400,
    );
  }
  const sourceUrl = sourceUrlResult.value;

  const challengeProbeResult = await Result.tryPromise(() => probeOAuthChallenge(sourceUrl));
  if (challengeProbeResult.isOk() && challengeProbeResult.value) {
    return noStoreDetectJson({
      oauth: true,
      authorizationServers: [],
      detail: "OAuth detected from endpoint challenge",
    });
  }

  const metadataResult = await Result.tryPromise(() =>
    withTimeout(
      () => discoverOAuthProtectedResourceMetadata(
        sourceUrl,
        undefined,
        (input, init) => fetchMcpOAuth(input, init ?? {}, {
          timeoutMs: MCP_OAUTH_METADATA_TIMEOUT_MS,
          label: "OAuth metadata lookup",
        }),
      ),
      MCP_OAUTH_METADATA_TIMEOUT_MS,
      "OAuth metadata lookup",
    )
  );
  if (!metadataResult.isOk()) {
    const probeDetail = challengeProbeResult.isOk()
      ? ""
      : `; challenge probe: ${resultErrorMessage(challengeProbeResult.error, "failed")}`;
    return noStoreDetectJson({
      oauth: false,
      authorizationServers: [],
      detail: `${resultErrorMessage(metadataResult.error, "OAuth metadata lookup failed")}${probeDetail}`,
    }, 502);
  }

  const parsedMetadata = oauthMetadataSchema.safeParse(metadataResult.value);
  const authorizationServers = parsedMetadata.success
    ? (parsedMetadata.data.authorization_servers ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : [];

  return noStoreDetectJson({
    oauth: authorizationServers.length > 0,
    authorizationServers,
  });
}

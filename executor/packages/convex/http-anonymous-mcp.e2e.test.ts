import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";

function setup() {
  return convexTest(schema, {
    "./database.ts": () => import("./database"),
    "./executor.ts": () => import("./executor"),
    "./executorNode.ts": () => import("./executorNode"),
    "./http.ts": () => import("./http"),
    "./auth.ts": () => import("./auth"),
    "./workspaceAuthInternal.ts": () => import("./workspaceAuthInternal"),
    "./workspaceToolCache.ts": () => import("./workspaceToolCache"),
    "./openApiSpecCache.ts": () => import("./openApiSpecCache"),
    "./_generated/api.js": () => import("./_generated/api.js"),
  });
}

test("anonymous MCP endpoint allows direct access without OAuth token", async () => {
  const t = setup();
  const session = await t.mutation(internal.database.bootstrapAnonymousSession, {});
  const query = new URLSearchParams({
    workspaceId: session.workspaceId,
    actorId: session.actorId,
  }).toString();

  const anonymousRes = await t.fetch(`/mcp/anonymous?${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  expect(anonymousRes.status).not.toBe(401);
  expect(anonymousRes.status).not.toBe(403);

  const otherSession = await t.mutation(internal.database.bootstrapAnonymousSession, {});
  const mismatchedQuery = new URLSearchParams({
    workspaceId: otherSession.workspaceId,
    actorId: session.actorId,
  }).toString();
  const mismatchedRes = await t.fetch(`/mcp/anonymous?${mismatchedQuery}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  expect(mismatchedRes.status).toBe(403);

  const wrongEndpointRes = await t.fetch(`/mcp?${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  expect(wrongEndpointRes.status).toBe(400);
});

test("OAuth discovery only applies to /mcp and not /mcp/anonymous", async () => {
  const previousAuthorizationServer = process.env.MCP_AUTHORIZATION_SERVER;
  process.env.MCP_AUTHORIZATION_SERVER = "https://victorious-point-35-staging.authkit.app";

  const t = setup();
  try {
    const protectedResourceRes = await t.fetch("/.well-known/oauth-protected-resource?workspaceId=ms7ewkx14rnc73wwnqsj80cngd812kqt");
    expect(protectedResourceRes.status).toBe(200);
    const protectedResourceBody = await protectedResourceRes.json() as {
      authorization_servers: string[];
      resource: string;
    };
    expect(protectedResourceBody.authorization_servers[0]).toBe(process.env.MCP_AUTHORIZATION_SERVER);
    const protectedResourceUrl = new URL(protectedResourceBody.resource);
    expect(protectedResourceUrl.pathname).toBe("/mcp");

    const anonymousResource = encodeURIComponent(
      `${protectedResourceUrl.origin}/mcp/anonymous?workspaceId=ms7ewkx14rnc73wwnqsj80cngd812kqt&actorId=anon_123`,
    );
    const anonymousRes = await t.fetch(`/.well-known/oauth-protected-resource?resource=${anonymousResource}`);
    expect(anonymousRes.status).toBe(404);
  } finally {
    if (previousAuthorizationServer === undefined) {
      delete process.env.MCP_AUTHORIZATION_SERVER;
    } else {
      process.env.MCP_AUTHORIZATION_SERVER = previousAuthorizationServer;
    }
  }
});

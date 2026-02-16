import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const anonymousTokenRequestSchema = z.object({
  actorId: z.string().trim().min(1).optional(),
});

function toSiteUrl(convexUrl?: string): string | null {
  if (!convexUrl) {
    return null;
  }

  try {
    const parsed = new URL(convexUrl);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveConvexSiteUrl(): string | null {
  return toSiteUrl(
    process.env.EXECUTOR_WEB_CONVEX_SITE_URL
      ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL
      ?? process.env.CONVEX_SITE_URL
      ?? process.env.EXECUTOR_WEB_CONVEX_URL
      ?? process.env.NEXT_PUBLIC_CONVEX_URL
      ?? process.env.CONVEX_URL,
  );
}

function noStoreJson(payload: unknown, status: number): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const convexSiteUrl = resolveConvexSiteUrl();
  if (!convexSiteUrl) {
    return noStoreJson({ error: "Convex site URL is not configured" }, 500);
  }

  let body: { actorId?: string } = {};
  try {
    const parsed = anonymousTokenRequestSchema.safeParse(await request.json());
    if (parsed.success && parsed.data.actorId) {
      body.actorId = parsed.data.actorId;
    }
  } catch {
    body = {};
  }

  const response = await fetch(`${convexSiteUrl}/auth/anonymous/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text || "Anonymous token endpoint returned invalid JSON" };
  }

  return noStoreJson(payload, response.status);
}

import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

type HttpActionCtx = Pick<ActionCtx, "runAction" | "runMutation" | "runQuery">;

const limiter = new RateLimiter(components.rateLimiter, {
  mcp: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
  },
  anonymousToken: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
  },
});

function firstHeaderValue(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName)?.trim();
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function requestIdentityKey(request: Request): string {
  const url = new URL(request.url);
  const ip
    = firstHeaderValue(request, "cf-connecting-ip")
    ?? firstHeaderValue(request, "x-forwarded-for")
    ?? firstHeaderValue(request, "x-real-ip")
    ?? "unknown";
  const ua = request.headers.get("user-agent")?.trim() ?? "unknown";

  return `${url.pathname}|${ip}|${ua.slice(0, 128)}`;
}

function tooManyRequestsResponse(retryAfter: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfter / 1000));
  return Response.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "retry-after": String(seconds),
      },
    },
  );
}

export async function enforceMcpRateLimit(ctx: HttpActionCtx, request: Request): Promise<Response | null> {
  const status = await limiter.limit(ctx, "mcp", {
    key: requestIdentityKey(request),
  });
  if (status.ok) {
    return null;
  }

  return tooManyRequestsResponse(status.retryAfter ?? 1000);
}

export async function enforceAnonymousTokenRateLimit(ctx: HttpActionCtx, request: Request): Promise<Response | null> {
  const status = await limiter.limit(ctx, "anonymousToken", {
    key: requestIdentityKey(request),
  });
  if (status.ok) {
    return null;
  }

  return tooManyRequestsResponse(status.retryAfter ?? 1000);
}

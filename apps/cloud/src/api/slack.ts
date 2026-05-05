import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { SlackService } from "../services/slack";
import {
  HttpResponseError,
  isServerError,
  toErrorServerResponse,
} from "./error-response";

const isValidEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  if (request.method !== "POST") {
    return yield* Effect.fail(
      new HttpResponseError({
        status: 405,
        code: "method_not_allowed",
        message: "Method not allowed",
      }),
    );
  }

  const body = (yield* Effect.mapError(
    request.json,
    () =>
      new HttpResponseError({
        status: 400,
        code: "invalid_json",
        message: "Invalid request body",
      }),
  )) as {
    email?: unknown;
    organization?: unknown;
  };

  const trimmed = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const organization = trimmed(body.organization, 200);

  if (!isValidEmail(email)) {
    return yield* Effect.fail(
      new HttpResponseError({
        status: 400,
        code: "invalid_email",
        message: "A valid email is required",
      }),
    );
  }

  // Global rate limit — single shared bucket keyed at "global". Per-IP gating
  // belongs at the edge (Cloudflare Rules).
  const limit = yield* Effect.tryPromise({
    try: () => env.SLACK_INVITE_LIMITER.limit({ key: "global" }),
    catch: (cause) => ({ success: false as const, fetchError: String(cause) }),
  });
  if (!limit.success) {
    console.error("[slack] global rate limit hit");
    return yield* Effect.fail(
      new HttpResponseError({
        status: 429,
        code: "rate_limited",
        message: "We're getting more contact requests than usual. Please try again later.",
      }),
    );
  }

  const slack = yield* SlackService;
  const { invite } = yield* slack.createConnectInvite({ email, organization }).pipe(
    Effect.tapError((err) =>
      Effect.sync(() => {
        console.error(`[slack] ${err.method} failed:`, err.error);
      }),
    ),
    Effect.mapError(
      () =>
        new HttpResponseError({
          status: 500,
          code: "slack_invite_failed",
          message: "Couldn't create your Slack invite. Please try again shortly.",
        }),
    ),
  );

  return HttpServerResponse.jsonUnsafe({ url: invite.url }, { status: 200 });
}).pipe(
  Effect.catchCause((err) => {
    if (isServerError(err)) {
      console.error("[slack] request failed:", err instanceof Error ? err.stack : err);
    }
    return Effect.succeed(toErrorServerResponse(err));
  }),
);

export const SlackContactRoutesLive = HttpRouter.add("POST", "/contact/slack", handler);

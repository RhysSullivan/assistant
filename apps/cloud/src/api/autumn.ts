import { Effect } from "effect";
import { Autumn } from "autumn-js";
import { autumnHandler } from "autumn-js/backend";

import { WorkOSAuth } from "../auth/workos";
import { server } from "../env";
import { HttpResponseError, isServerError, toErrorResponse } from "./error-response";
import { SharedServices } from "./layers";

let cachedAutumn: Autumn | null = null;

const getAutumn = () => {
  if (!cachedAutumn && server.AUTUMN_SECRET_KEY) {
    cachedAutumn = new Autumn({ secretKey: server.AUTUMN_SECRET_KEY });
  }
  return cachedAutumn;
};

export const trackExecutionUsage = (organizationId: string): void => {
  const autumn = getAutumn();
  if (!autumn) return;

  autumn
    .track({
      customerId: organizationId,
      featureId: "executions",
      value: 1,
    })
    .catch((err) => {
      console.error("[billing] track failed:", err);
    });
};

export const handleAutumnRequest = async (request: Request): Promise<Response> => {
  const program = Effect.gen(function* () {
    const workos = yield* WorkOSAuth;
    const session = yield* workos.authenticateRequest(request);

    if (!session || !session.organizationId) {
      return yield* Effect.fail(
        new HttpResponseError({
          status: 401,
          code: "unauthorized",
          message: "Unauthorized",
        }),
      );
    }

    const url = new URL(request.url);
    const body =
      request.method !== "GET" && request.method !== "HEAD"
        ? yield* Effect.tryPromise({
            try: () => request.json(),
            catch: () =>
              new HttpResponseError({
                status: 400,
                code: "invalid_json",
                message: "Invalid request body",
              }),
          })
        : undefined;

    const { statusCode, response } = yield* Effect.promise(() =>
      autumnHandler({
        request: {
          url: url.pathname,
          method: request.method,
          body,
        },
        customerId: session.organizationId,
        customerData: {
          name: session.email,
          email: session.email,
        },
        clientOptions: {
          secretKey: server.AUTUMN_SECRET_KEY,
        },
        pathPrefix: "/autumn",
      }),
    );

    if (statusCode >= 400) {
      console.error("[autumn] upstream error:", statusCode, response);
      return yield* Effect.fail(
        new HttpResponseError({
          status: statusCode,
          code: "billing_request_failed",
          message: "Billing request failed",
        }),
      );
    }

    return Response.json(response, { status: statusCode });
  });

  return Effect.runPromise(
    program.pipe(
      Effect.provide(SharedServices),
      Effect.scoped,
      Effect.catchAll((err) => {
        if (isServerError(err)) {
          console.error("[autumn] request failed:", err instanceof Error ? err.stack : err);
        }
        return Effect.succeed(toErrorResponse(err));
      }),
    ),
  );
};

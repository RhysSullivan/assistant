import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Context, Effect } from "effect";

type RequestAppService = {
  readonly app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    unknown,
    HttpServerRequest.HttpServerRequest
  >;
};

export class OrgRequestHandlerService extends Context.Service<OrgRequestHandlerService, RequestAppService>()(
  "@executor-js/cloud/OrgRequestHandlerService",
) {}

export class NonProtectedRequestHandlerService extends Context.Service<NonProtectedRequestHandlerService, RequestAppService>()(
  "@executor-js/cloud/NonProtectedRequestHandlerService",
) {}

export class AutumnRequestHandlerService extends Context.Service<AutumnRequestHandlerService, RequestAppService>()(
  "@executor-js/cloud/AutumnRequestHandlerService",
) {}

export class ProtectedRequestHandlerService extends Context.Service<ProtectedRequestHandlerService, RequestAppService>()(
  "@executor-js/cloud/ProtectedRequestHandlerService",
) {}

export const ApiRouterApp = Effect.gen(function* () {
  const org = yield* OrgRequestHandlerService;
  const nonProtected = yield* NonProtectedRequestHandlerService;
  const autumn = yield* AutumnRequestHandlerService;
  const protectedHandler = yield* ProtectedRequestHandlerService;

  const orgHandler = HttpEffect.toWebHandler(org.app);
  const nonProtectedHandler = HttpEffect.toWebHandler(nonProtected.app);
  const autumnHandler = HttpEffect.toWebHandler(autumn.app);
  const protectedRequestHandler = HttpEffect.toWebHandler(protectedHandler.app);

  return (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/org")) return orgHandler(request);
    if (pathname.startsWith("/auth")) return nonProtectedHandler(request);
    if (pathname.startsWith("/autumn")) return autumnHandler(request);
    return protectedRequestHandler(request);
  };
});

export const ApiRequestHandler = ApiRouterApp;

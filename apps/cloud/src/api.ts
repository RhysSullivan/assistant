import { Effect, Layer } from "effect";
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { AutumnApiApp } from "./api/autumn";
import { NonProtectedApiApp, OrgApiApp } from "./api/layers";
import { ProtectedApiApp } from "./api/protected";
import {
  ApiRequestHandler,
  AutumnRequestHandlerService,
  NonProtectedRequestHandlerService,
  ProtectedRequestHandlerService,
  OrgRequestHandlerService,
} from "./api/router";

const ApiRequestHandlersLive = Layer.mergeAll(
  Layer.succeed(OrgRequestHandlerService)({ app: OrgApiApp as ApiApp }),
  Layer.succeed(NonProtectedRequestHandlerService)({ app: NonProtectedApiApp as ApiApp }),
  Layer.succeed(AutumnRequestHandlerService)({ app: AutumnApiApp as ApiApp }),
  Layer.succeed(ProtectedRequestHandlerService)({ app: ProtectedApiApp as ApiApp }),
);

type ApiApp = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  unknown,
  HttpServerRequest.HttpServerRequest
>;

export const handleApiRequest = Effect.runSync(
  Effect.provide(ApiRequestHandler, ApiRequestHandlersLive),
);

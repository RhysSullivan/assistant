import * as PlatformHeaders from "@effect/platform/Headers";
import { ControlPlaneAuthHeaders } from "../auth-headers";
import {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
} from "#api";
import {
  ActorUnauthenticatedError,
  createActor,
} from "#domain";
import {
  PrincipalProviderSchema,
  PrincipalSchema,
  type Principal,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { getRuntimeLocalWorkspaceOption } from "./local-runtime-context";

export { ControlPlaneAuthHeaders };

const decodePrincipal = Schema.decodeUnknown(PrincipalSchema);
const decodePrincipalProvider = Schema.decodeUnknown(PrincipalProviderSchema);

const headerValue = (
  headers: PlatformHeaders.Headers,
  name: string,
): string | null => {
  const value = Option.getOrNull(PlatformHeaders.get(headers, name));
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toUnauthenticatedError = (
  message: string,
  cause?: unknown,
): ActorUnauthenticatedError =>
  new ActorUnauthenticatedError({
    message:
      cause === undefined
        ? message
        : `${message}: ${
            ParseResult.isParseError(cause)
              ? ParseResult.TreeFormatter.formatErrorSync(cause)
              : String(cause)
          }`,
  });

const readPrincipalFromHeaders = (
  headers: PlatformHeaders.Headers,
): Effect.Effect<Principal, ActorUnauthenticatedError> =>
  Effect.gen(function* () {
    const accountId = headerValue(headers, ControlPlaneAuthHeaders.accountId);
    if (accountId === null) {
      return yield* Effect.fail(
        new ActorUnauthenticatedError({
          message: `Missing required header: ${ControlPlaneAuthHeaders.accountId}`,
        }),
      );
    }

    const providerRaw =
      headerValue(headers, ControlPlaneAuthHeaders.principalProvider) ?? "local";
    const provider = yield* decodePrincipalProvider(providerRaw).pipe(
      Effect.mapError((cause) =>
        toUnauthenticatedError("Invalid principal provider header", cause),
      ),
    );

    const subject =
      headerValue(headers, ControlPlaneAuthHeaders.principalSubject)
      ?? `${provider}:${accountId}`;

    return yield* decodePrincipal({
      accountId,
      provider,
      subject,
      email: headerValue(headers, ControlPlaneAuthHeaders.principalEmail),
      displayName: headerValue(headers, ControlPlaneAuthHeaders.principalDisplayName),
    }).pipe(
      Effect.mapError((cause) =>
        toUnauthenticatedError("Invalid principal headers", cause),
      ),
    );
  });

const createLocalActor = (principal: Principal) =>
  createActor({
    principal,
    workspaceMemberships: [],
    organizationMemberships: [],
  });

export const createHeaderActorResolver = (): ControlPlaneActorResolverShape => ({
  resolveActor: ({ headers }) =>
    Effect.gen(function* () {
      const principal = yield* readPrincipalFromHeaders(headers);
      return yield* createLocalActor(principal);
    }),

  resolveWorkspaceActor: ({ workspaceId, headers }) =>
    Effect.gen(function* () {
      const principal = yield* readPrincipalFromHeaders(headers);
      const runtimeLocalWorkspace = yield* getRuntimeLocalWorkspaceOption();
      if (
        runtimeLocalWorkspace !== null
        && runtimeLocalWorkspace.installation.workspaceId === workspaceId
        && runtimeLocalWorkspace.installation.accountId === principal.accountId
      ) {
        return yield* createActor({
          principal,
          workspaceMemberships: [{
            accountId: principal.accountId,
            workspaceId,
            role: "owner",
            status: "active",
            grantedAt: 0,
            updatedAt: 0,
          }],
          organizationMemberships: [],
        });
      }

      return yield* createLocalActor(principal);
    }),
});

export const RuntimeActorResolverLive = (
  actorResolver?: ControlPlaneActorResolverShape,
) =>
  actorResolver
    ? Layer.succeed(ControlPlaneActorResolver, actorResolver)
    : Layer.succeed(ControlPlaneActorResolver, createHeaderActorResolver());

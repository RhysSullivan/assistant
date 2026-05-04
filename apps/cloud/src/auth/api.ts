import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Schema } from "effect";
import { UserStoreError, WorkOSError } from "./errors";
import { SessionAuth } from "./middleware";

const AuthUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

const AuthOrganization = Schema.Struct({
  id: Schema.String,
  handle: Schema.String,
  name: Schema.String,
});

const AuthMeResponse = Schema.Struct({
  user: AuthUser,
  /** Memberships, with the org `handle` URL routes use. Sorted alphabetically. */
  organizations: Schema.Array(AuthOrganization),
});

const AuthOrganizationsResponse = Schema.Struct({
  organizations: Schema.Array(AuthOrganization),
});

const CreateOrganizationBody = Schema.Struct({
  name: Schema.String,
});

const CreateOrganizationResponse = Schema.Struct({
  id: Schema.String,
  handle: Schema.String,
  name: Schema.String,
});

const AuthCallbackSearch = Schema.Struct({
  code: Schema.String,
  state: Schema.String,
});

export const AUTH_PATHS = {
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  callback: "/api/auth/callback",
} as const;

const AuthErrors = [UserStoreError, WorkOSError] as const;

/** Public auth endpoints — no authentication required */
export class CloudAuthPublicApi extends HttpApiGroup.make("cloudAuthPublic")
  .add(HttpApiEndpoint.get("login", "/auth/login"))
  .add(
    HttpApiEndpoint.get("callback", "/auth/callback", {
      query: AuthCallbackSearch,
      error: AuthErrors,
    }),
  ) {}

/** Session auth endpoints — require a logged-in user, may not have an org */
export class CloudAuthApi extends HttpApiGroup.make("cloudAuth")
  .add(
    HttpApiEndpoint.get("me", "/auth/me", {
      success: AuthMeResponse,
      error: AuthErrors,
    }),
  )
  .add(HttpApiEndpoint.post("logout", "/auth/logout"))
  .add(
    HttpApiEndpoint.get("organizations", "/auth/organizations", {
      success: AuthOrganizationsResponse,
      error: WorkOSError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createOrganization", "/auth/create-organization", {
      payload: CreateOrganizationBody,
      success: CreateOrganizationResponse,
      error: AuthErrors,
    }),
  )
  .middleware(SessionAuth) {}

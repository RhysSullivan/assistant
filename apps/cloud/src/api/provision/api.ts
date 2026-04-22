// ---------------------------------------------------------------------------
// Provisioning API — programmatic, operator-authenticated onboarding.
//
// Today the UI flow is (1) create org via WorkOS, (2) save secrets per-scope,
// (3) add an MCP or OpenAPI source pre-wired to those secrets. This surfaces
// each of those as a POST and also a single `/api/provision` that does all
// three in one shot.
//
// URL prefix: `/api/provision/...` — matches the existing `/api/auth/...`,
// `/api/org/...`, `/api/autumn/...` pattern (no `v1` segment, since the rest
// of the HttpApi surface here is also unversioned).
//
// Auth: an operator-level bearer declared on the group middleware. Today
// the bearer is a single shared env secret (`PROVISION_API_TOKEN`). See the
// TODO in `./middleware.ts` for the long-term plan (proper operator
// accounts + scoped tokens).
// ---------------------------------------------------------------------------

import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Schema } from "effect";

import { ProvisionAuth, ProvisionUnauthorized } from "./middleware";

// ---------------------------------------------------------------------------
// Shared response envelope for errors this API emits
// ---------------------------------------------------------------------------

export class ProvisionError extends Schema.TaggedError<ProvisionError>()(
  "ProvisionError",
  {
    code: Schema.String,
    message: Schema.String,
  },
  HttpApiSchema.annotations({ status: 400 }),
) {}

// ---------------------------------------------------------------------------
// Common shapes
// ---------------------------------------------------------------------------

const orgIdParam = HttpApiSchema.param("orgId", Schema.String);

const StringMap = Schema.Record({ key: Schema.String, value: Schema.String });
const UnknownMap = Schema.Record({ key: Schema.String, value: Schema.Unknown });

// ---------------------------------------------------------------------------
// Create-org
// ---------------------------------------------------------------------------

const CreateOrgPayload = Schema.Struct({
  /** Human-readable org name. */
  name: Schema.String,
});

const CreateOrgResponse = Schema.Struct({
  orgId: Schema.String,
  name: Schema.String,
  /** Opaque admin token; currently echoes the shared operator bearer the
   *  caller supplied. Reserved for when per-org admin tokens ship — so
   *  automation can switch on response shape, not endpoint presence. */
  adminToken: Schema.String,
});

// ---------------------------------------------------------------------------
// Bulk secrets
// ---------------------------------------------------------------------------

const SecretInput = Schema.Struct({
  /** Stable id the caller uses to reference this secret from integrations. */
  id: Schema.String,
  name: Schema.String,
  value: Schema.String,
  /** Optional: which executor scope gets the secret. Defaults to the org
   *  scope (orgId). Use `user-org:${userId}:${orgId}` to pin at a user
   *  scope. */
  scope: Schema.optional(Schema.String),
  /** Optional provider routing. When omitted, the executor picks the first
   *  writable provider in registration order. */
  provider: Schema.optional(Schema.String),
});

const BulkSecretsPayload = Schema.Struct({
  secrets: Schema.Array(SecretInput),
});

const SecretResult = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  name: Schema.String,
  provider: Schema.String,
});

const BulkSecretsResponse = Schema.Struct({
  secrets: Schema.Array(SecretResult),
});

// ---------------------------------------------------------------------------
// Integrations (MCP + OpenAPI)
// ---------------------------------------------------------------------------

const McpAuthPayload = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("header"),
    headerName: Schema.String,
    /** Id of a secret previously put via `/secrets`. */
    secretId: Schema.String,
    prefix: Schema.optional(Schema.String),
  }),
);

const McpIntegration = Schema.Struct({
  kind: Schema.Literal("mcp"),
  name: Schema.String,
  endpoint: Schema.String,
  namespace: Schema.optional(Schema.String),
  remoteTransport: Schema.optional(
    Schema.Literal("streamable-http", "sse", "auto"),
  ),
  headers: Schema.optional(StringMap),
  queryParams: Schema.optional(StringMap),
  auth: Schema.optional(McpAuthPayload),
  /** Executor scope to own the source. Defaults to the org scope. */
  scope: Schema.optional(Schema.String),
});

const OpenApiIntegration = Schema.Struct({
  kind: Schema.Literal("openapi"),
  name: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  /** The OpenAPI spec, as a JSON or YAML string. */
  spec: Schema.String,
  baseUrl: Schema.optional(Schema.String),
  headers: Schema.optional(UnknownMap),
  /** Executor scope to own the source. Defaults to the org scope. */
  scope: Schema.optional(Schema.String),
});

const Integration = Schema.Union(McpIntegration, OpenApiIntegration);

const BulkIntegrationsPayload = Schema.Struct({
  integrations: Schema.Array(Integration),
});

const IntegrationResult = Schema.Struct({
  kind: Schema.Literal("mcp", "openapi"),
  namespace: Schema.String,
  toolCount: Schema.Number,
  scope: Schema.String,
});

const BulkIntegrationsResponse = Schema.Struct({
  integrations: Schema.Array(IntegrationResult),
});

// ---------------------------------------------------------------------------
// Full-manifest one-shot
// ---------------------------------------------------------------------------

const ProvisionManifest = Schema.Struct({
  org: CreateOrgPayload,
  secrets: Schema.optional(Schema.Array(SecretInput)),
  integrations: Schema.optional(Schema.Array(Integration)),
});

const ProvisionResponse = Schema.Struct({
  org: CreateOrgResponse,
  secrets: Schema.Array(SecretResult),
  integrations: Schema.Array(IntegrationResult),
});

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export class ProvisionGroup extends HttpApiGroup.make("provision")
  .add(
    HttpApiEndpoint.post("createOrg")`/provision/orgs`
      .setPayload(CreateOrgPayload)
      .addSuccess(CreateOrgResponse)
      .addError(ProvisionError),
  )
  .add(
    HttpApiEndpoint.post("putSecrets")`/provision/orgs/${orgIdParam}/secrets`
      .setPayload(BulkSecretsPayload)
      .addSuccess(BulkSecretsResponse)
      .addError(ProvisionError),
  )
  .add(
    HttpApiEndpoint.post(
      "addIntegrations",
    )`/provision/orgs/${orgIdParam}/integrations`
      .setPayload(BulkIntegrationsPayload)
      .addSuccess(BulkIntegrationsResponse)
      .addError(ProvisionError),
  )
  .add(
    HttpApiEndpoint.post("provision")`/provision`
      .setPayload(ProvisionManifest)
      .addSuccess(ProvisionResponse)
      .addError(ProvisionError),
  )
  .addError(ProvisionUnauthorized)
  .middleware(ProvisionAuth) {}

export const ProvisionHttpApi = HttpApi.make("provision").add(ProvisionGroup);

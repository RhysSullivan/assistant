// ---------------------------------------------------------------------------
// Provisioning auth middleware.
//
// Current impl: compares the incoming bearer against a single shared env
// secret `PROVISION_API_TOKEN`. This is deliberately the smallest primitive
// that unblocks programmatic onboarding — the long-term answer is
// per-operator accounts with revocable, auditable tokens (TODO below).
//
// Why not WorkOS here: the whole point of this surface is being operable
// from a script with no browser session. WorkOS sealed sessions require
// cookie handling and an interactive login. Until we have proper operator
// accounts in WorkOS + a machine-token flow, a shared bearer is the
// honest primitive.
//
// TODO(operator-auth): replace env-backed shared bearer with per-operator
// tokens stored in WorkOS Vault (or equivalent) + an allowlist of operator
// principals. Endpoints here should then log the operator id on every
// mutation for audit purposes.
// ---------------------------------------------------------------------------

import { env } from "cloudflare:workers";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "@effect/platform";

export class ProvisionUnauthorized extends Schema.TaggedError<ProvisionUnauthorized>()(
  "ProvisionUnauthorized",
  {},
  HttpApiSchema.annotations({ status: 401 }),
) {}

export type ProvisionOperator = {
  /** Free-form operator id — today always `"shared"` because the env
   *  bearer carries no identity. Logged on every mutation so future
   *  migrations can keep the audit trail shape stable. */
  readonly operatorId: string;
};

export class ProvisionOperatorContext extends Context.Tag(
  "@executor/cloud/ProvisionOperator",
)<ProvisionOperatorContext, ProvisionOperator>() {}

export class ProvisionAuth extends HttpApiMiddleware.Tag<ProvisionAuth>()(
  "ProvisionAuth",
  {
    failure: ProvisionUnauthorized,
    provides: ProvisionOperatorContext,
    security: {
      bearer: HttpApiSecurity.bearer,
    },
  },
) {}

// ---------------------------------------------------------------------------
// Live — reads the shared env bearer at request time. Kept as a Layer
// factory so tests can swap in a token without touching `env`.
// ---------------------------------------------------------------------------

export const makeProvisionAuthLayer = (getConfiguredToken: () => string | null) =>
  Layer.succeed(
    ProvisionAuth,
    ProvisionAuth.of({
      bearer: (incoming) =>
        Effect.sync(() => {
          const configured = getConfiguredToken();
          if (!configured) return null;
          if (Redacted.value(incoming) !== configured) return null;
          return { operatorId: "shared" };
        }).pipe(
          Effect.flatMap((result) =>
            result ? Effect.succeed(result) : new ProvisionUnauthorized(),
          ),
        ),
    }),
  );

export const ProvisionAuthLive = makeProvisionAuthLayer(
  () => env.PROVISION_API_TOKEN ?? null,
);

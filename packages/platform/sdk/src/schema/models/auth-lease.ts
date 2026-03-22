import {
  Schema,
} from "effect";
import * as Option from "effect/Option";

import {
  TimestampMsSchema,
} from "../common";
import {
  ScopeIdSchema,
  AuthArtifactIdSchema,
  AuthLeaseIdSchema,
  SourceIdSchema,
} from "../ids";

import {
  AuthArtifactSlotSchema,
  RequestPlacementTemplatesJsonSchema,
  type RequestPlacementTemplate,
} from "./auth-artifact";

export const AuthLeaseSchema = Schema.Struct({
  id: AuthLeaseIdSchema,
  authArtifactId: AuthArtifactIdSchema,
  scopeId: ScopeIdSchema,
  sourceId: SourceIdSchema,
  actorScopeId: Schema.NullOr(ScopeIdSchema),
  slot: AuthArtifactSlotSchema,
  placementsTemplateJson: Schema.String,
  expiresAt: Schema.NullOr(TimestampMsSchema),
  refreshAfter: Schema.NullOr(TimestampMsSchema),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type AuthLease = typeof AuthLeaseSchema.Type;

const decodeLeasePlacementTemplatesOption = Schema.decodeUnknownOption(
  RequestPlacementTemplatesJsonSchema,
);

export const decodeAuthLeasePlacementTemplates = (
  lease: Pick<AuthLease, "placementsTemplateJson">,
): ReadonlyArray<RequestPlacementTemplate> | null => {
  const decoded = decodeLeasePlacementTemplatesOption(lease.placementsTemplateJson);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const authLeaseSecretRefs = (
  lease: Pick<AuthLease, "placementsTemplateJson">,
) =>
  (decodeAuthLeasePlacementTemplates(lease) ?? []).flatMap((placement) =>
    placement.parts.flatMap((part) => (part.kind === "secret_ref" ? [part.ref] : [])),
  );

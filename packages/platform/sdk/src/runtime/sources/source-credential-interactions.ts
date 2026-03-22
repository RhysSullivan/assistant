import {
  SecretRefSchema,
  type SecretRef,
} from "#schema";
import * as Schema from "effect/Schema";

export const SourceCredentialSelectionContentSchema = Schema.Union(
  Schema.Struct({
    authKind: Schema.Literal("none"),
  }),
  Schema.Struct({
    authKind: Schema.Literal("bearer"),
    tokenRef: SecretRefSchema,
  }),
);

export type SourceCredentialSelectionContent =
  typeof SourceCredentialSelectionContentSchema.Type;

export const decodeSourceCredentialSelectionContent = Schema.decodeUnknownSync(
  SourceCredentialSelectionContentSchema,
);

export const createSourceCredentialSelectionNoneContent =
  (): SourceCredentialSelectionContent => ({
    authKind: "none",
  });

export const createSourceCredentialSelectionBearerContent = (
  tokenRef: SecretRef,
): SourceCredentialSelectionContent => ({
  authKind: "bearer",
  tokenRef,
});

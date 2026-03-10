import type { CredentialSlot, Source, SourceAuth } from "#schema";
import * as Effect from "effect/Effect";

import type {
  ResolveSecretMaterial,
  SecretMaterialResolveContext,
} from "./secret-material-providers";

export type ResolvedSourceAuthMaterial = {
  headers: Readonly<Record<string, string>>;
};

export const resolveAuthMaterial = (input: {
  auth: SourceAuth;
  resolveSecretMaterial: ResolveSecretMaterial;
  context?: SecretMaterialResolveContext;
}): Effect.Effect<ResolvedSourceAuthMaterial, Error, never> =>
  Effect.gen(function* () {
    if (input.auth.kind === "none") {
      return { headers: {} } satisfies ResolvedSourceAuthMaterial;
    }

    const tokenRef =
      input.auth.kind === "bearer"
        ? input.auth.token
        : input.auth.accessToken;

    const token = yield* input.resolveSecretMaterial({
      ref: tokenRef,
      context: input.context,
    });

    return {
      headers: {
        [input.auth.headerName]: `${input.auth.prefix}${token}`,
      },
    } satisfies ResolvedSourceAuthMaterial;
  });

const authForSlot = (input: {
  source: Source;
  slot: CredentialSlot;
}): SourceAuth => {
  if (input.slot === "runtime") {
    return input.source.auth;
  }

  if (input.source.importAuthPolicy === "reuse_runtime") {
    return input.source.auth;
  }

  if (input.source.importAuthPolicy === "none") {
    return { kind: "none" };
  }

  return input.source.importAuth;
};

export const resolveSourceAuthMaterial = (input: {
  source: Source;
  slot?: CredentialSlot;
  resolveSecretMaterial: ResolveSecretMaterial;
  context?: SecretMaterialResolveContext;
}): Effect.Effect<ResolvedSourceAuthMaterial, Error, never> =>
  resolveAuthMaterial({
    auth: authForSlot({
      source: input.source,
      slot: input.slot ?? "runtime",
    }),
    resolveSecretMaterial: input.resolveSecretMaterial,
    context: input.context,
  });

import type { SqlControlPlaneRows } from "#persistence";
import type {
  Source,
} from "#schema";
import * as Effect from "effect/Effect";

import { resolveSourceAuthMaterial } from "./source-auth-material";
import {
  getSourceAdapterForSource,
} from "./source-adapters";
import { persistMcpRecipeRevisionFromManifestEntries } from "./source-adapters/mcp";
import type {
  ResolveSecretMaterial as ResolveSourceSecretMaterial,
} from "./secret-material-providers";
import { persistRecipeMaterialization } from "./source-recipe-support";

const shouldIndexSource = (source: Source): boolean =>
  source.enabled
  && source.status === "connected"
  && getSourceAdapterForSource(source).family !== "internal";

export const syncSourceMaterialization = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  resolveSecretMaterial: ResolveSourceSecretMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    if (!shouldIndexSource(input.source)) {
      return;
    }

    const adapter = getSourceAdapterForSource(input.source);
    const materialization = yield* adapter.materializeSource({
      source: input.source,
      resolveSecretMaterial: input.resolveSecretMaterial,
      resolveAuthMaterialForSlot: (slot) =>
        resolveSourceAuthMaterial({
          source: input.source,
          slot,
          resolveSecretMaterial: input.resolveSecretMaterial,
        }),
    });
    yield* persistRecipeMaterialization({
      rows: input.rows,
      source: input.source,
      materialization,
    });
  });

export const persistMcpRecipeMaterializationFromManifest = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: Parameters<
    typeof persistMcpRecipeRevisionFromManifestEntries
  >[0]["manifestEntries"];
}): Effect.Effect<void, Error, never> =>
  persistMcpRecipeRevisionFromManifestEntries(input);

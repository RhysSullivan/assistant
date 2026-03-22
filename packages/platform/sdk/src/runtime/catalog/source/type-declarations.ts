import type {
  Source,
} from "#schema";
import type {
  CatalogSnapshotV1,
} from "@executor/ir/model";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type BoundSourceDeclarationEntry = {
  source: Source;
  snapshot: CatalogSnapshotV1;
};

export type SourceTypeDeclarationsRefresherShape = {
  refreshWorkspaceInBackground: (input: {
    entries: readonly BoundSourceDeclarationEntry[];
  }) => Effect.Effect<void, never, never>;
  refreshSourceInBackground: (input: {
    source: Source;
    snapshot: CatalogSnapshotV1 | null;
  }) => Effect.Effect<void, never, never>;
};

export class SourceTypeDeclarationsRefresherService extends Context.Tag(
  "#runtime/SourceTypeDeclarationsRefresherService",
)<SourceTypeDeclarationsRefresherService, SourceTypeDeclarationsRefresherShape>() {}

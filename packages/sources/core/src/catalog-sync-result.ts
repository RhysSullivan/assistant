import { sha256Hex } from "@executor/codemode-core";
import { createCatalogSnapshotV1FromFragments } from "@executor/ir/catalog";
import type {
  CatalogFragmentV1,
  CatalogSnapshotV1,
  ImportMetadata,
} from "@executor/ir/model";

export const contentHash = (value: string): string => sha256Hex(value);

export type SourceCatalogSyncResult = {
  fragment: CatalogFragmentV1;
  importMetadata: ImportMetadata;
  sourceHash: string | null;
};

export const createSourceCatalogSyncResult = (
  input: SourceCatalogSyncResult,
): SourceCatalogSyncResult => input;

export const snapshotFromSourceCatalogSyncResult = (
  syncResult: SourceCatalogSyncResult,
): CatalogSnapshotV1 =>
  createCatalogSnapshotV1FromFragments({
    import: syncResult.importMetadata,
    fragments: [syncResult.fragment],
  });

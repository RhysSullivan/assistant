import {
  DocumentIdSchema,
  ScopeIdSchema,
  ShapeSymbolIdSchema,
} from "@executor/ir/ids";
import type { CatalogFragmentV1, EffectKind } from "@executor/ir/model";

export type CatalogSourceDocumentInput = {
  documentKind: string;
  documentKey: string;
  contentText: string;
  fetchedAt?: number | null;
};

export type BaseCatalogOperationInput = {
  toolId: string;
  title?: string | null;
  description?: string | null;
  effect: EffectKind;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type CatalogFragmentBuilder = {
  version: "ir.v1.fragment";
  documents: NonNullable<CatalogFragmentV1["documents"]>;
  resources: NonNullable<CatalogFragmentV1["resources"]>;
  scopes: NonNullable<CatalogFragmentV1["scopes"]>;
  symbols: NonNullable<CatalogFragmentV1["symbols"]>;
  capabilities: NonNullable<CatalogFragmentV1["capabilities"]>;
  executables: NonNullable<CatalogFragmentV1["executables"]>;
  responseSets: NonNullable<CatalogFragmentV1["responseSets"]>;
  diagnostics: NonNullable<CatalogFragmentV1["diagnostics"]>;
};

export type JsonSchemaImporter = {
  importSchema: (
    schema: unknown,
    key: string,
    rootSchema?: unknown,
  ) => ReturnType<typeof ShapeSymbolIdSchema.make>;
  finalize: () => void;
};

export type CatalogFragmentBuildContext = {
  catalog: CatalogFragmentBuilder;
  documentId: ReturnType<typeof DocumentIdSchema.make>;
  serviceScopeId: ReturnType<typeof ScopeIdSchema.make>;
  importer: JsonSchemaImporter;
};

export const EXECUTABLE_BINDING_VERSION = 1;

import * as Schema from "effect/Schema";

import {
  createSourceAdapterRegistry,
  type SourceAdapter,
} from "@executor/source-core";
import { googleDiscoverySourceAdapter } from "@executor/source-google-discovery";
import { graphqlSourceAdapter } from "@executor/source-graphql";
import { mcpSourceAdapter } from "@executor/source-mcp";
import { openApiSourceAdapter } from "@executor/source-openapi";

import { internalSourceAdapter } from "./internal";

export type * from "@executor/source-core";

export const builtInSourceAdapters = [
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
  mcpSourceAdapter,
  internalSourceAdapter,
] as const satisfies readonly SourceAdapter[];

export const connectableSourceAdapters = [
  mcpSourceAdapter,
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
] as const;

export const ConnectSourcePayloadSchema = Schema.Union(
  mcpSourceAdapter.connectPayloadSchema!,
  openApiSourceAdapter.connectPayloadSchema!,
  graphqlSourceAdapter.connectPayloadSchema!,
  googleDiscoverySourceAdapter.connectPayloadSchema!,
);

export type ConnectSourcePayload = typeof ConnectSourcePayloadSchema.Type;

export const executorAddableSourceAdapters = [
  mcpSourceAdapter,
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
] as const;

export const ExecutorAddSourceInputSchema = Schema.Union(
  mcpSourceAdapter.executorAddInputSchema!,
  openApiSourceAdapter.executorAddInputSchema!,
  graphqlSourceAdapter.executorAddInputSchema!,
  googleDiscoverySourceAdapter.executorAddInputSchema!,
);

export type ExecutorAddSourceInput = typeof ExecutorAddSourceInputSchema.Type;

const registry = createSourceAdapterRegistry(builtInSourceAdapters);

export const getSourceAdapter = registry.getSourceAdapter;
export const getSourceAdapterForSource = registry.getSourceAdapterForSource;
export const sourceBindingStateFromSource = registry.sourceBindingStateFromSource;
export const sourceAdapterCatalogKind = registry.sourceAdapterCatalogKind;
export const sourceAdapterRequiresInteractiveConnect =
  registry.sourceAdapterRequiresInteractiveConnect;
export const sourceAdapterUsesCredentialManagedAuth =
  registry.sourceAdapterUsesCredentialManagedAuth;
export const isInternalSourceAdapter = registry.isInternalSourceAdapter;

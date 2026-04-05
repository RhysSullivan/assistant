// Re-export effect-atom essentials so consumers don't need direct deps
export {
  Atom,
  AtomHttpApi,
  Result,
  RegistryContext,
  RegistryProvider,
  useAtom,
  useAtomMount,
  useAtomRefresh,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
} from "@effect-atom/atom-react";

// Base URL management
export { getBaseUrl, setBaseUrl } from "./base-url";

// Typed API client
export { ExecutorApiClient } from "./client";

// Query & mutation atoms
export {
  toolsAtom,
  sourceToolsAtom,
  toolSchemaAtom,
  sourcesAtom,
  sourceAtom,
  secretsAtom,
  secretStatusAtom,
  setSecret,
  resolveSecret,
  removeSecret,
  removeSource,
  refreshSource,
  detectSource,
} from "./atoms";

// Scope hook
export { useScope, useScopeInfo } from "./use-scope";
export type { ScopeInfo } from "./use-scope";

// Provider
export { ExecutorProvider } from "./provider";
export { SecretPicker } from "./secret-picker";
export type { SecretPickerSecret } from "./secret-picker";

// Re-export commonly needed SDK types
export { ScopeId, ToolId } from "@executor/sdk";
export type { ScopeId as ScopeIdType, ToolId as ToolIdType } from "@executor/sdk";

// Plugin contracts
export type { SourcePlugin, SourcePreset } from "./source-plugin";
export type { SecretProviderPlugin } from "./secret-provider-plugin";

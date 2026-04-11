// IDs
export { ScopeId, ToolId, SecretId, PolicyId } from "./ids";

// Errors
export {
  ToolNotFoundError,
  ToolInvocationError,
  SecretNotFoundError,
  SecretResolutionError,
  PolicyDeniedError,
} from "./errors";

// Tools
export {
  ToolMetadata,
  ToolSchema,
  ToolInvocationResult,
  ToolRegistry,
  ToolRegistration,
  ToolAnnotations,
  ToolListFilter,
  type ToolInvoker,
  type RuntimeToolHandler,
  type InvokeOptions,
} from "./tools";

// Sources
export {
  Source,
  SourceDetectionResult,
  SourceRegistry,
  makeInMemorySourceRegistry,
  type SourceManager,
} from "./sources";

// Elicitation
export {
  FormElicitation,
  UrlElicitation,
  ElicitationAction,
  ElicitationResponse,
  ElicitationDeclinedError,
  type ElicitationRequest,
  type ElicitationHandler,
  type ElicitationContext,
} from "./elicitation";

// Secrets
export { SecretRef, SetSecretInput, SecretManager, type SecretProvider } from "./secrets";

// Policies
export { Policy, PolicyAction, PolicyCheckInput, PolicyEngine } from "./policies";

// Scope
export { Scope } from "./scope";

// Plugin KV
export { type KvEntry, type ScopedKv } from "./plugin-kv";

// Stores (interfaces + row types + mappers + errors)
export type {
  ToolStore,
  ToolRow,
  ToolDefinitionRow,
  SecretStore,
  SecretRow,
  PolicyStore,
  PolicyRow,
  PluginKvStore,
  StoreError,
} from "./stores";
export {
  StoreQueryError,
  StoreNotFoundError,
  StoreConflictError,
  rowToToolRegistration,
  toolRegistrationToRow,
  rowToSecretRef,
  rowToPolicy,
  policyToRow,
} from "./stores";

// Service factories
export {
  makeToolRegistry,
  makeSecretManager,
  makePolicyEngine,
  makePluginKvFactory,
  encrypt,
  decrypt,
  type SecretManagerOptions,
} from "./services";

// Schema ref utilities
export { hoistDefinitions, collectRefs, reattachDefs, normalizeRefs } from "./schema-refs";
export {
  schemaToTypeScriptPreview,
  schemaToTypeScriptPreviewWithDefs,
  buildToolTypeScriptPreview,
  type TypeScriptRenderOptions,
  type TypeScriptSchemaPreview,
} from "./schema-types";

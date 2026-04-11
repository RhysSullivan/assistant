// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

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

// Scope
export { Scope } from "./scope";

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

// Plugin KV (ScopedKv type returned by `ctx.pluginKv(namespace)`)
export { type KvEntry, type ScopedKv } from "./plugin-kv";

// Schema ref + TypeScript preview utilities
export { hoistDefinitions, collectRefs, reattachDefs, normalizeRefs } from "./schema-refs";
export {
  schemaToTypeScriptPreview,
  schemaToTypeScriptPreviewWithDefs,
  buildToolTypeScriptPreview,
  type TypeScriptRenderOptions,
  type TypeScriptSchemaPreview,
} from "./schema-types";

// ---------------------------------------------------------------------------
// Store contracts (adapters implement these)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Plugin system
// ---------------------------------------------------------------------------

export {
  definePlugin,
  type ExecutorPlugin,
  type PluginContext,
  type PluginHandle,
  type PluginExtensions,
} from "./plugin";

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export {
  createExecutor,
  type Executor,
  type ExecutorConfig,
  type ExecutorStores,
  type ExecutorAuthProvider,
} from "./executor";

// Runtime tools
export {
  registerRuntimeTools,
  runtimeTool,
  type RuntimeSourceDefinition,
  type RuntimeToolDefinition,
} from "./runtime-tools";

// Built-in plugins
export {
  inMemoryToolsPlugin,
  tool,
  type MemoryToolDefinition,
  type MemoryToolContext,
  type MemoryToolSdkAccess,
  type InMemoryToolsPluginExtension,
} from "./plugins/in-memory-tools";

// NOTE: service factories (`makeToolRegistry`, `makeSecretManager`,
// `makePolicyEngine`, `makePluginKvFactory`) and crypto helpers
// (`encrypt`, `decrypt`) are INTERNAL to sdk — not exported.
// `createExecutor` wraps stores into services on behalf of callers.

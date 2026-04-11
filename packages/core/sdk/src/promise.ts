// Executor
export {
  createExecutor,
  type Executor,
  type ExecutorConfig,
  type AnyPlugin,
} from "./promise-executor";

// Plugin
export {
  definePlugin,
  type Plugin,
  type PluginContext,
  type PluginHandle,
} from "./promise-executor";

// Plugin context services
export type { ToolRegistry, SourceRegistry, SecretStore, PolicyEngine } from "./promise-executor";

// Plugin callback types
export type {
  ToolInvoker,
  RuntimeToolHandler,
  SourceManager,
  SecretProvider,
} from "./promise-executor";

// Invocation
export type { InvokeOptions, ElicitationHandler, ElicitationResponse } from "./promise-executor";

// Re-export data classes from the Effect core that users need
export {
  ToolRegistration,
  ToolInvocationResult,
  ToolMetadata,
  ToolSchema,
  ToolAnnotations,
  ToolListFilter,
} from "./tools";
export { ToolId, SecretId, ScopeId, PolicyId } from "./ids";
export { Source, SourceDetectionResult } from "./sources";
export { SecretRef } from "./secrets";
export { Policy } from "./policies";
export { Scope } from "./scope";
export {
  FormElicitation,
  UrlElicitation,
  ElicitationDeclinedError,
  type ElicitationContext,
  type ElicitationRequest,
} from "./elicitation";
export {
  ToolNotFoundError,
  ToolInvocationError,
  SecretNotFoundError,
  SecretResolutionError,
  PolicyDeniedError,
} from "./errors";

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
  type ToolRegistration,
  type ToolInvoker,
  type InvokeOptions,
} from "./tools";

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
export { Secret, SecretStore } from "./secrets";

// Policies
export { Policy, PolicyAction, PolicyEngine } from "./policies";

// Scope
export { Scope } from "./scope";

// Plugin
export {
  definePlugin,
  type ExecutorPlugin,
  type PluginContext,
  type PluginHandle,
  type PluginExtensions,
} from "./plugin";

// Executor
export {
  createExecutor,
  type Executor,
  type ExecutorConfig,
} from "./executor";

// Built-in plugins
export {
  inMemoryToolsPlugin,
  tool,
  type MemoryToolDefinition,
  type MemoryToolContext,
  type MemoryToolSdkAccess,
  type InMemoryToolsPluginExtension,
} from "./plugins/in-memory-tools";

// Schema ref utilities
export { hoistDefinitions, collectRefs, reattachDefs } from "./schema-refs";

// In-memory implementations
export { makeInMemoryToolRegistry } from "./in-memory/tool-registry";
export { makeInMemorySecretStore } from "./in-memory/secret-store";
export { makeInMemoryPolicyEngine } from "./in-memory/policy-engine";

// Testing
export { makeTestConfig } from "./testing";

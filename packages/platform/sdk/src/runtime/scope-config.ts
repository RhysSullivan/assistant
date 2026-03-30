import type {
  ExecutorScopeConfig,
} from "#schema";

export type LoadedExecutorConfig = {
  config: ExecutorScopeConfig | null;
  homeConfig: ExecutorScopeConfig | null;
  projectConfig: ExecutorScopeConfig | null;
};

export type LoadedExecutorScopeConfig = LoadedExecutorConfig;

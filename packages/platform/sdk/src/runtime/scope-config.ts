import type {
  LocalExecutorConfig,
} from "#schema";

export type LoadedExecutorConfig = {
  config: LocalExecutorConfig | null;
  homeConfig: LocalExecutorConfig | null;
  projectConfig: LocalExecutorConfig | null;
};

export type LoadedLocalExecutorConfig = LoadedExecutorConfig;

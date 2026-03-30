import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { FileSystem } from "@effect/platform";

import {
  type ExecutorScopeConfig,
  type ExecutorScopeConfigPolicy,
  type ExecutorScopeConfigSource,
} from "@executor/platform-sdk/schema";
import type { LoadedExecutorScopeConfig } from "@executor/platform-sdk/runtime";
import * as Effect from "effect/Effect";
import {
  decodeExecutorScopeConfig,
  encodeExecutorScopeConfig,
  parseExecutorScopeConfig,
} from "./config-codec";
import {
  ExecutorScopeConfigDecodeError,
  LocalFileSystemError,
  unknownLocalErrorDetails,
} from "./errors";

export type FileLoadedExecutorConfig = LoadedExecutorScopeConfig & {
  homeConfigPath: string;
  projectConfigPath: string;
};

export const resolveConfigRelativePath = (input: {
  path: string;
  scopeRoot: string;
}): string => {
  const trimmed = input.path.trim();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(input.scopeRoot, trimmed);
};

export type { LoadedExecutorScopeConfig } from "@executor/platform-sdk/runtime";
export { encodeExecutorScopeConfig } from "./config-codec";

const PROJECT_CONFIG_BASENAME = "executor.jsonc";
const PROJECT_CONFIG_DIRECTORY = ".executor";
const EXECUTOR_CONFIG_DIR_ENV = "EXECUTOR_CONFIG_DIR";
const EXECUTOR_STATE_DIR_ENV = "EXECUTOR_STATE_DIR";

const mapFileSystemError = (path: string, action: string) => (cause: unknown) =>
  new LocalFileSystemError({
    message: `Failed to ${action} ${path}: ${unknownLocalErrorDetails(cause)}`,
    action,
    path,
    details: unknownLocalErrorDetails(cause),
  });

const trimOrUndefined = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const defaultExecutorConfigDirectory = (input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
} = {}): string => {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDirectory = input.homeDirectory ?? homedir();
  const explicitConfigDirectory = trimOrUndefined(env[EXECUTOR_CONFIG_DIR_ENV]);

  if (explicitConfigDirectory) {
    return explicitConfigDirectory;
  }

  if (platform === "win32") {
    return join(
      trimOrUndefined(env.LOCALAPPDATA) ?? join(homeDirectory, "AppData", "Local"),
      "Executor",
    );
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Executor");
  }

  return join(
    trimOrUndefined(env.XDG_CONFIG_HOME) ?? join(homeDirectory, ".config"),
    "executor",
  );
};

const defaultExecutorStateDirectory = (input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
} = {}): string => {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDirectory = input.homeDirectory ?? homedir();
  const explicitStateDirectory = trimOrUndefined(env[EXECUTOR_STATE_DIR_ENV]);

  if (explicitStateDirectory) {
    return explicitStateDirectory;
  }

  if (platform === "win32") {
    return join(
      trimOrUndefined(env.LOCALAPPDATA) ?? join(homeDirectory, "AppData", "Local"),
      "Executor",
      "State",
    );
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Executor", "State");
  }

  return join(
    trimOrUndefined(env.XDG_STATE_HOME) ?? join(homeDirectory, ".local", "state"),
    "executor",
  );
};

export const resolveDefaultHomeConfigCandidates = (input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
} = {}): string[] => {
  const directory = defaultExecutorConfigDirectory({
    env: input.env,
    platform: input.platform,
    homeDirectory: input.homeDirectory ?? homedir(),
  });
  return [join(directory, PROJECT_CONFIG_BASENAME)];
};

export const resolveHomeConfigPath = (input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
} = {}): Effect.Effect<string, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = resolveDefaultHomeConfigCandidates(input);

    for (const candidate of candidates) {
      const exists = yield* fs.exists(candidate).pipe(
        Effect.mapError(mapFileSystemError(candidate, "check config path")),
      );
      if (exists) {
        return candidate;
      }
    }

    return candidates[0]!;
  });

export const resolveDefaultHomeStateDirectory = (input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
} = {}): string =>
  defaultExecutorStateDirectory(input);

const mergeSourceMaps = (
  base: Record<string, ExecutorScopeConfigSource> | undefined,
  extra: Record<string, ExecutorScopeConfigSource> | undefined,
): Record<string, ExecutorScopeConfigSource> | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...base,
    ...extra,
  };
};

const mergePolicyMaps = (
  base: Record<string, ExecutorScopeConfigPolicy> | undefined,
  extra: Record<string, ExecutorScopeConfigPolicy> | undefined,
): Record<string, ExecutorScopeConfigPolicy> | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...base,
    ...extra,
  };
};

export const mergeExecutorScopeConfigs = (
  base: ExecutorScopeConfig | null,
  extra: ExecutorScopeConfig | null,
): ExecutorScopeConfig | null => {
  if (!base && !extra) {
    return null;
  }

  return decodeExecutorScopeConfig({
    runtime: extra?.runtime ?? base?.runtime,
    workspace: {
      ...base?.workspace,
      ...extra?.workspace,
    },
    sources: mergeSourceMaps(base?.sources, extra?.sources),
    policies: mergePolicyMaps(base?.policies, extra?.policies),
  });
};

const resolveProjectConfigPathEffect = (workspaceRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const jsoncPath = join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_BASENAME);
    yield* fs.exists(jsoncPath).pipe(
      Effect.mapError(mapFileSystemError(jsoncPath, "check project config path")),
    );
    return jsoncPath;
  });

const hasProjectConfigEffect = (workspaceRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const jsoncPath = join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_BASENAME);
    return yield* fs.exists(jsoncPath).pipe(
      Effect.mapError(mapFileSystemError(jsoncPath, "check project config path")),
    );
  });

const resolveWorkspaceRootFromCwdEffect = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let current = resolve(cwd);
    let nearestProjectConfigRoot: string | null = null;
    let nearestGitRoot: string | null = null;

    while (true) {
      if (nearestProjectConfigRoot === null) {
        const hasProjectConfig = yield* hasProjectConfigEffect(current);
        if (hasProjectConfig) {
          nearestProjectConfigRoot = current;
        }
      }

      if (nearestGitRoot === null) {
        const gitPath = join(current, ".git");
        const gitExists = yield* fs.exists(gitPath).pipe(
          Effect.mapError(mapFileSystemError(gitPath, "check git root")),
        );
        if (gitExists) {
          nearestGitRoot = current;
        }
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return nearestProjectConfigRoot ?? nearestGitRoot ?? resolve(cwd);
  });

export type ResolvedLocalWorkspaceContext = {
  cwd: string;
  workspaceRoot: string;
  workspaceName: string;
  configDirectory: string;
  projectConfigPath: string;
  homeConfigPath: string;
  homeStateDirectory: string;
  artifactsDirectory: string;
  stateDirectory: string;
};

export const resolveLocalWorkspaceContext = (input: {
  cwd?: string;
  workspaceRoot?: string;
  homeConfigPath?: string;
  homeStateDirectory?: string;
} = {}): Effect.Effect<
  ResolvedLocalWorkspaceContext,
  LocalFileSystemError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const cwd = resolve(input.cwd ?? process.cwd());
    const workspaceRoot = resolve(
      input.workspaceRoot ?? (yield* resolveWorkspaceRootFromCwdEffect(cwd)),
    );
    const workspaceName = basename(workspaceRoot) || "workspace";
    const projectConfigPath = yield* resolveProjectConfigPathEffect(workspaceRoot);
    const homeConfigPath = resolve(
      input.homeConfigPath ?? (yield* resolveHomeConfigPath()),
    );
    const homeStateDirectory = resolve(
      input.homeStateDirectory ?? resolveDefaultHomeStateDirectory(),
    );

    return {
      cwd,
      workspaceRoot,
      workspaceName,
      configDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY),
      projectConfigPath,
      homeConfigPath,
      homeStateDirectory,
      artifactsDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, "artifacts"),
      stateDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, "state"),
    };
  });

export const readOptionalExecutorScopeConfig = (
  path: string,
): Effect.Effect<
  ExecutorScopeConfig | null,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError(mapFileSystemError(path, "check config path")),
    );
    if (!exists) {
      return null;
    }

    const content = yield* fs.readFileString(path, "utf8").pipe(
      Effect.mapError(mapFileSystemError(path, "read config")),
    );
    return yield* Effect.try({
      try: () => parseExecutorScopeConfig({ path, content }),
      catch: (cause) =>
        cause instanceof ExecutorScopeConfigDecodeError
          ? cause
          : new ExecutorScopeConfigDecodeError({
              message: `Invalid executor config at ${path}: ${unknownLocalErrorDetails(cause)}`,
              path,
              details: unknownLocalErrorDetails(cause),
            }),
    });
  });

export const loadExecutorScopeConfig = (
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<
  FileLoadedExecutorConfig,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const [homeConfig, projectConfig] = yield* Effect.all([
      readOptionalExecutorScopeConfig(context.homeConfigPath),
      readOptionalExecutorScopeConfig(context.projectConfigPath),
    ]);

    return {
      config: mergeExecutorScopeConfigs(homeConfig, projectConfig),
      homeConfig,
      projectConfig,
      homeConfigPath: context.homeConfigPath,
      projectConfigPath: context.projectConfigPath,
    };
  });

export const writeProjectExecutorScopeConfig = (input: {
  context: ResolvedLocalWorkspaceContext;
  config: ExecutorScopeConfig;
}): Effect.Effect<void, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(input.context.configDirectory, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(input.context.configDirectory, "create config directory")),
    );
    yield* fs.writeFileString(
      input.context.projectConfigPath,
      encodeExecutorScopeConfig(input.config),
    ).pipe(
      Effect.mapError(mapFileSystemError(input.context.projectConfigPath, "write config")),
    );
  });

export const defaultWorkspaceDisplayName = (context: ResolvedLocalWorkspaceContext): string =>
  trimOrUndefined(context.workspaceName) ?? "workspace";

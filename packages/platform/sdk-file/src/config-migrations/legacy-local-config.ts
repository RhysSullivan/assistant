import { FileSystem } from "@effect/platform";
import {
  type ExecutorScopeConfigSource,
  type ExecutorScopeConfig,
} from "@executor/platform-sdk/schema";
import * as Effect from "effect/Effect";
import {
  decodeExecutorScopeConfig,
  encodeExecutorScopeConfig,
  parseJsoncValue,
} from "../config-codec";
import {
  ExecutorScopeConfigDecodeError,
  LocalFileSystemError,
  unknownLocalErrorDetails,
} from "../errors";

const LEGACY_CONFIG_BACKUP_SUFFIX = ".legacy-backup";

const mapFileSystemError = (path: string, action: string) => (cause: unknown) =>
  new LocalFileSystemError({
    message: `Failed to ${action} ${path}: ${unknownLocalErrorDetails(cause)}`,
    action,
    path,
    details: unknownLocalErrorDetails(cause),
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringArray = (value: unknown): Array<string> | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);

  return normalized.length > 0 ? normalized : [];
};

const asStringRecord = (value: unknown): Record<string, string> | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const normalized = Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const normalizedKey = asString(key);
      const normalizedValue = asString(entry);
      return normalizedKey && normalizedValue
        ? [[normalizedKey, normalizedValue]]
        : [];
    }),
  );

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asSecretRef = (value: unknown): { secretId: string } | null => {
  const record = asRecord(value);
  const secretId = asString(record?.secretId);
  return secretId ? { secretId } : null;
};

const normalizeLegacyHeaderName = (value: unknown): string | null =>
  asString(value);

const normalizeLegacyMcpTransport = (
  value: unknown,
): "streamable-http" | "sse" | "stdio" | "auto" | null => {
  const candidate = asString(value);
  return candidate === "streamable-http"
    || candidate === "sse"
    || candidate === "stdio"
    || candidate === "auto"
    ? candidate
    : null;
};

const defaultGoogleDiscoveryUrl = (
  service: string,
  version: string,
): string =>
  `https://www.googleapis.com/discovery/v1/apis/${encodeURIComponent(service)}/${encodeURIComponent(version)}/rest`;

const legacyMigrationError = (input: {
  path: string;
  sourceId: string;
  details: string;
}) =>
  new ExecutorScopeConfigDecodeError({
    message: `Unsupported legacy executor config at ${input.path} for source ${input.sourceId}: ${input.details}`,
    path: input.path,
    details: input.details,
  });

const normalizeCurrentSourceBase = (
  source: Record<string, unknown>,
): Omit<ExecutorScopeConfigSource, "kind" | "config"> => ({
  ...(asString(source.name) ? { name: asString(source.name)! } : {}),
  ...(asString(source.namespace) ? { namespace: asString(source.namespace)! } : {}),
  ...(asBoolean(source.enabled) !== null ? { enabled: source.enabled as boolean } : {}),
});

const normalizeLegacyBearerAuth = (input: {
  path: string;
  sourceId: string;
  value: unknown;
}) => {
  const record = asRecord(input.value);
  const kind = asString(record?.kind);

  if (input.value === undefined || kind === "none") {
    return { kind: "none" } as const;
  }

  const tokenSecretRef = asSecretRef(record?.tokenSecretRef ?? input.value);
  if (!tokenSecretRef) {
    throw legacyMigrationError({
      path: input.path,
      sourceId: input.sourceId,
      details:
        "legacy bearer auth references config providers and cannot be auto-migrated yet",
    });
  }

  return {
    kind: "bearer" as const,
    tokenSecretRef,
    headerName: normalizeLegacyHeaderName(record?.headerName),
    prefix: asString(record?.prefix),
  };
};

const normalizeLegacyMcpAuth = (input: {
  path: string;
  sourceId: string;
  value: unknown;
}) => {
  const record = asRecord(input.value);
  const kind = asString(record?.kind);

  if (input.value === undefined || kind === "none") {
    return { kind: "none" } as const;
  }

  if (kind !== "oauth2") {
    throw legacyMigrationError({
      path: input.path,
      sourceId: input.sourceId,
      details: "legacy MCP auth is not compatible with the current config format",
    });
  }

  const accessTokenRef = asSecretRef(record?.accessTokenRef);
  const redirectUri = asString(record?.redirectUri);
  if (!accessTokenRef || !redirectUri) {
    throw legacyMigrationError({
      path: input.path,
      sourceId: input.sourceId,
      details: "legacy MCP oauth2 auth is missing required secret refs",
    });
  }

  return {
    kind: "oauth2" as const,
    redirectUri,
    accessTokenRef,
    refreshTokenRef: asSecretRef(record?.refreshTokenRef),
    tokenType: asString(record?.tokenType) ?? "Bearer",
    expiresAt: asFiniteNumber(record?.expiresAt),
    scope: asString(record?.scope),
    resourceMetadataUrl: asString(record?.resourceMetadataUrl),
    authorizationServerUrl: asString(record?.authorizationServerUrl),
    resourceMetadata: asRecord(record?.resourceMetadata),
    authorizationServerMetadata: asRecord(record?.authorizationServerMetadata),
    clientInformation: asRecord(record?.clientInformation),
  };
};

const normalizeLegacyGoogleDiscoveryAuth = (input: {
  path: string;
  sourceId: string;
  value: unknown;
}) => {
  const record = asRecord(input.value);
  const kind = asString(record?.kind);

  if (kind === "oauth2") {
    const clientId = asString(record?.clientId);
    const authorizationEndpoint = asString(record?.authorizationEndpoint);
    const tokenEndpoint = asString(record?.tokenEndpoint);
    const accessTokenRef = asSecretRef(record?.accessTokenRef);

    if (!clientId || !authorizationEndpoint || !tokenEndpoint || !accessTokenRef) {
      throw legacyMigrationError({
        path: input.path,
        sourceId: input.sourceId,
        details: "legacy Google Discovery oauth2 auth is missing required secret refs",
      });
    }

    const clientAuthentication =
      asString(record?.clientAuthentication) === "client_secret_post"
        ? "client_secret_post"
        : "none";

    return {
      kind: "oauth2" as const,
      clientId,
      clientSecretRef: asSecretRef(record?.clientSecretRef),
      clientAuthentication,
      authorizationEndpoint,
      tokenEndpoint,
      scopes: asStringArray(record?.scopes) ?? [],
      accessTokenRef,
      refreshTokenRef: asSecretRef(record?.refreshTokenRef),
      expiresAt: asFiniteNumber(record?.expiresAt),
    };
  }

  return normalizeLegacyBearerAuth(input);
};

const normalizeSourceRecord = (input: {
  path: string;
  sourceId: string;
  source: Record<string, unknown>;
}): {
  source: ExecutorScopeConfigSource | Record<string, unknown>;
  migrated: boolean;
} => {
  const kind = asString(input.source.kind);
  const config = input.source.config;
  const connection = asRecord(input.source.connection);
  const binding = asRecord(input.source.binding);
  const base = normalizeCurrentSourceBase(input.source);

  if (config !== undefined) {
    return {
      source: {
        ...base,
        ...(kind ? { kind } : {}),
        config,
      },
      migrated:
        Object.prototype.hasOwnProperty.call(input.source, "connection")
        || Object.prototype.hasOwnProperty.call(input.source, "binding"),
    };
  }

  if (!kind || (connection === null && binding === null)) {
    return {
      source: input.source,
      migrated: false,
    };
  }

  switch (kind) {
    case "openapi": {
      const baseUrl = asString(connection?.endpoint);
      const specUrl = asString(binding?.specUrl) ?? baseUrl;
      if (!specUrl) {
        return {
          source: input.source,
          migrated: false,
        };
      }

      return {
        source: {
          ...base,
          kind: "openapi",
          config: {
            specUrl,
            baseUrl,
            auth: normalizeLegacyBearerAuth({
              path: input.path,
              sourceId: input.sourceId,
              value: connection?.auth,
            }),
            defaultHeaders: asStringRecord(binding?.defaultHeaders),
          },
        },
        migrated: true,
      };
    }

    case "graphql": {
      const endpoint = asString(connection?.endpoint);
      if (!endpoint) {
        return {
          source: input.source,
          migrated: false,
        };
      }

      return {
        source: {
          ...base,
          kind: "graphql",
          config: {
            endpoint,
            defaultHeaders: asStringRecord(binding?.defaultHeaders),
            auth: normalizeLegacyBearerAuth({
              path: input.path,
              sourceId: input.sourceId,
              value: connection?.auth,
            }),
          },
        },
        migrated: true,
      };
    }

    case "mcp":
      return {
        source: {
          ...base,
          kind: "mcp",
          config: {
            endpoint: asString(connection?.endpoint),
            transport: normalizeLegacyMcpTransport(binding?.transport),
            queryParams: asStringRecord(binding?.queryParams),
            headers: asStringRecord(binding?.headers),
            command: asString(binding?.command),
            args: asStringArray(binding?.args),
            env: asStringRecord(binding?.env),
            cwd: asString(binding?.cwd),
            auth: normalizeLegacyMcpAuth({
              path: input.path,
              sourceId: input.sourceId,
              value: connection?.auth,
            }),
          },
        },
        migrated: true,
      };

    case "google_discovery": {
      const service = asString(binding?.service);
      const version = asString(binding?.version);
      if (!service || !version) {
        return {
          source: input.source,
          migrated: false,
        };
      }

      return {
        source: {
          ...base,
          kind: "google_discovery",
          config: {
            service,
            version,
            discoveryUrl:
              asString(binding?.discoveryUrl)
              ?? asString(connection?.endpoint)
              ?? defaultGoogleDiscoveryUrl(service, version),
            defaultHeaders: asStringRecord(binding?.defaultHeaders),
            scopes: asStringArray(binding?.scopes) ?? [],
            auth: normalizeLegacyGoogleDiscoveryAuth({
              path: input.path,
              sourceId: input.sourceId,
              value: connection?.auth,
            }),
          },
        },
        migrated: true,
      };
    }

    default:
      return {
        source: input.source,
        migrated: false,
      };
  }
};

const migrateLegacyExecutorConfigValue = (input: {
  path: string;
  value: unknown;
}): {
  config: ExecutorScopeConfig;
  migrated: boolean;
} => {
  const root = asRecord(input.value);
  if (root === null) {
    return {
      config: decodeExecutorScopeConfig(input.value),
      migrated: false,
    };
  }

  let migrated = Object.prototype.hasOwnProperty.call(root, "secrets");
  const rawSources = asRecord(root.sources);
  const sources = rawSources
    ? Object.fromEntries(
        Object.entries(rawSources).map(([sourceId, sourceValue]) => {
          const sourceRecord = asRecord(sourceValue);
          if (sourceRecord === null) {
            return [sourceId, sourceValue];
          }

          const normalized = normalizeSourceRecord({
            path: input.path,
            sourceId,
            source: sourceRecord,
          });
          migrated ||= normalized.migrated;
          return [sourceId, normalized.source];
        }),
      )
    : root.sources;

  return {
    config: decodeExecutorScopeConfig({
      ...(root.runtime !== undefined ? { runtime: root.runtime } : {}),
      ...(root.workspace !== undefined ? { workspace: root.workspace } : {}),
      ...(sources !== undefined ? { sources } : {}),
      ...(root.policies !== undefined ? { policies: root.policies } : {}),
    }),
    migrated,
  };
};

const migrateLegacyExecutorConfigFile = (
  path: string,
): Effect.Effect<
  boolean,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError(mapFileSystemError(path, "check config path")),
    );
    if (!exists) {
      return false;
    }

    const content = yield* fs.readFileString(path, "utf8").pipe(
      Effect.mapError(mapFileSystemError(path, "read config")),
    );
    const parsed = yield* Effect.try({
      try: () =>
        parseJsoncValue({
          path,
          content,
        }),
      catch: (cause) =>
        cause instanceof ExecutorScopeConfigDecodeError
          ? cause
          : new ExecutorScopeConfigDecodeError({
              message: `Invalid executor config at ${path}: ${unknownLocalErrorDetails(cause)}`,
              path,
              details: unknownLocalErrorDetails(cause),
            }),
    });
    const migrated = yield* Effect.try({
      try: () =>
        migrateLegacyExecutorConfigValue({
          path,
          value: parsed,
        }),
      catch: (cause) =>
        cause instanceof ExecutorScopeConfigDecodeError
          ? cause
          : new ExecutorScopeConfigDecodeError({
              message: `Invalid executor config at ${path}: ${unknownLocalErrorDetails(cause)}`,
              path,
              details: unknownLocalErrorDetails(cause),
            }),
    });

    if (!migrated.migrated) {
      return false;
    }

    const backupPath = `${path}${LEGACY_CONFIG_BACKUP_SUFFIX}`;
    const backupExists = yield* fs.exists(backupPath).pipe(
      Effect.mapError(mapFileSystemError(backupPath, "check backup path")),
    );
    if (!backupExists) {
      yield* fs.writeFileString(backupPath, content).pipe(
        Effect.mapError(mapFileSystemError(backupPath, "write legacy config backup")),
      );
    }

    yield* fs.writeFileString(path, encodeExecutorScopeConfig(migrated.config)).pipe(
      Effect.mapError(mapFileSystemError(path, "write migrated config")),
    );

    return true;
  });

export type StartupConfigMigrationContext = {
  homeConfigPath: string;
  projectConfigPath: string;
};

export const migrateLegacyExecutorScopeConfigs = (
  context: StartupConfigMigrationContext,
): Effect.Effect<
  ReadonlyArray<string>,
  LocalFileSystemError | ExecutorScopeConfigDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const migratedPaths: Array<string> = [];
    const paths = [...new Set([context.homeConfigPath, context.projectConfigPath])];

    for (const path of paths) {
      const migrated = yield* migrateLegacyExecutorConfigFile(path);
      if (migrated) {
        migratedPaths.push(path);
      }
    }

    return migratedPaths;
  });

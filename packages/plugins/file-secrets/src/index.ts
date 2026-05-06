import { Effect, Predicate, Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  definePlugin,
  StorageError,
  type PluginCtx,
  type SecretProvider,
} from "@executor-js/sdk/core";

// ---------------------------------------------------------------------------
// XDG data dir resolution
// ---------------------------------------------------------------------------

const APP_NAME = "executor";

export const xdgDataHome = (): string => {
  if (process.env.XDG_DATA_HOME?.trim()) return process.env.XDG_DATA_HOME.trim();
  if (process.platform === "win32") {
    return (
      process.env.LOCALAPPDATA ||
      process.env.APPDATA ||
      path.join(process.env.USERPROFILE || "~", "AppData", "Local")
    );
  }
  return path.join(process.env.HOME || "~", ".local", "share");
};

const authDir = (overrideDir?: string): string => overrideDir ?? path.join(xdgDataHome(), APP_NAME);

const authFilePath = (overrideDir?: string): string => path.join(authDir(overrideDir), "auth.json");

// ---------------------------------------------------------------------------
// Schema for the auth file
//
// Top-level keys are scope IDs, values are { secretId: secretValue } maps.
//   { "web-a1b2c3d4": { "github-token": "ghp_xxx" } }
// ---------------------------------------------------------------------------

const ScopedAuthFile = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String));
const decodeScopedAuthFileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ScopedAuthFile));

// ---------------------------------------------------------------------------
// File I/O with restricted permissions
//
// These helpers keep I/O and auth.json parsing in the Effect error channel.
// Missing files are still treated as an empty auth file, but JSON parse
// errors, schema decode failures, and permission errors surface as typed
// `StorageError`s instead of silently returning null from every `get`.
// ---------------------------------------------------------------------------

const isEnoent = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && cause.code === "ENOENT";

const readFullFile = (
  filePath: string,
): Effect.Effect<Record<string, Record<string, string>>, StorageError> => {
  if (!fs.existsSync(filePath)) return Effect.succeed({});

  return Effect.try({
    try: () => fs.readFileSync(filePath, "utf-8"),
    catch: (cause) => new StorageError({ message: "Failed to read file secrets auth file", cause }),
  }).pipe(
    Effect.catchIf(
      (error) => isEnoent(error.cause),
      () => Effect.succeed(""),
    ),
    Effect.flatMap((raw) =>
      raw
        ? decodeScopedAuthFileJson(raw).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({ message: "Failed to parse file secrets auth file", cause }),
            ),
          )
        : Effect.succeed({}),
    ),
  );
};

const readScopeSecrets = (
  filePath: string,
  scopeId: string,
): Effect.Effect<Record<string, string>, StorageError> =>
  Effect.map(readFullFile(filePath), (file) => file[scopeId] ?? {});

const writeScopeSecrets = (
  filePath: string,
  scopeId: string,
  secrets: Record<string, string>,
): Effect.Effect<void, StorageError> =>
  Effect.gen(function* () {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      yield* Effect.try({
        try: () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }),
        catch: (cause) =>
          new StorageError({ message: "Failed to create file secrets directory", cause }),
      });
    }
    const full = yield* readFullFile(filePath);
    if (Object.keys(secrets).length === 0) {
      delete full[scopeId];
    } else {
      full[scopeId] = secrets;
    }
    const tmp = `${filePath}.tmp`;
    yield* Effect.try({
      try: () => {
        fs.writeFileSync(tmp, JSON.stringify(full, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, filePath);
      },
      catch: (cause) =>
        new StorageError({ message: "Failed to write file secrets auth file", cause }),
    });
  });

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

export interface FileSecretsPluginConfig {
  /** Override the directory for auth.json (default: XDG data dir) */
  readonly directory?: string;
}

// ---------------------------------------------------------------------------
// Plugin extension — public API on executor.fileSecrets
// ---------------------------------------------------------------------------

export interface FileSecretsExtension {
  /** Path to the auth file */
  readonly filePath: string;
}

// ---------------------------------------------------------------------------
// Provider factory (internal)
// ---------------------------------------------------------------------------

// Scope arg is honored at every call: the auth.json is partitioned by
// scope id, so read/write/delete route to `file[scope][secretId]`. The
// provider is a singleton per executor; scope routing happens via the
// arg passed from the executor's secrets facade.
//
// `list` enumerates the innermost scope the provider was configured
// for — the executor's fallback/list path passes scope separately but
// the SecretProvider.list signature is scope-agnostic. That's fine for
// the current use: `list` feeds `secrets.list()` which already walks
// the stack at the caller layer. Innermost-first is the display default.
const makeScopedProvider = (filePath: string, listScope: string): SecretProvider => ({
  key: "file",
  writable: true,

  get: (secretId, scope) =>
    Effect.map(readScopeSecrets(filePath, scope), (data) => data[secretId] ?? null),

  has: (secretId, scope) =>
    Effect.map(readScopeSecrets(filePath, scope), (data) => secretId in data),

  set: (secretId, value, scope) =>
    Effect.gen(function* () {
      const data = yield* readScopeSecrets(filePath, scope);
      data[secretId] = value;
      yield* writeScopeSecrets(filePath, scope, data);
    }),

  delete: (secretId, scope) =>
    Effect.gen(function* () {
      const data = yield* readScopeSecrets(filePath, scope);
      const had = secretId in data;
      delete data[secretId];
      if (had) yield* writeScopeSecrets(filePath, scope, data);
      return had;
    }),

  list: () =>
    Effect.map(readScopeSecrets(filePath, listScope), (data) =>
      Object.keys(data).map((k) => ({ id: k, name: k })),
    ),
});

// ---------------------------------------------------------------------------
// Plugin definition
//
// Compute the scoped file path identically in `extension` (for `filePath`)
// and `secretProviders` (for the provider's read/write). Both receive ctx
// and both are called once per createExecutor.
// ---------------------------------------------------------------------------

const resolveFilePath = (config: FileSecretsPluginConfig | undefined): string =>
  authFilePath(config?.directory);

export const fileSecretsPlugin = definePlugin((options?: FileSecretsPluginConfig) => ({
  id: "fileSecrets" as const,
  storage: () => ({}),

  extension: (_ctx): FileSecretsExtension => ({
    filePath: resolveFilePath(options),
  }),

  secretProviders: (ctx: PluginCtx<unknown>) => [
    // list() falls back to the innermost scope for display; per-call
    // get/set/delete honor the scope arg threaded from the secrets facade.
    makeScopedProvider(resolveFilePath(options), ctx.scopes[0]!.id),
  ],
}));

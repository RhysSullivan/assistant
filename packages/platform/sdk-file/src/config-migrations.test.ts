import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  loadExecutorScopeConfig,
  resolveLocalWorkspaceContext,
} from "./config";
import {
  migrateLegacyExecutorScopeConfigs,
} from "./config-migrations";
import {
  createLocalExecutorRepositoriesEffect,
} from "./index";

const resolveMaybeEffect = <T>(
  value: T | Promise<T> | Effect.Effect<T, Error, never>,
): Effect.Effect<T, Error, never> =>
  Effect.isEffect(value)
    ? value
    : value instanceof Promise
      ? Effect.promise(() => value)
      : Effect.succeed(value);

const makeWorkspaceRoot = () =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) =>
      fs.makeTempDirectory({
        directory: tmpdir(),
        prefix: "executor-config-migrations-",
      })
    ),
  );

describe("config-migrations", () => {
  it.effect("rewrites legacy source entries into the current config shape", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* makeWorkspaceRoot();
      const configDirectory = join(workspaceRoot, ".executor");
      yield* fs.makeDirectory(configDirectory, { recursive: true });
      yield* fs.writeFileString(
        join(configDirectory, "executor.jsonc"),
        `{
  "sources": {
    "github": {
      "kind": "openapi",
      "name": "GitHub",
      "connection": {
        "endpoint": "https://api.github.com"
      },
      "binding": {
        "specUrl": "https://example.com/openapi.json",
        "defaultHeaders": {
          "x-test": "1"
        }
      }
    },
    "google-calendar": {
      "kind": "google_discovery",
      "name": "Google Calendar",
      "namespace": "google.calendar",
      "connection": {
        "endpoint": "https://calendar-json.googleapis.com/$discovery/rest?version=v3"
      },
      "binding": {
        "service": "calendar",
        "version": "v3",
        "discoveryUrl": "https://calendar-json.googleapis.com/$discovery/rest?version=v3",
        "defaultHeaders": {
          "x-goog-api-client": "executor"
        },
        "scopes": [
          "https://www.googleapis.com/auth/calendar.readonly"
        ]
      }
    }
  }
}
`,
      );

      const context = yield* resolveLocalWorkspaceContext({ workspaceRoot });
      const beforeMigration = yield* Effect.flip(loadExecutorScopeConfig(context));
      expect(beforeMigration.message).toContain("Invalid executor config");

      const migratedPaths = yield* migrateLegacyExecutorScopeConfigs(context);
      expect(migratedPaths).toContain(context.projectConfigPath);
      expect(yield* fs.exists(`${context.projectConfigPath}.legacy-backup`)).toBe(true);

      const loaded = yield* loadExecutorScopeConfig(context);
      const rewritten = yield* fs.readFileString(context.projectConfigPath, "utf8");

      expect(rewritten).not.toContain("\"connection\"");
      expect(rewritten).not.toContain("\"binding\"");
      expect(loaded.config?.sources?.github?.config).toEqual({
        specUrl: "https://example.com/openapi.json",
        baseUrl: "https://api.github.com",
        auth: {
          kind: "none",
        },
        defaultHeaders: {
          "x-test": "1",
        },
      });

      expect(loaded.config?.sources?.["google-calendar"]?.config).toEqual({
        service: "calendar",
        version: "v3",
        discoveryUrl: "https://calendar-json.googleapis.com/$discovery/rest?version=v3",
        defaultHeaders: {
          "x-goog-api-client": "executor",
        },
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        auth: {
          kind: "none",
        },
      });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("runs startup migrations before the strict config loader", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* makeWorkspaceRoot();
      const homeConfigPath = join(workspaceRoot, ".executor-home.jsonc");
      const homeStateDirectory = join(workspaceRoot, ".executor-home-state");
      const configDirectory = join(workspaceRoot, ".executor");
      const projectConfigPath = join(configDirectory, "executor.jsonc");
      yield* fs.makeDirectory(configDirectory, { recursive: true });
      yield* fs.writeFileString(
        projectConfigPath,
        `{
  "secrets": {
    "providers": {},
    "defaults": {}
  },
  "sources": {
    "github": {
      "kind": "openapi",
      "config": {
        "specUrl": "https://example.com/openapi.json",
        "baseUrl": "https://api.github.com",
        "auth": {
          "kind": "none"
        },
        "defaultHeaders": null
      }
    }
  }
}
`,
      );

      const context = yield* resolveLocalWorkspaceContext({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
      });
      const beforeStartup = yield* Effect.flip(loadExecutorScopeConfig(context));
      expect(beforeStartup.message).toContain("Invalid executor config");

      const repositories = yield* createLocalExecutorRepositoriesEffect({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
      });
      const rewritten = yield* fs.readFileString(projectConfigPath, "utf8");
      const loaded = yield* resolveMaybeEffect(
        repositories.workspace.config.load(),
      );

      expect(yield* fs.exists(`${projectConfigPath}.legacy-backup`)).toBe(true);
      expect(rewritten).not.toContain("\"secrets\"");
      expect(loaded.projectConfig?.sources?.github?.config).toEqual({
        specUrl: "https://example.com/openapi.json",
        baseUrl: "https://api.github.com",
        auth: {
          kind: "none",
        },
        defaultHeaders: null,
      });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

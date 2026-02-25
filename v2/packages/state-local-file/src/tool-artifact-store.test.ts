import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as FileSystem from "@effect/platform/FileSystem";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Path from "@effect/platform/Path";
import * as BunContext from "@effect/platform-bun/BunContext";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";

import { type Source, SourceSchema } from "@executor-v2/schema";
import { makeSourceManagerService } from "@executor-v2/source-manager";

import { makeLocalToolArtifactStore } from "./tool-artifact-store";

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const testLayer = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer);

describe("makeLocalToolArtifactStore", () => {
  it.effect("extracts and persists tools from the Vercel OpenAPI spec", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fileSystem.makeTempDirectory({
        prefix: "executor-v2-artifact-test-",
      });

      const artifactStore = yield* makeLocalToolArtifactStore({ rootDir: tempDir });
      const sourceManager = makeSourceManagerService(artifactStore);

      const openApiSpec = yield* pipe(
        HttpClient.get("https://openapi.vercel.sh"),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
      );

      const now = Date.now();
      const source: Source = decodeSource({
        id: "src_vercel",
        workspaceId: "ws_local",
        name: "vercel",
        kind: "openapi",
        endpoint: "https://openapi.vercel.sh",
        status: "connected",
        enabled: true,
        configJson: "{}",
        sourceHash: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

      const first = yield* sourceManager.refreshOpenApiArtifact({
        source,
        openApiSpec,
        now: () => now,
      });

      expect(first.reused).toBe(false);
      expect(first.manifest.tools.length).toBeGreaterThan(100);
      expect(first.diff.added.length).toBe(first.manifest.tools.length);

      const second = yield* sourceManager.refreshOpenApiArtifact({
        source,
        openApiSpec,
        now: () => now + 1,
      });

      expect(second.reused).toBe(true);
      expect(second.diff.unchangedCount).toBe(second.manifest.tools.length);

      const persisted = yield* artifactStore.getBySource(source.workspaceId, source.id);
      expect(Option.isSome(persisted)).toBe(true);
      if (Option.isSome(persisted)) {
        expect(persisted.value.toolCount).toBe(second.manifest.tools.length);
      }

      const artifactFilePath = path.resolve(tempDir, "tool-artifacts.json");
      const exists = yield* fileSystem.exists(artifactFilePath);
      expect(exists).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );
});

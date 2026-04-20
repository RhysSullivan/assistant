import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { typedAdapter } from "@executor/storage-core";
import { makeMemoryAdapter } from "@executor/storage-core/testing/memory";
import {
  makeInMemoryBlobStore,
  pluginBlobStore,
  Scope,
  ScopeId,
  type StorageDeps,
} from "@executor/sdk";

import {
  googleDiscoverySchema,
  makeGoogleDiscoveryStore,
  type GoogleDiscoverySchema,
  type GoogleDiscoveryStoredSource,
} from "./binding-store";
import {
  GoogleDiscoveryAnnotationPolicy,
  GoogleDiscoveryStoredSourceData,
} from "./types";

// ---------------------------------------------------------------------------
// Test harness — build a GoogleDiscoveryStore backed by the memory adapter.
// Bypasses createExecutor so these tests are narrow-scope (and don't pull
// in the full plugin wiring).
// ---------------------------------------------------------------------------

const TEST_SCOPE = "test-scope";

const makeStore = () => {
  const adapter = makeMemoryAdapter({ schema: googleDiscoverySchema });
  const scope = new Scope({
    id: ScopeId.make(TEST_SCOPE),
    name: "test",
    createdAt: new Date(),
  });
  const deps: StorageDeps<GoogleDiscoverySchema> = {
    scopes: [scope],
    adapter: typedAdapter<GoogleDiscoverySchema>(adapter),
    blobs: pluginBlobStore(
      makeInMemoryBlobStore(),
      [scope.id as string],
      "google-discovery-test",
    ),
  };
  return makeGoogleDiscoveryStore(deps);
};

const makeSourceData = (name: string = "Google Drive") =>
  new GoogleDiscoveryStoredSourceData({
    name,
    discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
    service: "drive",
    version: "v3",
    rootUrl: "https://www.googleapis.com/",
    servicePath: "drive/v3/",
    auth: { kind: "none" as const },
  });

const sourceFixture = (
  annotationPolicy?: GoogleDiscoveryAnnotationPolicy,
): GoogleDiscoveryStoredSource => ({
  namespace: "drive",
  scope: TEST_SCOPE,
  name: "Google Drive",
  config: makeSourceData(),
  ...(annotationPolicy !== undefined ? { annotationPolicy } : {}),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoogleDiscoveryStore annotation policy storage", () => {
  it.effect("round-trips a concrete annotation policy via putSource/getSource", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const policy = new GoogleDiscoveryAnnotationPolicy({
        requireApprovalFor: ["get", "post"],
      });

      yield* store.putSource(sourceFixture(policy));

      const fetched = yield* store.getSource("drive", TEST_SCOPE);
      expect(fetched).not.toBeNull();
      expect(fetched!.annotationPolicy).toBeDefined();
      expect(fetched!.annotationPolicy!.requireApprovalFor).toEqual([
        "get",
        "post",
      ]);
    }),
  );

  it.effect(
    "preserves an existing annotation policy when putSource is called without one (refresh path)",
    () =>
      Effect.gen(function* () {
        const store = makeStore();
        const policy = new GoogleDiscoveryAnnotationPolicy({
          requireApprovalFor: ["delete"],
        });

        // 1. Seed with a policy.
        yield* store.putSource(sourceFixture(policy));

        // 2. Second putSource (simulating refreshSource) supplies NO policy.
        yield* store.putSource(sourceFixture(undefined));

        // 3. The original policy must still be present.
        const fetched = yield* store.getSource("drive", TEST_SCOPE);
        expect(fetched).not.toBeNull();
        expect(fetched!.annotationPolicy).toBeDefined();
        expect(fetched!.annotationPolicy!.requireApprovalFor).toEqual([
          "delete",
        ]);
      }),
  );

  it.effect("getSource returns undefined annotationPolicy when none is stored", () =>
    Effect.gen(function* () {
      const store = makeStore();
      yield* store.putSource(sourceFixture(undefined));

      const fetched = yield* store.getSource("drive", TEST_SCOPE);
      expect(fetched).not.toBeNull();
      expect(fetched!.annotationPolicy).toBeUndefined();
    }),
  );

  it.effect("updateSourceMeta with a concrete value persists the override", () =>
    Effect.gen(function* () {
      const store = makeStore();
      yield* store.putSource(sourceFixture(undefined));

      yield* store.updateSourceMeta("drive", {
        annotationPolicy: new GoogleDiscoveryAnnotationPolicy({
          requireApprovalFor: ["patch"],
        }),
      });

      const fetched = yield* store.getSource("drive", TEST_SCOPE);
      expect(fetched!.annotationPolicy!.requireApprovalFor).toEqual(["patch"]);
    }),
  );

  it.effect("updateSourceMeta with null clears the override", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const policy = new GoogleDiscoveryAnnotationPolicy({
        requireApprovalFor: ["post"],
      });
      yield* store.putSource(sourceFixture(policy));

      // Confirm the fixture landed.
      const before = yield* store.getSource("drive", TEST_SCOPE);
      expect(before!.annotationPolicy).toBeDefined();

      yield* store.updateSourceMeta("drive", { annotationPolicy: null });

      const after = yield* store.getSource("drive", TEST_SCOPE);
      expect(after).not.toBeNull();
      expect(after!.annotationPolicy).toBeUndefined();
    }),
  );

  it.effect("updateSourceMeta with undefined leaves the override unchanged", () =>
    Effect.gen(function* () {
      const store = makeStore();
      const policy = new GoogleDiscoveryAnnotationPolicy({
        requireApprovalFor: ["put"],
      });
      yield* store.putSource(sourceFixture(policy));

      // Only update the name.
      yield* store.updateSourceMeta("drive", { name: "Renamed Drive" });

      const fetched = yield* store.getSource("drive", TEST_SCOPE);
      expect(fetched!.name).toBe("Renamed Drive");
      expect(fetched!.annotationPolicy!.requireApprovalFor).toEqual(["put"]);
    }),
  );
});

import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  SourceIdSchema,
  ScopeIdSchema,
  type Source,
} from "#schema";

import type {
  LoadedLocalExecutorConfig,
} from "../scope-config";
import {
  buildLocalSourceRecord,
} from "./source-store";
import type {
  LocalScopeState,
} from "../scope-state";

const scopeId = ScopeIdSchema.make("ws_source_store");
const sourceId = SourceIdSchema.make("linear");

const loadedConfig: LoadedLocalExecutorConfig = {
  config: {
    sources: {
      [sourceId]: {
        kind: "graphql",
        name: "Linear GraphQL",
        namespace: "linear",
        connection: {
          endpoint: "https://api.linear.app/graphql",
        },
        binding: {
          defaultHeaders: null,
        },
      },
    },
  },
  homeConfig: null,
  projectConfig: null,
  homeConfigPath: "/tmp/home-config.jsonc",
  projectConfigPath: "/tmp/project-config.jsonc",
};

const scopeState: LocalScopeState = {
  version: 1,
  sources: {
    [sourceId]: {
      status: "connected",
      lastError: null,
      sourceHash: "hash_linear",
      createdAt: 1000,
      updatedAt: 2000,
    },
  },
  policies: {},
};

describe("source-store", () => {
  it.effect("projects configured sources without reading local artifacts", () =>
    Effect.gen(function* () {
      const result = yield* buildLocalSourceRecord({
        scopeId,
        loadedConfig,
        scopeState,
        sourceId,
        authArtifacts: [],
      });

      expect(result.source).toEqual({
        id: sourceId,
        scopeId,
        name: "Linear GraphQL",
        kind: "graphql",
        endpoint: "https://api.linear.app/graphql",
        status: "connected",
        enabled: true,
        namespace: "linear",
        bindingVersion: 1,
        binding: {
          defaultHeaders: null,
        },
        importAuthPolicy: "reuse_runtime",
        importAuth: { kind: "none" },
        auth: { kind: "none" },
        sourceHash: "hash_linear",
        lastError: null,
        createdAt: 1000,
        updatedAt: 2000,
      } satisfies Source);
    }));
});

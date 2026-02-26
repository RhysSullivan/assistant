import { describe, expect, it } from "@effect/vitest";
import {
  CanonicalToolDescriptorSchema,
  type CanonicalToolDescriptor,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import {
  makeCloudflareWorkerLoaderRuntimeAdapter,
  makeLocalInProcessRuntimeAdapter,
  makeRuntimeAdapterRegistry,
  RuntimeAdapterError,
} from "./runtime-adapters";
import {
  makeToolProviderRegistry,
  ToolProviderRegistryService,
  type ToolProvider,
} from "./tool-providers";

const decodeCanonicalToolDescriptor = Schema.decodeUnknownSync(
  CanonicalToolDescriptorSchema,
);

const sumToolDescriptor: CanonicalToolDescriptor = decodeCanonicalToolDescriptor({
  providerKind: "in_memory",
  sourceId: null,
  workspaceId: null,
  toolId: "sum",
  name: "sum",
  description: null,
  invocationMode: "in_memory",
  availability: "local_only",
  providerPayload: null,
});

describe("runtime adapters", () => {
  it.effect("executes with local-inproc adapter via runtime registry", () =>
    Effect.gen(function* () {
      const sumProvider: ToolProvider = {
        kind: "in_memory",
        invoke: (input) =>
          Effect.gen(function* () {
            const args = input.args as { a: number; b: number };
            return {
              output: args.a + args.b,
              isError: false,
            } as const;
          }),
      };

      const toolRegistry = makeToolProviderRegistry([sumProvider]);
      const runtimeRegistry = makeRuntimeAdapterRegistry([
        makeLocalInProcessRuntimeAdapter(),
      ]);

      const result = yield* runtimeRegistry
        .execute({
          runtimeKind: "local-inproc",
          code: "return await tools.sum({ a: 2, b: 4 });",
          tools: [{ descriptor: sumToolDescriptor, source: null }],
        })
        .pipe(Effect.provideService(ToolProviderRegistryService, toolRegistry));

      expect(result).toBe(6);
    }),
  );

  it.effect("returns typed not-implemented error for cloudflare adapter", () =>
    Effect.gen(function* () {
      const toolRegistry = makeToolProviderRegistry([]);
      const runtimeRegistry = makeRuntimeAdapterRegistry([
        makeCloudflareWorkerLoaderRuntimeAdapter(),
      ]);

      const result = yield* Effect.either(
        runtimeRegistry
          .execute({
            runtimeKind: "cloudflare-worker-loader",
            code: "return 1;",
            tools: [],
          })
          .pipe(Effect.provideService(ToolProviderRegistryService, toolRegistry)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RuntimeAdapterError);
        if (result.left instanceof RuntimeAdapterError) {
          expect(result.left.runtimeKind).toBe("cloudflare-worker-loader");
        }
      }
    }),
  );
});

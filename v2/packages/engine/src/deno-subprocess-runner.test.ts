import { describe, expect, it } from "@effect/vitest";
import {
  CanonicalToolDescriptorSchema,
  type CanonicalToolDescriptor,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import {
  DenoSubprocessRunnerError,
  executeJavaScriptInDenoSubprocess,
} from "./deno-subprocess-runner";
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

describe("executeJavaScriptInDenoSubprocess", () => {
  it.effect("runs code in Deno subprocess and proxies tool calls", () =>
    Effect.gen(function* () {
      const sumProvider: ToolProvider = {
        kind: "in_memory",
        invoke: (input) =>
          Effect.gen(function* () {
            if (input.tool.toolId !== "sum") {
              return {
                output: `unknown tool: ${input.tool.toolId}`,
                isError: true,
              } as const;
            }

            const args = input.args as { a: number; b: number };
            return {
              output: args.a + args.b,
              isError: false,
            } as const;
          }),
      };

      const registry = makeToolProviderRegistry([sumProvider]);

      const result = yield* executeJavaScriptInDenoSubprocess({
        code: "console.log('hello'); return await tools.sum({ a: 2, b: 3 });",
        tools: [
          {
            descriptor: sumToolDescriptor,
            source: null,
          },
        ],
        timeoutMs: 10_000,
      }).pipe(Effect.provideService(ToolProviderRegistryService, registry));

      expect(result).toBe(5);
    }),
  );

  it.effect("returns a typed error when Deno executable is missing", () =>
    Effect.gen(function* () {
      const registry = makeToolProviderRegistry([]);

      const result = yield* Effect.either(
        executeJavaScriptInDenoSubprocess({
          code: "return 1;",
          tools: [],
          denoExecutable: "/definitely-missing-deno-binary",
          timeoutMs: 1_000,
        }).pipe(Effect.provideService(ToolProviderRegistryService, registry)),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DenoSubprocessRunnerError);
        expect(result.left.operation).toBe("spawn");
      }
    }),
  );
});

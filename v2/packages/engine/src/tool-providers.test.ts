import { describe, expect, test } from "bun:test";
import { type Source, SourceSchema } from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  makeToolProviderRegistry,
  ToolProviderError,
  ToolProviderRegistryError,
  type ToolProvider,
} from "./tool-providers";

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const createOpenApiSource = (): Source =>
  decodeSource({
    id: "src_openapi",
    workspaceId: "ws_local",
    name: "example",
    kind: "openapi",
    endpoint: "https://example.com/openapi.json",
    status: "connected",
    enabled: true,
    configJson: "{}",
    sourceHash: null,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

describe("makeToolProviderRegistry", () => {
  test("routes discovery and invocation through provider kind", async () => {
    const openApiProvider: ToolProvider = {
      kind: "openapi",
      discoverFromSource: (source) =>
        Effect.succeed({
          sourceHash: "hash_1",
          tools: [
            {
              providerKind: "openapi",
              sourceId: source.id,
              workspaceId: source.workspaceId,
              toolId: "getHealth",
              name: "Get health",
              description: null,
              invocationMode: "http",
              availability: "remote_capable",
              providerPayload: {
                method: "get",
                pathTemplate: "/healthz",
              },
            },
          ],
        }),
      invoke: () =>
        Effect.succeed({
          output: { ok: true },
          isError: false,
        }),
    };

    const registry = makeToolProviderRegistry([openApiProvider]);

    const source = createOpenApiSource();
    const discovery = await Effect.runPromise(registry.discoverFromSource(source));

    expect(discovery.tools).toHaveLength(1);
    expect(discovery.tools[0]?.toolId).toBe("getHealth");

    const result = await Effect.runPromise(
      registry.invoke({
        source,
        tool: discovery.tools[0]!,
        args: { verbose: true },
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ ok: true });
  });

  test("fails on duplicate provider registration", async () => {
    const openApiProvider: ToolProvider = {
      kind: "openapi",
      invoke: () => Effect.succeed({ output: null, isError: false }),
    };

    const registry = makeToolProviderRegistry([openApiProvider]);
    const result = await Effect.runPromise(
      Effect.either(registry.register(openApiProvider)),
    );

    if (result._tag === "Right") {
      throw new Error("expected duplicate provider registration to fail");
    }

    expect(result.left).toBeInstanceOf(ToolProviderRegistryError);
    expect(result.left.message).toContain("Provider already registered");
  });

  test("fails when provider cannot discover from source", async () => {
    const mcpProvider: ToolProvider = {
      kind: "mcp",
      invoke: () =>
        Effect.fail(
          new ToolProviderError({
            operation: "invoke",
            providerKind: "mcp",
            message: "not implemented",
            details: null,
          }),
        ),
    };

    const registry = makeToolProviderRegistry([mcpProvider]);
    const source = createOpenApiSource();

    const result = await Effect.runPromise(
      Effect.either(registry.discoverFromSource(source)),
    );

    if (result._tag === "Right") {
      throw new Error("expected discovery to fail without provider");
    }

    expect(result.left).toBeInstanceOf(ToolProviderRegistryError);
    expect(result.left.message).toContain("No provider registered");
  });
});

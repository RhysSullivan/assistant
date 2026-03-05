import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  createDynamicDiscovery,
  createStaticDiscoveryFromTools,
  executeCodeWithTools,
  makeToolInvokerFromTools,
  toTool,
  type CodeExecutor,
  type ToolDescriptor,
  type ToolMap,
  type ToolPath,
} from "./index";

const asToolPath = (value: string): ToolPath => value as ToolPath;

describe("codemode-core", () => {
  it.effect("builds static discovery from tool map keys", () =>
    Effect.gen(function* () {
      const tools = {
        "math.add": {
          description: "Add two numbers",
          execute: async ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
        },
        "issues.create": toTool({
          tool: {
            description: "Create issue",
            execute: async ({ title }: { title: string }) => ({ id: "issue_1", title }),
          },
          metadata: {
            interaction: "required",
          },
        }),
      } satisfies ToolMap;

      const staticDiscovery = createStaticDiscoveryFromTools({
        tools,
        sourceKey: "api.demo",
      });

      expect(staticDiscovery.primitives.catalog).toBeUndefined();
      expect(staticDiscovery.preloadedTools.map((tool) => tool.path)).toEqual([
        "issues.create",
        "math.add",
      ]);

      const createIssueDescriptor = staticDiscovery.preloadedTools.find(
        (tool) => tool.path === "issues.create",
      );
      expect(createIssueDescriptor?.interaction).toBe("required");
      expect(createIssueDescriptor?.sourceKey).toBe("api.demo");
      expect(staticDiscovery.executeDescription).toContain("issues.create");
    }),
  );

  it.effect("hydrates dynamic discover results via search + directory", () =>
    Effect.gen(function* () {
      const descriptors: Record<string, ToolDescriptor> = {
        "source.docs.search": {
          path: asToolPath("source.docs.search"),
          sourceKey: "source.docs",
          description: "Search docs",
          inputHint: "object",
          outputHint: "object",
        },
        "source.issues.create": {
          path: asToolPath("source.issues.create"),
          sourceKey: "source.issues",
          description: "Create issue",
          interaction: "required",
          inputHint: "object",
          outputHint: "object",
        },
      };

      const directory = {
        listNamespaces: () =>
          Effect.succeed([
            { namespace: "source.docs", toolCount: 1 },
            { namespace: "source.issues", toolCount: 1 },
          ]),
        listTools: () =>
          Effect.succeed([
            { path: asToolPath("source.docs.search") },
            { path: asToolPath("source.issues.create") },
          ]),
        getByPath: ({ path }: { path: ToolPath; includeSchemas: boolean }) =>
          Effect.succeed(descriptors[path] ?? null),
        getByPaths: ({ paths }: { paths: readonly ToolPath[]; includeSchemas: boolean }) =>
          Effect.succeed(paths.map((path) => descriptors[path]).filter(Boolean)),
      };

      const search = {
        search: () =>
          Effect.succeed([
            { path: asToolPath("source.issues.create"), score: 0.93 },
            { path: asToolPath("source.docs.search"), score: 0.72 },
          ]),
      };

      const dynamic = createDynamicDiscovery({ directory, search });

      const namespaces = yield* dynamic.primitives.catalog!.namespaces({ limit: 10 });
      expect(namespaces.namespaces).toHaveLength(2);

      const discovered = yield* dynamic.primitives.discover!.run({
        query: "create issue",
        limit: 5,
      });

      expect(discovered.bestPath).toBe("source.issues.create");
      expect(discovered.results[0]?.path).toBe("source.issues.create");
      expect(discovered.results[0]?.interaction).toBe("required");
    }),
  );

  it.effect("executes code against tool map via executor contract", () =>
    Effect.gen(function* () {
      const tools = {
        "math.add": {
          execute: async ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
        },
        "notifications.send": toTool({
          tool: {
            execute: async ({ message }: { message: string }) => ({ delivered: true, message }),
          },
          metadata: { interaction: "required" },
        }),
      } satisfies ToolMap;

      const executor: CodeExecutor = {
        execute: (code, toolInvoker) =>
          Effect.gen(function* () {
            const math = yield* toolInvoker.invoke({
              path: "math.add",
              args: { a: 2, b: 3 },
            });
            const notification = yield* toolInvoker.invoke({
              path: "notifications.send",
              args: { message: "sum is 5" },
            });
            return {
              result: { code, math, notification },
              logs: ["executed"],
            };
          }),
      };

      const output = yield* executeCodeWithTools({
        code: "return await tools.math.add({ a: 2, b: 3 });",
        tools,
        executor,
      });

      expect(output.code).toContain("tools.math.add");
      expect(output.result).toEqual({
        code: "return await tools.math.add({ a: 2, b: 3 });",
        math: { sum: 5 },
        notification: { delivered: true, message: "sum is 5" },
      });
      expect(output.logs).toEqual(["executed"]);
    }),
  );

  it.effect("supports lazy tool invoker without passing tools", () =>
    Effect.gen(function* () {
      let mathCalls = 0;

      const toolInvoker = makeToolInvokerFromTools({
        tools: {
          "math.add": {
            execute: ({ a, b }: { a: number; b: number }) => {
              mathCalls += 1;
              return { sum: a + b };
            },
          },
        },
      });

      const executor: CodeExecutor = {
        execute: (code, invoker) =>
          Effect.gen(function* () {
            const math = yield* invoker.invoke({
              path: "math.add",
              args: { a: 20, b: 22 },
            });
            return {
              result: { code, math },
              logs: ["lazy"],
            };
          }),
      };

      const output = yield* executeCodeWithTools({
        code: "return await tools.math.add({ a: 20, b: 22 });",
        executor,
        toolInvoker,
      });

      expect(mathCalls).toBe(1);
      expect(output.result).toEqual({
        code: "return await tools.math.add({ a: 20, b: 22 });",
        math: { sum: 42 },
      });
      expect(output.logs).toEqual(["lazy"]);
    }),
  );

  it.effect("surfaces executor errors from executeCodeWithTools", () =>
    Effect.gen(function* () {
      const executor: CodeExecutor = {
        execute: (_code, _toolInvoker) =>
          Effect.succeed({ result: null, error: "boom" }),
      };

      const outcome = yield* Effect.either(
        executeCodeWithTools({
          code: "return 1",
          tools: {},
          executor,
        }),
      );

      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") {
        expect(outcome.left).toBeInstanceOf(Error);
        if (outcome.left instanceof Error) {
          expect(outcome.left.message).toBe("boom");
        }
      }
    }),
  );
});

import { describe, expect, it } from "vitest";

import { createExecutor } from "./promise";
import { definePlugin, defineSchema } from "./plugin";
import { Effect } from "effect";

// A minimal static-tool plugin built on the Effect surface, consumed
// through the Promise façade. Exercises the proxy's ability to promisify
// nested methods (executor.tools.*) and plugin extensions.
const echoPlugin = definePlugin(() => ({
  id: "echo" as const,
  schema: defineSchema({}),
  storage: () => ({}),
  staticSources: () => [
    {
      id: "echo.ctl",
      kind: "control" as const,
      name: "Echo Ctl",
      tools: [
        {
          name: "say",
          description: "Echo the input",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
          handler: ({ args }: { args: unknown }) =>
            Effect.succeed((args as { message: string }).message),
        },
      ],
    },
  ],
  extension: () => ({
    greet: (name: string) =>
      Effect.succeed(`hello, ${name}`) as Effect.Effect<string, never>,
  }),
}));

describe("promise/createExecutor", () => {
  it("returns Promise-shaped executor and invokes static tools", async () => {
    const executor = await createExecutor({
      plugins: [echoPlugin()] as const,
    });

    const tools = await executor.tools.list();
    expect(tools.map((t) => t.id)).toContain("echo.ctl.say");

    const out = await executor.tools.invoke("echo.ctl.say", {
      message: "hi",
    });
    expect(out).toBe("hi");

    await executor.close();
  });

  it("promisifies plugin extension methods", async () => {
    const executor = await createExecutor({
      plugins: [echoPlugin()] as const,
    });

    const greeting = await executor.echo.greet("world");
    expect(greeting).toBe("hello, world");

    await executor.close();
  });
});

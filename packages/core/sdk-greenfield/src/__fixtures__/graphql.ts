// ---------------------------------------------------------------------------
// Stub graphql plugin — no plugin-specific schema. Static add-endpoint
// is a thin wrapper over self.addEndpoint, invokeTool handles the
// dynamic `query` tool via the already-loaded core ToolRow.
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { definePlugin } from "../plugin";

export interface AddEndpointInput {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
}

export interface GraphqlExtension {
  readonly addEndpoint: (
    input: AddEndpointInput,
  ) => Effect.Effect<{ readonly sourceId: string }, Error>;
}

// Field order matters: `extension` must come before `staticSources`
// so TypeScript can infer TExtension from extension's return type
// before type-checking the NoInfer<TExtension> self parameter.
export const graphqlPlugin = definePlugin(() => ({
  id: "graphql" as const,
  storage: () => ({} as const),

  extension: (ctx) =>
    ({
      addEndpoint: (input) =>
        ctx.transaction(
          Effect.gen(function* () {
            yield* ctx.core.sources.register({
              id: input.id,
              kind: "graphql",
              name: input.name,
              url: input.endpoint,
              canRemove: true,
              tools: [
                {
                  name: "query",
                  description: `Run a query against ${input.endpoint}`,
                },
              ],
            });
            return { sourceId: input.id };
          }),
        ),
    }) satisfies GraphqlExtension,

  staticSources: (self) => [
    {
      id: "graphql.control",
      kind: "graphql",
      name: "GraphQL (control)",
      canRemove: false,
      tools: [
        {
          name: "add-endpoint",
          description: "Register a new GraphQL endpoint",
          handler: ({ args }) => self.addEndpoint(args as AddEndpointInput),
        },
      ],
    },
  ],

  invokeTool: ({ toolRow, args }) =>
    Effect.gen(function* () {
      if (toolRow.name !== "query") {
        return yield* Effect.fail(
          new Error(`graphql: no tool "${toolRow.name}"`),
        );
      }
      return {
        source: toolRow.source_id,
        tool: "query",
        args,
      };
    }),
}));

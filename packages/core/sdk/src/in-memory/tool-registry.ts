import { Effect } from "effect";

import { ToolId } from "../ids";
import { ToolNotFoundError, ToolInvocationError } from "../errors";
import type { ToolRegistration, ToolInvoker, SourceProvider, ToolListFilter, InvokeOptions } from "../tools";
import { reattachDefs } from "../schema-refs";

export const makeInMemoryToolRegistry = () => {
  const tools = new Map<string, ToolRegistration>();
  const invokers = new Map<string, ToolInvoker>();
  const sourceProviders = new Map<string, SourceProvider>();
  const sharedDefs = new Map<string, unknown>();

  return {
    list: (filter?: ToolListFilter) =>
      Effect.sync(() => {
        let result = [...tools.values()];
        if (filter?.tags?.length) {
          const tagSet = new Set(filter.tags);
          result = result.filter((t) =>
            t.tags?.some((tag) => tagSet.has(tag)),
          );
        }
        if (filter?.query) {
          const q = filter.query.toLowerCase();
          result = result.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.description?.toLowerCase().includes(q),
          );
        }
        return result.map((t) => ({
          id: t.id,
          pluginKey: t.pluginKey,
          name: t.name,
          description: t.description,
          tags: t.tags ? [...t.tags] : [],
        }));
      }),

    schema: (toolId: ToolId) =>
      Effect.fromNullable(tools.get(toolId)).pipe(
        Effect.mapError(() => new ToolNotFoundError({ toolId })),
        Effect.map((t) => ({
          id: t.id,
          inputSchema: reattachDefs(t.inputSchema, sharedDefs),
          outputSchema: reattachDefs(t.outputSchema, sharedDefs),
        })),
      ),

    definitions: () =>
      Effect.sync(() => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of sharedDefs) {
          result[k] = v;
        }
        return result;
      }),

    registerDefinitions: (defs: Record<string, unknown>) =>
      Effect.sync(() => {
        for (const [k, v] of Object.entries(defs)) {
          sharedDefs.set(k, v);
        }
      }),

    registerInvoker: (pluginKey: string, invoker: ToolInvoker) =>
      Effect.sync(() => {
        invokers.set(pluginKey, invoker);
      }),

    invoke: (toolId: ToolId, args: unknown, options?: InvokeOptions) =>
      Effect.gen(function* () {
        const tool = yield* Effect.fromNullable(tools.get(toolId)).pipe(
          Effect.mapError(() => new ToolNotFoundError({ toolId })),
        );
        const invoker = invokers.get(tool.pluginKey);
        if (!invoker) {
          return yield* new ToolInvocationError({
            toolId,
            message: `No invoker registered for plugin "${tool.pluginKey}"`,
            cause: undefined,
          });
        }
        return yield* invoker.invoke(toolId, args, options);
      }),

    register: (newTools: readonly ToolRegistration[]) =>
      Effect.sync(() => {
        for (const t of newTools) {
          tools.set(t.id, t);
        }
      }),

    unregister: (toolIds: readonly ToolId[]) =>
      Effect.sync(() => {
        for (const id of toolIds) {
          tools.delete(id);
        }
      }),

    removeSource: (namespace: string) =>
      Effect.gen(function* () {
        const matching: ToolRegistration[] = [];
        for (const t of tools.values()) {
          if (t.tags?.includes(namespace)) {
            matching.push(t);
          }
        }
        if (matching.length === 0) return;

        const pluginKey = matching[0]!.pluginKey;

        for (const t of matching) {
          tools.delete(t.id);
        }

        const provider = sourceProviders.get(pluginKey);
        if (provider) {
          yield* provider.remove(namespace);
        }
      }),

    refreshSource: (namespace: string) =>
      Effect.gen(function* () {
        let pluginKey: string | null = null;
        for (const t of tools.values()) {
          if (t.tags?.includes(namespace)) {
            pluginKey = t.pluginKey;
            break;
          }
        }
        if (!pluginKey) return;

        const provider = sourceProviders.get(pluginKey);
        if (provider?.refresh) {
          yield* provider.refresh(namespace);
        }
      }),

    addSourceProvider: (provider: SourceProvider) =>
      Effect.sync(() => {
        sourceProviders.set(provider.key, provider);
      }),
  };
};

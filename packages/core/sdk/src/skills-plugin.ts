// ---------------------------------------------------------------------------
// Built-in skills plugin — a static source (`executor.skills`) with three
// tools the model can call directly: `record`, `list`, `delete`.
//
// Auto-prepended by `createExecutor` (see `executor.ts`) so every host
// ships the skills tool surface without needing to register a plugin.
//
// The handlers delegate to `ctx.core.skills.*` — no storage of its own.
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { definePlugin } from "./plugin";
import {
  deleteSkillInputSchema,
  listSkillsInputSchema,
  recordSkillInputSchema,
  type RecordSkillInput,
} from "./skills";

export const skillsPlugin = definePlugin(() => ({
  id: "executor-skills" as const,
  storage: () => ({}),
  staticSources: () => [
    {
      id: "executor.skills",
      kind: "control",
      name: "Executor Skills",
      tools: [
        {
          name: "record",
          description:
            "Persist a short runbook note (markdown body + title) against an integration (a source id). Future invocations load these notes automatically. Use when you've just learned something non-obvious about an API while running a test case against it.",
          inputSchema: recordSkillInputSchema,
          handler: ({ ctx, args }) =>
            ctx.core.skills.record(args as RecordSkillInput),
        },
        {
          name: "list",
          description:
            "List skills — durable runbook notes captured against integrations. Pass sourceId to scope to one integration.",
          inputSchema: listSkillsInputSchema,
          handler: ({ ctx, args }) =>
            Effect.gen(function* () {
              const { sourceId } = (args as { sourceId?: string }) ?? {};
              if (sourceId) return yield* ctx.core.skills.listForSource(sourceId);
              return yield* ctx.core.skills.list();
            }),
        },
        {
          name: "delete",
          description: "Remove a skill by id.",
          inputSchema: deleteSkillInputSchema,
          handler: ({ ctx, args }) =>
            Effect.gen(function* () {
              const { id } = args as { id: string };
              yield* ctx.core.skills.remove(id);
              return { ok: true };
            }),
        },
      ],
    },
  ],
}));

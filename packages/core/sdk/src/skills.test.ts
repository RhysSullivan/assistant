import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { createExecutor } from "./executor";
import { definePlugin } from "./plugin";
import { MAX_SKILL_BODY_BYTES } from "./skills";
import { makeTestConfig } from "./testing";

// ---------------------------------------------------------------------------
// Tiny plugin that registers a dynamic source so skills have something
// real to attach to — mirrors the MCP / OpenAPI onboarding shape without
// pulling in either plugin.
// ---------------------------------------------------------------------------

const integrationPlugin = definePlugin(() => ({
  id: "integration" as const,
  storage: () => ({}),
  extension: (ctx) => ({
    registerSource: (id: string) =>
      ctx.core.sources.register({
        id,
        scope: ctx.scopes[0]!.id,
        kind: "integration",
        name: id,
        canRemove: true,
        tools: [{ name: "probe", description: "probe" }],
      }),
  }),
}));

describe("executor.skills", () => {
  it.effect("record a skill and list it for its source", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("axiom");

      const recorded = yield* executor.skills.record({
        sourceId: "axiom",
        title: "APL pagination",
        body: "Results page with `next_cursor`; pass as `cursor` query param.",
      });
      expect(recorded.title).toBe("APL pagination");
      expect(recorded.createdBy).toBe("model");
      expect(recorded.version).toBe(1);

      const skills = yield* executor.skills.listForSource("axiom");
      expect(skills.length).toBe(1);
      expect(skills[0]!.body).toContain("next_cursor");
    }),
  );

  it.effect("record overwrites same id and bumps version", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("axiom");

      const first = yield* executor.skills.record({
        id: "apl-pagination",
        sourceId: "axiom",
        title: "APL pagination",
        body: "v1",
      });
      expect(first.version).toBe(1);

      const second = yield* executor.skills.record({
        id: "apl-pagination",
        sourceId: "axiom",
        title: "APL pagination",
        body: "v2",
      });
      expect(second.version).toBe(2);
      expect(second.body).toBe("v2");

      const skills = yield* executor.skills.listForSource("axiom");
      expect(skills.length).toBe(1);
      expect(skills[0]!.body).toBe("v2");
    }),
  );

  it.effect("record via the static tool surface (record_skill)", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("linear");

      // The auto-prepended skillsPlugin registers this static source.
      const tools = yield* executor.tools.list();
      expect(tools.map((t) => t.id)).toContain("executor.skills.record");

      const recorded = yield* executor.tools.invoke("executor.skills.record", {
        sourceId: "linear",
        title: "issue filter syntax",
        body: "Use `state.name = \"Done\"` in the filter string.",
      });
      expect((recorded as { title: string }).title).toBe(
        "issue filter syntax",
      );

      const listed = yield* executor.tools.invoke("executor.skills.list", {
        sourceId: "linear",
      });
      expect(Array.isArray(listed)).toBe(true);
      expect((listed as readonly { sourceId: string }[]).length).toBe(1);
    }),
  );

  it.effect("include-on-invoke: skills surface near the tool manifest", () =>
    Effect.gen(function* () {
      // The consume contract: a host building a system prompt / tool
      // manifest for a given source calls listForSource(sourceId) and
      // gets every runbook note back, newest first, bounded by the
      // per-source cap.
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("stripe");

      const older = yield* executor.skills.record({
        sourceId: "stripe",
        title: "older",
        body: "older",
      });
      const newer = yield* executor.skills.record({
        sourceId: "stripe",
        title: "newer",
        body: "newer",
      });

      const skills = yield* executor.skills.listForSource("stripe");
      // Both should be present; even if timestamps tie in the memory
      // adapter, the projection carries them back so the ordering is
      // observable — older's updated_at <= newer's.
      expect(skills.length).toBe(2);
      expect(skills.map((s) => s.id).sort()).toEqual(
        [older.id, newer.id].sort(),
      );
      expect(
        skills[0]!.updatedAt.getTime() >= skills[1]!.updatedAt.getTime(),
      ).toBe(true);
    }),
  );

  it.effect("delete removes a skill", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("gh");

      const recorded = yield* executor.skills.record({
        id: "gh-quirk",
        sourceId: "gh",
        title: "quirk",
        body: "body",
      });

      yield* executor.skills.remove(recorded.id);

      const skills = yield* executor.skills.listForSource("gh");
      expect(skills.length).toBe(0);
    }),
  );

  it.effect("clamps body to MAX_SKILL_BODY_BYTES", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [integrationPlugin()] as const }),
      );
      yield* executor.integration.registerSource("big");

      const huge = "x".repeat(MAX_SKILL_BODY_BYTES * 2);
      const recorded = yield* executor.skills.record({
        sourceId: "big",
        title: "huge",
        body: huge,
      });
      expect(recorded.body.length).toBeLessThanOrEqual(MAX_SKILL_BODY_BYTES);
      expect(recorded.body.endsWith("[truncated]")).toBe(true);
    }),
  );

  it.effect("ctx.core.skills.record works from a plugin handler", () =>
    Effect.gen(function* () {
      // A plugin's own static handler can call ctx.core.skills.record —
      // e.g. an onboarding flow that persists a note the moment a
      // source is first connected.
      const onboardPlugin = definePlugin(() => ({
        id: "onboard" as const,
        storage: () => ({}),
        staticSources: () => [
          {
            id: "onboard.ctl",
            kind: "control",
            name: "Onboard",
            tools: [
              {
                name: "onboarded",
                description: "record a baseline skill",
                handler: ({ ctx }) =>
                  ctx.core.skills.record({
                    sourceId: "baseline-src",
                    title: "baseline",
                    body: "auto-recorded on first connect",
                    createdBy: "user",
                  }),
              },
            ],
          },
        ],
      }));

      const executor = yield* createExecutor(
        makeTestConfig({ plugins: [onboardPlugin()] as const }),
      );
      const result = yield* executor.tools.invoke("onboard.ctl.onboarded", {});
      expect((result as { createdBy: string }).createdBy).toBe("user");

      const skills = yield* executor.skills.listForSource("baseline-src");
      expect(skills.length).toBe(1);
      expect(skills[0]!.createdBy).toBe("user");
    }),
  );
});

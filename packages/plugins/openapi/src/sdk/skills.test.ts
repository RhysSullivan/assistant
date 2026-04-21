import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";

import { createExecutor, makeTestConfig } from "@executor/sdk";
import { skillsPlugin } from "@executor/plugin-skills";

import { openApiPlugin } from "./plugin";
import { openapiSkills } from "./skills";

// These tests demonstrate the naming-as-attachment convention: the
// openapi plugin's skill lives under id `openapi.adding-a-source`, so a
// query like `"openapi adding"` surfaces it right next to the real
// openapi static tools. No `appliesTo` field, no special linking — just
// the tool catalog doing substring matching across name + description.

describe("openapiSkills wired into skillsPlugin", () => {
  it.effect("shows up next to openapi static tools when queried by name", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin(),
            skillsPlugin({ skills: [...openapiSkills] }),
          ] as const,
        }),
      );

      const tools = yield* executor.tools.list({ query: "openapi" });
      const ids = tools.map((t) => t.id);

      // The skill lands in the same result set as openapi.previewSpec /
      // openapi.addSource — that's the whole point of the naming convention.
      expect(ids).toContain("skills.openapi.adding-a-source");
      expect(ids).toContain("openapi.previewSpec");
      expect(ids).toContain("openapi.addSource");
    }),
  );

  it.effect("more specific queries still find the skill", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin(),
            skillsPlugin({ skills: [...openapiSkills] }),
          ] as const,
        }),
      );

      const tools = yield* executor.tools.list({ query: "adding" });
      expect(tools.map((t) => t.id)).toContain(
        "skills.openapi.adding-a-source",
      );
    }),
  );

  it.effect("invoking the skill returns markdown that references the real tools", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin(),
            skillsPlugin({ skills: [...openapiSkills] }),
          ] as const,
        }),
      );

      const body = (yield* executor.tools.invoke(
        "skills.openapi.adding-a-source",
        {},
      )) as string;

      // The skill is useless if it doesn't name the tools an agent is
      // supposed to chain. These assertions pin the body to the public
      // API surface — if a tool gets renamed, this test catches the
      // skill going stale.
      expect(body).toContain("openapi.previewSpec");
      expect(body).toContain("openapi.addSource");
    }),
  );
});

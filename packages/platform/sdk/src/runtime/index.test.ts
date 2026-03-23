import {
  describe,
  expect,
  it,
} from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  RuntimeSourceCatalogStoreService,
} from "./catalog/source/runtime";
import {
  prewarmWorkspaceSourceCatalogToolIndex,
} from "./index";

describe("runtime startup prewarm", () => {
  it.effect("warms the workspace source tool index for the active installation", () =>
    Effect.gen(function* () {
      const calls: Array<{
        scopeId: string;
        actorScopeId: string | null | undefined;
      }> = [];

      yield* prewarmWorkspaceSourceCatalogToolIndex({
        scopeId: "ws_test" as any,
        actorScopeId: "acc_test" as any,
      }).pipe(
        Effect.provideService(
          RuntimeSourceCatalogStoreService,
          RuntimeSourceCatalogStoreService.of({
            loadWorkspaceSourceCatalogs: () => Effect.die("unexpected catalog load"),
            loadSourceWithCatalog: () => Effect.die("unexpected source load"),
            loadWorkspaceSourceCatalogToolIndex: (input) => {
              calls.push(input as any);
              return Effect.succeed([]);
            },
            loadWorkspaceSourceCatalogToolByPath: () => Effect.die("unexpected tool lookup"),
          }),
        ),
      );

      expect(calls).toEqual([{
        scopeId: "ws_test",
        actorScopeId: "acc_test",
      }]);
    }));
});

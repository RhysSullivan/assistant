import { describe, expect, it } from "@effect/vitest";
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";

import { api } from "./_generated/api";
import { executeRunImpl } from "./executor";
import schema from "./schema";

const setup = () =>
  convexTest(schema, {
    "./http.ts": () => import("./http"),
    "./mcp.ts": () => import("./mcp"),
    "./executor.ts": () => import("./executor"),
    "./runtimeCallbacks.ts": () => import("./runtimeCallbacks"),
    "./controlPlane.ts": () => import("./controlPlane"),
    "./_generated/api.js": () => import("./_generated/api.js"),
  });

describe("Convex executor and control-plane", () => {
  it.effect("executes code via executeRunImpl", () =>
    Effect.gen(function* () {
      const result = yield* executeRunImpl({
        code: "return 6 * 7;",
      });

      expect(result.status).toBe("completed");
      expect(result.result).toBe(42);
    }),
  );

  it.effect("upserts, lists, and removes sources", () =>
    Effect.gen(function* () {
      const t = setup();

      const added = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertSource, {
          workspaceId: "ws_1",
          payload: {
            id: "src_1",
            name: "Weather",
            kind: "openapi",
            endpoint: "https://example.com/openapi.json",
            enabled: true,
            configJson: "{}",
            status: "draft",
            sourceHash: null,
            lastError: null,
          },
        }),
      )) as {
        id: string;
        workspaceId: string;
        name: string;
      };

      expect(added.id).toBe("src_1");
      expect(added.workspaceId).toBe("ws_1");
      expect(added.name).toBe("Weather");

      const listed = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSources, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        id: string;
      }>;

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe("src_1");

      const removed = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.removeSource, {
          workspaceId: "ws_1",
          sourceId: "src_1",
        }),
      )) as {
        removed: boolean;
      };

      expect(removed.removed).toBe(true);

      const listedAfterRemove = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSources, {
          workspaceId: "ws_1",
        }),
      )) as Array<unknown>;

      expect(listedAfterRemove).toHaveLength(0);
    }),
  );
});

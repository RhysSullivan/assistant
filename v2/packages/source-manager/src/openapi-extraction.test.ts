import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { extractOpenApiManifest } from "./openapi-extraction";

describe("extractOpenApiManifest invocation metadata", () => {
  it.effect("extracts parameter and request body metadata", () =>
    Effect.gen(function* () {
      const openApiSpec = {
        openapi: "3.1.0",
        paths: {
          "/users/{userId}": {
            parameters: [
              { name: "userId", in: "path" },
              { name: "x-org-id", in: "header", required: true },
            ],
            get: {
              operationId: "getUser",
              summary: "Get user",
              parameters: [
                { name: "include", in: "query" },
                { name: "x-org-id", in: "header", required: false },
              ],
            },
            post: {
              summary: "Update user",
              requestBody: {
                required: true,
                content: {
                  "application/merge-patch+json": {},
                  "application/json": {},
                },
              },
            },
          },
        },
      };

      const manifest = yield* extractOpenApiManifest("test-source", openApiSpec);

      const getTool = manifest.tools.find((tool) => tool.toolId === "getUser");
      expect(getTool).toBeDefined();
      if (!getTool) {
        throw new Error("expected getUser tool");
      }

      expect(getTool.invocation.method).toBe("get");
      expect(getTool.invocation.pathTemplate).toBe("/users/{userId}");
      expect(getTool.invocation.requestBody).toBeNull();

      expect(getTool.invocation.parameters).toEqual(
        expect.arrayContaining([
          { name: "userId", location: "path", required: true },
          { name: "x-org-id", location: "header", required: false },
          { name: "include", location: "query", required: false },
        ]),
      );

      const postTool = manifest.tools.find(
        (tool) => tool.toolId === "post_users_userid",
      );
      expect(postTool).toBeDefined();
      if (!postTool) {
        throw new Error("expected post tool");
      }

      expect(postTool.invocation.requestBody).toEqual({
        required: true,
        contentTypes: ["application/json", "application/merge-patch+json"],
      });
    }),
  );
});

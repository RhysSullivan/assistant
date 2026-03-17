import { describe, expect, it } from "@effect/vitest";
import { assertInclude, assertTrue } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";

import { parseOpenApiDocument } from "./document";

describe("openapi-document", () => {
  it.effect("parses JSON OpenAPI document text", () =>
    Effect.gen(function* () {
      const parsed = parseOpenApiDocument(
        JSON.stringify({ openapi: "3.1.0", paths: {} }),
      ) as { openapi: string };

      expect(parsed.openapi).toBe("3.1.0");
    }),
  );

  it.effect("parses YAML OpenAPI document text", () =>
    Effect.gen(function* () {
      const parsed = parseOpenApiDocument([
        "openapi: 3.1.0",
        "paths:",
        "  /health:",
        "    get:",
        "      operationId: health",
        "      responses:",
        "        '200':",
        "          description: ok",
      ].join("\n")) as { openapi: string };

      expect(parsed.openapi).toBe("3.1.0");
    }),
  );

  it.effect("fails for empty document", () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.either(
        Effect.try({
          try: () => parseOpenApiDocument("   "),
          catch: (error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
        }),
      );

      assertTrue(outcome._tag === "Left");
      if (outcome._tag === "Left" && outcome.left instanceof Error) {
        assertInclude(outcome.left.message, "OpenAPI document is empty");
      }
    }),
  );
});

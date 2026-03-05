import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { parseOpenApiDocument } from "./openapi-document";

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

      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left" && outcome.left instanceof Error) {
        expect(outcome.left.message).toContain("OpenAPI document is empty");
      }
    }),
  );
});

// ---------------------------------------------------------------------------
// Regression test for github.com/RhysSullivan/executor/issues/466.
//
// When an OpenAPI spec declares no `security` block and no
// `components.securitySchemes` (e.g. Microsoft Graph), previewSpec must still
// succeed and return empty `headerPresets`, `oauth2Presets`, `authStrategies`,
// and `securitySchemes`. This pins that contract so the React layer can rely
// on it.
//
// IMPORTANT — UI counterpart: `packages/plugins/openapi/src/react/AddOpenApiSource.tsx`
// must render the static "Custom" and "None" radios even when these arrays
// are empty, otherwise the user sees only the Authentication heading with no
// controls (the original bug). Do not gate the RadioGroup on these arrays.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { previewSpec as previewSpecRaw } from "./preview";

const previewSpec = (input: string) =>
  previewSpecRaw(input).pipe(Effect.provide(FetchHttpClient.layer));

describe("previewSpec with no security", () => {
  it.effect("returns empty auth arrays when spec has no security and no securitySchemes", () =>
    Effect.gen(function* () {
      const spec = {
        openapi: "3.0.0",
        info: { title: "No-Auth API", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/ping": {
            get: { responses: { "200": { description: "ok" } } },
          },
        },
      };
      const preview = yield* previewSpec(JSON.stringify(spec));

      expect(preview.securitySchemes).toEqual([]);
      expect(preview.authStrategies).toEqual([]);
      expect(preview.headerPresets).toEqual([]);
      expect(preview.oauth2Presets).toEqual([]);
    }),
  );

  it.effect("returns empty auth arrays when components exists but has no securitySchemes", () =>
    Effect.gen(function* () {
      const spec = {
        openapi: "3.0.0",
        info: { title: "No-Auth API", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        components: {
          schemas: {
            Pong: { type: "object", properties: { ok: { type: "boolean" } } },
          },
        },
        paths: {
          "/ping": {
            get: { responses: { "200": { description: "ok" } } },
          },
        },
      };
      const preview = yield* previewSpec(JSON.stringify(spec));

      expect(preview.securitySchemes).toEqual([]);
      expect(preview.authStrategies).toEqual([]);
      expect(preview.headerPresets).toEqual([]);
      expect(preview.oauth2Presets).toEqual([]);
    }),
  );
});

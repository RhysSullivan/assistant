// ---------------------------------------------------------------------------
// response-fidelity.test.ts
//
// Covers the post-refactor guarantees about how extract.ts / invoke.ts
// handle per-status response schemas, response headers, and
// `readOnly`/`writeOnly` direction filtering.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { parse } from "./parse";
import { extract } from "./extract";
import { invoke } from "./invoke";
import {
  InvocationResult,
  OperationBinding,
  type OperationResponse,
} from "./types";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Layer } from "effect";

// ---------------------------------------------------------------------------
// Stub HttpClient — returns a fixed status + body without real network I/O.
//
// We must hand HttpClient.make a request with an absolute URL (it calls
// `new URL(request.url)` before invoking the handler), so we pre-pend a
// dummy origin at the layer boundary.
// ---------------------------------------------------------------------------

const stubClientLayer = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("http://stub.local"))),
  );

// ---------------------------------------------------------------------------
// Scenario 1: multi-status response schemas
//
// POST /items returns two distinct success shapes — 200 "item returned" vs
// 201 "created with just the id". Both should be preserved in the extracted
// operation, and invoke should tag the response with the matched status.
// ---------------------------------------------------------------------------

const multiStatusSpec = {
  openapi: "3.0.0",
  info: { title: "MultiStatus", version: "1.0.0" },
  paths: {
    "/items": {
      post: {
        operationId: "createItem",
        responses: {
          "200": {
            description: "Item already existed and was returned",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    item: {
                      type: "object",
                      properties: { id: { type: "string" }, name: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          "201": {
            description: "Item was created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("response-fidelity — multi-status response schemas", () => {
  it.effect("preserves both 200 and 201 schemas on the extracted operation", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(multiStatusSpec));
      const result = yield* extract(doc);
      const op = result.operations.find((o) => o.operationId === "createItem")!;
      expect(op).toBeDefined();

      const responses = op.responses;
      expect(Object.keys(responses).sort()).toEqual(["200", "201"]);

      const r200 = responses["200"]!;
      const r201 = responses["201"]!;
      expect(Option.isSome(r200.schema)).toBe(true);
      expect(Option.isSome(r201.schema)).toBe(true);

      const s200 = Option.getOrThrow(r200.schema) as Record<string, unknown>;
      const s201 = Option.getOrThrow(r201.schema) as Record<string, unknown>;
      expect(s200.properties).toHaveProperty("item");
      expect(s201.properties).toHaveProperty("id");
      expect(s201.properties).not.toHaveProperty("item");

      // outputSchema (single-picked) should prefer 200 over 201.
      expect(Option.isSome(op.outputSchema)).toBe(true);
      const preferred = Option.getOrThrow(op.outputSchema) as Record<string, unknown>;
      expect(preferred.properties).toHaveProperty("item");
    }),
  );

  it.effect("invoke tags the InvocationResult with the matched status code", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(multiStatusSpec));
      const result = yield* extract(doc);
      const op = result.operations.find((o) => o.operationId === "createItem")!;
      const binding = new OperationBinding({
        method: op.method,
        pathTemplate: op.pathTemplate,
        parameters: [...op.parameters],
        requestBody: op.requestBody,
      });

      // Server replies 201 — invoke should look up op.responses["201"].
      const res201 = (yield* invoke(binding, {}, {}, op.responses).pipe(
        Effect.provide(stubClientLayer(201, { id: "abc" })),
      )) as InvocationResult;
      expect(res201.status).toBe(201);
      expect(res201.matchedResponseStatus).toBe("201");
      expect(res201.data).toEqual({ id: "abc" });

      // Server replies 200 — invoke should look up op.responses["200"].
      const res200 = (yield* invoke(binding, {}, {}, op.responses).pipe(
        Effect.provide(stubClientLayer(200, { item: { id: "abc", name: "x" } })),
      )) as InvocationResult;
      expect(res200.status).toBe(200);
      expect(res200.matchedResponseStatus).toBe("200");

      // Server replies an undocumented 500 — no schema applies, stays null.
      const res500 = (yield* invoke(binding, {}, {}, op.responses).pipe(
        Effect.provide(stubClientLayer(500, { error: "boom" })),
      )) as InvocationResult;
      expect(res500.matchedResponseStatus).toBeNull();
    }),
  );
});

// ---------------------------------------------------------------------------
// Scenario 2: readOnly on a shared Pet schema — stripped from input, kept
// in output.
// ---------------------------------------------------------------------------

const readOnlySpec = {
  openapi: "3.0.0",
  info: { title: "ReadOnly", version: "1.0.0" },
  paths: {
    "/pets": {
      post: {
        operationId: "createPet",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", readOnly: true },
                  name: { type: "string" },
                  createdAt: { type: "string", readOnly: true },
                },
                required: ["id", "name"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", readOnly: true },
                    name: { type: "string" },
                    createdAt: { type: "string", readOnly: true },
                  },
                  required: ["id", "name"],
                },
              },
            },
          },
        },
      },
    },
    "/pets/{id}": {
      get: {
        operationId: "getPet",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", readOnly: true },
                    name: { type: "string" },
                    createdAt: { type: "string", readOnly: true },
                  },
                  required: ["id", "name"],
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("response-fidelity — readOnly filtering", () => {
  it.effect("strips readOnly fields from POST request body + prunes required", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(readOnlySpec));
      const result = yield* extract(doc);
      const createPet = result.operations.find((o) => o.operationId === "createPet")!;

      const rb = Option.getOrThrow(createPet.requestBody);
      const bodySchema = Option.getOrThrow(rb.schema) as Record<string, unknown>;
      const props = bodySchema.properties as Record<string, unknown>;

      expect(props).not.toHaveProperty("id");
      expect(props).not.toHaveProperty("createdAt");
      expect(props).toHaveProperty("name");
      // `id` was required in the raw schema — it must be removed from required.
      expect(bodySchema.required).toEqual(["name"]);
    }),
  );

  it.effect("keeps readOnly fields on GET output schema", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(readOnlySpec));
      const result = yield* extract(doc);
      const getPet = result.operations.find((o) => o.operationId === "getPet")!;

      const outputSchema = Option.getOrThrow(getPet.outputSchema) as Record<string, unknown>;
      const props = outputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("id");
      expect(props).toHaveProperty("createdAt");
      expect(props).toHaveProperty("name");
    }),
  );

  it.effect("also keeps readOnly fields on the POST's own response schema", () =>
    Effect.gen(function* () {
      // The spec declares `readOnly: true` on `id` in the 201 response shape
      // too — response-direction schemas must not be stripped the way input
      // schemas are.
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(readOnlySpec));
      const result = yield* extract(doc);
      const createPet = result.operations.find((o) => o.operationId === "createPet")!;

      const r201 = createPet.responses["201"]!;
      const respSchema = Option.getOrThrow(r201.schema) as Record<string, unknown>;
      const props = respSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("id");
      expect(props).toHaveProperty("createdAt");
    }),
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: writeOnly on `password` — kept in input, stripped from output.
// ---------------------------------------------------------------------------

const writeOnlySpec = {
  openapi: "3.0.0",
  info: { title: "WriteOnly", version: "1.0.0" },
  paths: {
    "/users": {
      post: {
        operationId: "createUser",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  username: { type: "string" },
                  password: { type: "string", writeOnly: true },
                },
                required: ["username", "password"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    username: { type: "string" },
                    password: { type: "string", writeOnly: true },
                  },
                  required: ["id", "username", "password"],
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("response-fidelity — writeOnly filtering", () => {
  it.effect("keeps writeOnly password on POST request body", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(writeOnlySpec));
      const result = yield* extract(doc);
      const createUser = result.operations.find((o) => o.operationId === "createUser")!;

      const rb = Option.getOrThrow(createUser.requestBody);
      const bodySchema = Option.getOrThrow(rb.schema) as Record<string, unknown>;
      const props = bodySchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("password");
      expect(props).toHaveProperty("username");
      expect(bodySchema.required).toEqual(["username", "password"]);
    }),
  );

  it.effect("strips writeOnly password from response + prunes required", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(writeOnlySpec));
      const result = yield* extract(doc);
      const createUser = result.operations.find((o) => o.operationId === "createUser")!;

      const r201 = createUser.responses["201"]!;
      const respSchema = Option.getOrThrow(r201.schema) as Record<string, unknown>;
      const props = respSchema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty("password");
      expect(props).toHaveProperty("id");
      expect(props).toHaveProperty("username");
      expect(respSchema.required).toEqual(["id", "username"]);
    }),
  );
});

// ---------------------------------------------------------------------------
// Scenario 4: documented response headers extracted into the operation.
// ---------------------------------------------------------------------------

const headerSpec = {
  openapi: "3.0.0",
  info: { title: "HeaderSpec", version: "1.0.0" },
  paths: {
    "/rate-limited": {
      get: {
        operationId: "getRateLimited",
        responses: {
          "200": {
            description: "ok",
            headers: {
              "X-RateLimit-Limit": {
                description: "The number of requests allowed per window",
                schema: { type: "integer" },
              },
              "X-RateLimit-Remaining": {
                schema: { type: "integer" },
              },
            },
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
};

describe("response-fidelity — documented response headers", () => {
  it.effect("lifts header name + schema + description into the response map", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const doc = yield* parse(JSON.stringify(headerSpec));
      const result = yield* extract(doc);
      const op = result.operations.find((o) => o.operationId === "getRateLimited")!;

      const r200: OperationResponse = op.responses["200"]!;
      const byName = new Map(r200.headers.map((h) => [h.name, h]));

      expect(byName.size).toBe(2);

      const limit = byName.get("X-RateLimit-Limit")!;
      expect(limit).toBeDefined();
      expect(Option.getOrNull(limit.description)).toBe(
        "The number of requests allowed per window",
      );
      const limitSchema = Option.getOrThrow(limit.schema) as Record<string, unknown>;
      expect(limitSchema.type).toBe("integer");

      const remaining = byName.get("X-RateLimit-Remaining")!;
      expect(remaining).toBeDefined();
      expect(Option.isNone(remaining.description)).toBe(true);
      const remainingSchema = Option.getOrThrow(remaining.schema) as Record<string, unknown>;
      expect(remainingSchema.type).toBe("integer");
    }),
  );
});

import { describe, expect, test } from "bun:test";
import { traverseSchema } from "./schema-traverse";

describe("traverseSchema type labels", () => {
  test("infers object when schema has properties but no explicit type", () => {
    const schema = {
      type: "object",
      properties: {
        body: {
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
    } satisfies Record<string, unknown>;

    const { entries } = traverseSchema(schema);
    const body = entries.find((entry) => entry.path === "body");

    expect(body).toBeDefined();
    expect(body?.type).toBe("object");
    expect(body?.typeLabel).toBe("object");
  });

  test("dedupes oneOf object variants in array item labels", () => {
    const schema = {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: {
            oneOf: [
              { type: "object", properties: { email: { type: "string" } } },
              { type: "object", properties: { ip: { type: "string" } } },
            ],
          },
        },
      },
    } satisfies Record<string, unknown>;

    const { entries } = traverseSchema(schema);
    const include = entries.find((entry) => entry.path === "include");

    expect(include).toBeDefined();
    expect(include?.type).toBe("array");
    expect(include?.typeLabel).toBe("object[]");
  });
});

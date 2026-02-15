import { expect, test } from "bun:test";
import { jsonSchemaTypeHintFallback } from "./schema-hints";

test("jsonSchemaTypeHintFallback collapses simple oneOf object union", () => {
  const schema = {
    oneOf: [
      {
        type: "object",
        properties: {
          uid: { type: "string" },
          updated: { type: "number" },
        },
        required: ["uid", "updated"],
      },
      {
        type: "object",
        properties: {
          uid: { type: "string" },
        },
        required: ["uid"],
      },
    ],
  };

  expect(jsonSchemaTypeHintFallback(schema)).toBe("{ uid: string; updated?: number }");
});

test("jsonSchemaTypeHintFallback factors common object fields in oneOf", () => {
  const schema = {
    oneOf: [
      {
        type: "object",
        properties: {
          domain: { type: "string" },
          type: { enum: ["A"] },
          value: { type: "string" },
        },
        required: ["domain", "type", "value"],
      },
      {
        type: "object",
        properties: {
          domain: { type: "string" },
          type: { enum: ["AAAA"] },
          value: { type: "string" },
        },
        required: ["domain", "type", "value"],
      },
    ],
  };

  const hint = jsonSchemaTypeHintFallback(schema);
  expect(hint).toContain("domain: string");
  expect(hint).toContain("value: string");
  expect(jsonSchemaTypeHintFallback(schema)).toContain("& (");
  expect(jsonSchemaTypeHintFallback(schema)).toContain("type: \"A\"");
  expect(jsonSchemaTypeHintFallback(schema)).toContain("type: \"AAAA\"");
});

test("jsonSchemaTypeHintFallback parenthesizes union inside intersection", () => {
  const schema = {
    allOf: [
      {
        type: "object",
        properties: { domain: { type: "string" } },
        required: ["domain"],
      },
      {
        oneOf: [
          { type: "object", properties: { type: { enum: ["A"] }, value: { type: "string" } }, required: ["type", "value"] },
          { type: "object", properties: { type: { enum: ["B"] }, id: { type: "number" } }, required: ["type", "id"] },
        ],
      },
    ],
  };

  const hint = jsonSchemaTypeHintFallback(schema);
  expect(hint).toContain("& (");
  expect(hint).toContain("| ");
});

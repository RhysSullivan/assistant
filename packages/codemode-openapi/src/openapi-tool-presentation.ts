import { typeSignatureFromSchemaJson } from "@executor/codemode-core";

import type {
  OpenApiExample,
  OpenApiToolDocumentation,
} from "./openapi-types";
import {
  openApiProviderDataJsonFromDefinition,
  type OpenApiToolDefinition,
} from "./openapi-definitions";

const parseJson = (value: string): unknown | undefined => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isStrictEmptyObjectSchema = (value: unknown): boolean => {
  const schema = asRecord(value);
  if (schema.type !== "object" && schema.properties === undefined) {
    return false;
  }

  const properties = asRecord(schema.properties);
  return Object.keys(properties).length === 0 && schema.additionalProperties === false;
};

export const openApiOutputTypeSignatureFromSchemaJson = (
  schemaJson: string | undefined,
  maxLength: number = 320,
 ): string => {
  if (!schemaJson) {
    return "void";
  }

  const parsed = parseJson(schemaJson);
  if (parsed === undefined) {
    return "unknown";
  }

  if (isStrictEmptyObjectSchema(parsed)) {
    return "{}";
  }

  return typeSignatureFromSchemaJson(schemaJson, "unknown", maxLength);
};

const firstExample = (
  examples: ReadonlyArray<OpenApiExample> | undefined,
): OpenApiExample | undefined => examples?.[0];

const buildExampleInputJson = (
  documentation: OpenApiToolDocumentation | undefined,
): string | undefined => {
  if (!documentation) {
    return undefined;
  }

  const input: Record<string, unknown> = {};

  for (const parameter of documentation.parameters) {
    const example = firstExample(parameter.examples);
    if (!example) {
      continue;
    }

    const parsedValue = parseJson(example.valueJson);
    if (parsedValue !== undefined) {
      input[parameter.name] = parsedValue;
    }
  }

  const requestBodyExample = firstExample(documentation.requestBody?.examples);
  if (requestBodyExample) {
    const parsedValue = parseJson(requestBodyExample.valueJson);
    if (parsedValue !== undefined) {
      input.body = parsedValue;
    }
  }

  return Object.keys(input).length > 0 ? JSON.stringify(input) : undefined;
};

const buildExampleOutputJson = (
  documentation: OpenApiToolDocumentation | undefined,
): string | undefined => firstExample(documentation?.response?.examples)?.valueJson;

export type OpenApiToolPresentation = {
  inputType: string;
  outputType: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  exampleInputJson?: string;
  exampleOutputJson?: string;
  providerDataJson: string;
};

export const buildOpenApiToolPresentation = (input: {
  definition: OpenApiToolDefinition;
}): OpenApiToolPresentation => {
  const inputSchemaJson = input.definition.typing?.inputSchemaJson;
  const outputSchemaJson = input.definition.typing?.outputSchemaJson;
  const exampleInputJson = buildExampleInputJson(input.definition.documentation);
  const exampleOutputJson = buildExampleOutputJson(input.definition.documentation);

  return {
    inputType: typeSignatureFromSchemaJson(inputSchemaJson, "unknown", Infinity),
    outputType: openApiOutputTypeSignatureFromSchemaJson(outputSchemaJson, Infinity),
    ...(inputSchemaJson ? { inputSchemaJson } : {}),
    ...(outputSchemaJson ? { outputSchemaJson } : {}),
    ...(exampleInputJson ? { exampleInputJson } : {}),
    ...(exampleOutputJson ? { exampleOutputJson } : {}),
    providerDataJson: openApiProviderDataJsonFromDefinition(input.definition),
  };
};

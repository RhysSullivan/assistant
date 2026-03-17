import * as Match from "effect/Match";
import { typeSignatureFromSchema } from "@executor/codemode-core";

import type {
  OpenApiExample,
  OpenApiMediaContent,
  OpenApiInvocationPayload,
  OpenApiRefHintTable,
  OpenApiResponseVariant,
  OpenApiToolDocumentation,
  OpenApiToolProviderData,
} from "./types";
import {
  openApiProviderDataFromDefinition,
  type OpenApiToolDefinition,
} from "./definitions";
import {
  resolveSchemaWithRefHints,
  resolveTypingSchemasWithRefHints,
} from "./schema-refs";

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

export const openApiOutputTypeSignatureFromSchema = (
  schema: unknown,
  maxLength: number = 320,
 ): string => {
  if (schema === undefined || schema === null) {
    return "void";
  }

  if (isStrictEmptyObjectSchema(schema)) {
    return "{}";
  }

  return typeSignatureFromSchema(schema, "unknown", maxLength);
};

const firstExample = (
  examples: ReadonlyArray<OpenApiExample> | undefined,
): OpenApiExample | undefined => examples?.[0];

const schemaProperty = (
  schema: unknown,
  propertyName: string,
): unknown | undefined => {
  const record = asRecord(schema);
  const properties = asRecord(record.properties);
  return properties[propertyName];
};

const groupedSchemaForParameter = (
  schema: unknown,
  location: OpenApiInvocationPayload["parameters"][number]["location"],
  name: string,
): unknown | undefined => {
  const direct = schemaProperty(schema, name);
  if (direct !== undefined) {
    return direct;
  }

  const groupKey =
    location === "header"
      ? "headers"
      : location === "cookie"
        ? "cookies"
        : location;
  const groupSchema = schemaProperty(schema, groupKey);
  return groupSchema === undefined ? undefined : schemaProperty(groupSchema, name);
};

const preferredContentSchema = (
  contents: ReadonlyArray<OpenApiMediaContent> | undefined,
): unknown | undefined => {
  if (!contents || contents.length === 0) {
    return undefined;
  }

  const preferred = [...contents].sort((left, right) => left.mediaType.localeCompare(right.mediaType))
    .find((content) => content.mediaType === "application/json")
    ?? [...contents].find((content) => content.mediaType.toLowerCase().includes("+json"))
    ?? [...contents].find((content) => content.mediaType.toLowerCase().includes("json"))
    ?? contents[0];

  return preferred?.schema;
};

const withDescription = (
  schema: unknown,
  description: string | undefined,
): unknown => {
  if (!description) {
    return schema;
  }

  const record = asRecord(schema);
  if (Object.keys(record).length === 0) {
    return schema;
  }

  return {
    ...record,
    description,
  };
};

const callInputSchemaFromInvocation = (input: {
  invocation: OpenApiInvocationPayload;
  documentation?: OpenApiToolDocumentation;
  parameterSourceSchema?: unknown;
  requestBodySchema?: unknown;
}): Record<string, unknown> | undefined => {
  const invocation = input.invocation;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of invocation.parameters) {
    const matchingDocs = input.documentation?.parameters.find((candidate) =>
      candidate.name === parameter.name && candidate.location === parameter.location
    );
    const parameterSchema = groupedSchemaForParameter(
      input.parameterSourceSchema,
      parameter.location,
      parameter.name,
    ) ?? preferredContentSchema(parameter.content) ?? {
      type: "string",
    };

    properties[parameter.name] = withDescription(
      parameterSchema,
      matchingDocs?.description,
    );
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (invocation.requestBody) {
    properties.body = withDescription(
      input.requestBodySchema ?? preferredContentSchema(invocation.requestBody.contents) ?? {
        type: "object",
      },
      input.documentation?.requestBody?.description,
    );
    if (invocation.requestBody.required) {
      required.push("body");
    }
  }

  return Object.keys(properties).length > 0
    ? {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }
    : undefined;
};

const schemaRefPlaceholder = (
  refHintKey: string | undefined,
): Record<string, string> | undefined =>
  typeof refHintKey === "string" && refHintKey.length > 0
    ? { $ref: refHintKey }
    : undefined;

const inferRefHintPlaceholders = (
  definition: OpenApiToolDefinition,
): {
  requestBodySchema?: Record<string, string>;
  outputSchema?: Record<string, string>;
} => {
  const refHintKeys = definition.typing?.refHintKeys ?? [];

  return Match.value(definition.invocation.requestBody).pipe(
    Match.when(null, () => ({
      outputSchema: schemaRefPlaceholder(refHintKeys[0]),
    })),
    Match.orElse(() => ({
      requestBodySchema: schemaRefPlaceholder(refHintKeys[0]),
      outputSchema: schemaRefPlaceholder(refHintKeys[1]),
    })),
  );
};

const resolvePresentationSchemas = (input: {
  definition: OpenApiToolDefinition;
  refHintTable?: Readonly<OpenApiRefHintTable>;
}): {
  inputSchema?: unknown;
  outputSchema?: unknown;
} => {
  const resolvedTyping = resolveTypingSchemasWithRefHints(
    input.definition.typing,
    input.refHintTable,
  );
  const inferredRefPlaceholders = inferRefHintPlaceholders(input.definition);
  const resolvedRequestBodySchema = resolveSchemaWithRefHints(
    inferredRefPlaceholders.requestBodySchema,
    input.refHintTable,
  );
  const requestBodySchema =
    schemaProperty(resolvedTyping.inputSchema, "body")
    ?? schemaProperty(resolvedTyping.inputSchema, "input")
    ?? (resolvedRequestBodySchema !== undefined && resolvedRequestBodySchema !== null
      ? resolvedRequestBodySchema
      : undefined);

  const inputSchema = callInputSchemaFromInvocation({
    invocation: input.definition.invocation,
    documentation: input.definition.documentation,
    parameterSourceSchema: resolvedTyping.inputSchema,
    ...(requestBodySchema !== undefined
      ? { requestBodySchema }
      : {}),
  })
    ?? resolvedTyping.inputSchema
    ?? undefined;
  const outputSchema =
    resolvedTyping.outputSchema
    ?? resolveSchemaWithRefHints(
      inferredRefPlaceholders.outputSchema,
      input.refHintTable,
    );

  return {
    ...(inputSchema !== undefined && inputSchema !== null ? { inputSchema } : {}),
    ...(outputSchema !== undefined && outputSchema !== null ? { outputSchema } : {}),
  };
};

const resolveResponseVariantsWithRefHints = (input: {
  variants: ReadonlyArray<OpenApiResponseVariant> | undefined;
  refHintTable?: Readonly<OpenApiRefHintTable>;
}): ReadonlyArray<OpenApiResponseVariant> | undefined => {
  if (!input.variants || input.variants.length === 0) {
    return undefined;
  }

  return input.variants.map((variant) => {
    const resolvedSchema = resolveSchemaWithRefHints(
      variant.schema,
      input.refHintTable,
    );

    return {
      ...variant,
      ...(resolvedSchema !== undefined ? { schema: resolvedSchema } : {}),
    };
  });
};

const buildExampleInput = (
  documentation: OpenApiToolDocumentation | undefined,
): Record<string, unknown> | undefined => {
  if (!documentation) {
    return undefined;
  }

  const input: Record<string, unknown> = {};

  for (const parameter of documentation.parameters) {
    const example = firstExample(parameter.examples);
    if (!example) {
      continue;
    }

    input[parameter.name] = JSON.parse(example.valueJson) as unknown;
  }

  const requestBodyExample = firstExample(documentation.requestBody?.examples);
  if (requestBodyExample) {
    input.body = JSON.parse(requestBodyExample.valueJson) as unknown;
  }

  return Object.keys(input).length > 0 ? input : undefined;
};

const buildExampleOutput = (
  documentation: OpenApiToolDocumentation | undefined,
): unknown | undefined => {
  const example = firstExample(documentation?.response?.examples)?.valueJson;
  return example ? JSON.parse(example) as unknown : undefined;
};

export type OpenApiToolPresentation = {
  inputTypePreview: string;
  outputTypePreview: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  exampleInput?: unknown;
  exampleOutput?: unknown;
  providerData: OpenApiToolProviderData;
};

export const buildOpenApiToolPresentation = (input: {
  definition: OpenApiToolDefinition;
  refHintTable?: Readonly<OpenApiRefHintTable>;
}): OpenApiToolPresentation => {
  const { inputSchema, outputSchema } = resolvePresentationSchemas(input);
  const responses = resolveResponseVariantsWithRefHints({
    variants: input.definition.responses,
    refHintTable: input.refHintTable,
  });
  const exampleInput = buildExampleInput(input.definition.documentation);
  const exampleOutput = buildExampleOutput(input.definition.documentation);

  return {
    inputTypePreview: typeSignatureFromSchema(inputSchema, "unknown", Infinity),
    outputTypePreview: openApiOutputTypeSignatureFromSchema(outputSchema, Infinity),
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(exampleInput !== undefined ? { exampleInput } : {}),
    ...(exampleOutput !== undefined ? { exampleOutput } : {}),
    providerData: {
      ...openApiProviderDataFromDefinition(input.definition),
      ...(responses ? { responses } : {}),
    } satisfies OpenApiToolProviderData,
  };
};

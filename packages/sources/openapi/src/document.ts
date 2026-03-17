import { parse as parseYaml } from "yaml";

import type { OpenApiJsonObject } from "./types";

const isOpenApiJsonObject = (value: unknown): value is OpenApiJsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonDocument = (input: string): unknown => JSON.parse(input);

const parseYamlDocument = (input: string): unknown => parseYaml(input);

const parseDocument = (input: string): unknown => {
  try {
    return parseJsonDocument(input);
  } catch {
    return parseYamlDocument(input);
  }
};

export const parseOpenApiDocument = (input: string): OpenApiJsonObject => {
  const text = input.trim();
  if (text.length === 0) {
    throw new Error("OpenAPI document is empty");
  }

  try {
    const parsed = parseDocument(text);
    if (!isOpenApiJsonObject(parsed)) {
      throw new Error("OpenAPI document must parse to an object");
    }

    return parsed;
  } catch (cause) {
    throw new Error(
      `Unable to parse OpenAPI document as JSON or YAML: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
};

export const fetchOpenApiDocument = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed fetching OpenAPI spec (${response.status})`);
  }

  return response.text();
};

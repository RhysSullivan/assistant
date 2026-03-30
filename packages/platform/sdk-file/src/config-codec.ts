import {
  type ParseError as JsoncParseError,
  parse as parseJsoncDocument,
  printParseErrorCode,
} from "jsonc-parser/lib/esm/main.js";

import {
  ExecutorScopeConfigSchema,
  type ExecutorScopeConfig,
} from "@executor/platform-sdk/schema";
import * as Schema from "effect/Schema";
import {
  ExecutorScopeConfigDecodeError,
  unknownLocalErrorDetails,
} from "./errors";

export const decodeExecutorScopeConfig = Schema.decodeUnknownSync(
  ExecutorScopeConfigSchema,
  {
    onExcessProperty: "error",
  },
);

export const encodeExecutorScopeConfig = (
  config: ExecutorScopeConfig,
): string => `${JSON.stringify(config, null, 2)}\n`;

const formatJsoncParseErrors = (
  content: string,
  errors: readonly JsoncParseError[],
): string => {
  const lines = content.split("\n");

  return errors
    .map((error) => {
      const beforeOffset = content.slice(0, error.offset).split("\n");
      const line = beforeOffset.length;
      const column = beforeOffset[beforeOffset.length - 1]?.length ?? 0;
      const lineText = lines[line - 1];
      const location = `line ${line}, column ${column + 1}`;
      const detail = printParseErrorCode(error.error);

      if (!lineText) {
        return `${detail} at ${location}`;
      }

      return `${detail} at ${location}\n${lineText}`;
    })
    .join("\n");
};

export const parseJsoncValue = (input: {
  path: string;
  content: string;
}): unknown => {
  const errors: JsoncParseError[] = [];
  const parsed = parseJsoncDocument(input.content, errors, {
    allowTrailingComma: true,
  });

  if (errors.length > 0) {
    throw new ExecutorScopeConfigDecodeError({
      message: `Invalid executor config at ${input.path}: ${formatJsoncParseErrors(input.content, errors)}`,
      path: input.path,
      details: formatJsoncParseErrors(input.content, errors),
    });
  }

  return parsed;
};

export const parseExecutorScopeConfig = (input: {
  path: string;
  content: string;
}): ExecutorScopeConfig => {
  try {
    return decodeExecutorScopeConfig(
      parseJsoncValue({
        path: input.path,
        content: input.content,
      }),
    );
  } catch (cause) {
    if (cause instanceof ExecutorScopeConfigDecodeError) {
      throw cause;
    }
    throw new ExecutorScopeConfigDecodeError({
      message: `Invalid executor config at ${input.path}: ${unknownLocalErrorDetails(cause)}`,
      path: input.path,
      details: unknownLocalErrorDetails(cause),
    });
  }
};

import type { OpenApiOAuthSessionStorage } from "@executor/plugin-openapi-sdk";
import {
  OpenApiOAuthSessionSchema,
} from "@executor/plugin-openapi-shared";

import {
  pluginSessionStoragePath,
  readJsonFile,
  removeJsonFile,
  writeJsonFile,
} from "./json-file-storage";

export const createFileOpenApiOAuthSessionStorage = (input: {
  rootDir: string;
}): OpenApiOAuthSessionStorage => ({
  get: (sessionId) =>
    readJsonFile({
      path: pluginSessionStoragePath({
        rootDir: input.rootDir,
        sessionId,
      }),
      schema: OpenApiOAuthSessionSchema,
    }),
  put: ({ sessionId, value }) =>
    writeJsonFile({
      path: pluginSessionStoragePath({
        rootDir: input.rootDir,
        sessionId,
      }),
      schema: OpenApiOAuthSessionSchema,
      value,
    }),
  remove: (sessionId) =>
    removeJsonFile(
      pluginSessionStoragePath({
        rootDir: input.rootDir,
        sessionId,
      }),
    ),
});

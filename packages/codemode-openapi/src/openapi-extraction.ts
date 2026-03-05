import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

import { extractOpenApiManifestJsonWithWasm } from "./openapi-extractor-wasm";
import { OpenApiToolManifestSchema, type OpenApiToolManifest } from "./openapi-types";

type OpenApiExtractionStage = "validate" | "extract";

export class OpenApiExtractionError extends Data.TaggedError("OpenApiExtractionError")<{
  sourceName: string;
  stage: OpenApiExtractionStage;
  message: string;
  details: string | null;
}> {}

const manifestFromJsonSchema = Schema.parseJson(OpenApiToolManifestSchema);
const decodeManifestFromJson = Schema.decodeUnknown(manifestFromJsonSchema);

const toExtractionError = (
  sourceName: string,
  stage: OpenApiExtractionStage,
  cause: unknown,
): OpenApiExtractionError =>
  cause instanceof OpenApiExtractionError
    ? cause
    : new OpenApiExtractionError({
        sourceName,
        stage,
        message: "OpenAPI extraction failed",
        details: ParseResult.isParseError(cause)
          ? ParseResult.TreeFormatter.formatErrorSync(cause)
          : String(cause),
      });

const normalizeOpenApiDocumentText = (
  sourceName: string,
  openApiSpec: unknown,
): Effect.Effect<string, OpenApiExtractionError> => {
  if (typeof openApiSpec === "string") {
    return Effect.succeed(openApiSpec);
  }

  return Effect.try({
    try: () => JSON.stringify(openApiSpec),
    catch: (cause) =>
      new OpenApiExtractionError({
        sourceName,
        stage: "validate",
        message: "Unable to serialize OpenAPI input",
        details: String(cause),
      }),
  });
};

export const extractOpenApiManifest = (
  sourceName: string,
  openApiSpec: unknown,
): Effect.Effect<OpenApiToolManifest, OpenApiExtractionError> =>
  Effect.gen(function* () {
    const openApiDocumentText = yield* normalizeOpenApiDocumentText(
      sourceName,
      openApiSpec,
    );

    const manifestJson = yield* Effect.tryPromise({
      try: () => extractOpenApiManifestJsonWithWasm(sourceName, openApiDocumentText),
      catch: (cause) => toExtractionError(sourceName, "extract", cause),
    });

    return yield* pipe(
      decodeManifestFromJson(manifestJson),
      Effect.mapError((cause) => toExtractionError(sourceName, "extract", cause)),
    );
  });

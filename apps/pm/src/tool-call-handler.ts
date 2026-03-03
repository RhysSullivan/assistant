import {
  type RuntimeToolCallResult,
  type RuntimeToolCallRequest,
} from "@executor-v2/sdk";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { readPmEnvironment } from "./env";

const pmEnvironment = readPmEnvironment();

class PmToolCallHttpRequestError extends Data.TaggedError(
  "PmToolCallHttpRequestError",
)<{
  message: string;
  details: string | null;
}> {}

const RuntimeToolCallCredentialContextSchema = Schema.Struct({
  workspaceId: Schema.String,
  sourceKey: Schema.String,
  organizationId: Schema.optional(Schema.NullOr(Schema.String)),
  accountId: Schema.optional(Schema.NullOr(Schema.String)),
});

const RuntimeToolCallRequestSchema = Schema.Struct({
  runId: Schema.String,
  callId: Schema.String,
  toolPath: Schema.String,
  input: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
  credentialContext: Schema.optional(RuntimeToolCallCredentialContextSchema),
});

const decodeRuntimeToolCallRequest = Schema.decodeUnknown(RuntimeToolCallRequestSchema);

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const readHeader = (request: Request, name: string): string | null =>
  trim(request.headers.get(name) ?? undefined) ?? null;

const runtimeCallbackSecret = (): string | null =>
  pmEnvironment.runtimeCallbackSecret ?? null;

const toDeniedResult = (status: number, error: string): Response =>
  Response.json(
    {
      ok: false,
      kind: "failed",
      error,
    } satisfies RuntimeToolCallResult,
    { status },
  );

const enforceToolCallSecurity = (request: Request): Response | null => {
  const expectedSecret = runtimeCallbackSecret();
  if (!expectedSecret) {
    return toDeniedResult(503, "Runtime callback secret is not configured");
  }

  const providedSecret = readHeader(request, "x-internal-secret");
  if (!providedSecret) {
    return toDeniedResult(401, "Runtime callback authentication is required");
  }

  if (providedSecret !== expectedSecret) {
    return toDeniedResult(403, "Runtime callback authentication failed");
  }

  return null;
};

const decodeRequestBodyError = (cause: unknown): PmToolCallHttpRequestError =>
  new PmToolCallHttpRequestError({
    message: "Invalid runtime callback request body",
    details: String(cause),
  });

const decodeRequestPayloadError = (cause: unknown): PmToolCallHttpRequestError =>
  new PmToolCallHttpRequestError({
    message: "Runtime callback request body is invalid",
    details: ParseResult.isParseError(cause)
      ? ParseResult.TreeFormatter.formatErrorSync(cause)
      : String(cause),
  });

const formatHttpRequestError = (error: PmToolCallHttpRequestError): string =>
  error.details && error.details.length > 0
    ? `${error.message}: ${error.details}`
    : error.message;

const decodeToolCallRequest = async (
  request: Request,
): Promise<RuntimeToolCallRequest> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    throw decodeRequestBodyError(cause);
  }

  try {
    return await Effect.runPromise(decodeRuntimeToolCallRequest(body));
  } catch (cause) {
    throw decodeRequestPayloadError(cause);
  }
};

export const createPmToolCallHttpHandler = (
  handleToolCall: (
    input: RuntimeToolCallRequest,
  ) => Promise<RuntimeToolCallResult>,
): ((request: Request) => Promise<Response>) => {
  return async (request: Request) => {
    try {
      const blocked = enforceToolCallSecurity(request);
      if (blocked) {
        return blocked;
      }

      const input = await decodeToolCallRequest(request);
      const result = await handleToolCall(input);
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof PmToolCallHttpRequestError) {
        return Response.json(
          {
            ok: false,
            kind: "failed",
            error: formatHttpRequestError(error),
          } satisfies RuntimeToolCallResult,
          { status: 400 },
        );
      }

      return Response.json(
        {
          ok: false,
          kind: "failed",
          error: String(error),
        } satisfies RuntimeToolCallResult,
        { status: 500 },
      );
    }
  };
};

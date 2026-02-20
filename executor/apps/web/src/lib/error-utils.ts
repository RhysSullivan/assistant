import { z } from "zod";

const errorWithCauseSchema = z.object({
  cause: z.unknown(),
}).passthrough();

const abortErrorSchema = z.object({
  name: z.literal("AbortError"),
}).passthrough();

export function unwrapErrorCause(error: unknown): unknown {
  const parsed = errorWithCauseSchema.safeParse(error);
  return parsed.success ? parsed.data.cause : error;
}

export function resultErrorMessage(error: unknown, fallback: string): string {
  const cause = unwrapErrorCause(error);

  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }

  const parsedCause = z.string().transform((value) => value.trim()).safeParse(cause);
  if (parsedCause.success && parsedCause.data.length > 0) {
    return parsedCause.data;
  }

  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return abortErrorSchema.safeParse(error).success;
}

/**
 * Eden Treaty client for the assistant server.
 */

import { type Treaty, treaty } from "@elysiajs/eden";
import type { App } from "./routes";

export type Client = ReturnType<typeof treaty<App>>;

export function createClient(baseUrl: string): Client {
  return treaty<App>(baseUrl);
}

export class ApiError {
  readonly _tag = "ApiError";
  constructor(readonly status: number, readonly value: unknown) {}
}

function parseApiErrorPayload(error: unknown): { status: number; value?: unknown } | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { status?: unknown; value?: unknown };
  if (typeof candidate.status !== "number" || !Number.isFinite(candidate.status)) {
    return null;
  }

  return { status: candidate.status, value: candidate.value };
}

export async function unwrap<T extends Record<number, unknown>>(
  treatyCall: Promise<Treaty.TreatyResponse<T>>,
): Promise<Treaty.Data<Treaty.TreatyResponse<T>>> {
  const response = await treatyCall;

  if (response.error) {
    const err = response.error as unknown;
    const parsedError = parseApiErrorPayload(err);
    if (parsedError) {
      throw new ApiError(parsedError.status, parsedError.value ?? err);
    }
    throw new ApiError(0, err);
  }

  if (response.data !== undefined) {
    return response.data as Treaty.Data<Treaty.TreatyResponse<T>>;
  }

  throw new ApiError(0, "No data returned from API");
}

export type { App } from "./routes";

"use node";

import { WorkOS } from "@workos-inc/node";
import { Result } from "better-result";
import { z } from "zod";

const workosVaultReferenceSchema = z.object({
  objectId: z.string().optional(),
  id: z.string().optional(),
  apiKey: z.string().optional(),
});

function normalizeUnknownError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeDelayMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeAttempts(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

export function parseWorkosVaultReference(value: unknown): {
  objectId?: string;
  apiKey?: string;
} {
  const parsed = workosVaultReferenceSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  const objectId = (parsed.data.objectId ?? parsed.data.id ?? "").trim();
  const apiKey = (parsed.data.apiKey ?? "").trim();

  return {
    ...(objectId ? { objectId } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function extractWorkosVaultObjectId(value: unknown): string | null {
  const parsed = parseWorkosVaultReference(value);
  return parsed.objectId ?? null;
}

export function resolveWorkosApiKey(explicitApiKey?: string): Result<string, Error> {
  const candidate = explicitApiKey?.trim() || process.env.WORKOS_API_KEY?.trim() || "";
  if (!candidate) {
    return Result.err(new Error("Encrypted storage requires WORKOS_API_KEY"));
  }

  return Result.ok(candidate);
}

export function createWorkosClient(explicitApiKey?: string): Result<WorkOS, Error> {
  const apiKeyResult = resolveWorkosApiKey(explicitApiKey);
  if (apiKeyResult.isErr()) {
    return apiKeyResult;
  }

  return Result.ok(new WorkOS(apiKeyResult.value));
}

export function isWorkosVaultRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("not yet ready")
    || message.includes("can be retried")
    || (message.includes("kek") && message.includes("ready"))
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WorkosVaultRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  exhaustionErrorMessage?: string;
}

export async function withWorkosVaultRetryResult<T>(
  operation: () => Promise<T>,
  options: WorkosVaultRetryOptions = {},
): Promise<Result<T, Error>> {
  const maxAttempts = normalizeAttempts(options.maxAttempts ?? 5, 5);
  const maxDelayMs = normalizeDelayMs(options.maxDelayMs ?? 10_000, 10_000);
  let delayMs = normalizeDelayMs(options.initialDelayMs ?? 250, 250);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const valueResult = await Result.tryPromise(operation);
    if (valueResult.isOk()) {
      return valueResult;
    }

    const cause = valueResult.error.cause;
    const normalizedError = normalizeUnknownError(cause);
    if (!isWorkosVaultRetryableError(normalizedError)) {
      return Result.err(normalizedError);
    }

    if (attempt === maxAttempts) {
      if (options.exhaustionErrorMessage) {
        return Result.err(new Error(options.exhaustionErrorMessage));
      }
      return Result.err(normalizedError);
    }

    await sleep(delayMs);
    delayMs = Math.min(Math.max(0, delayMs * 2), maxDelayMs);
  }

  return Result.err(new Error("WorkOS Vault retry loop exhausted unexpectedly"));
}

import { expect, test } from "bun:test";
import {
  extractWorkosVaultObjectId,
  isWorkosVaultRetryableError,
  parseWorkosVaultReference,
  withWorkosVaultRetryResult,
} from "./workos-vault";

test("parseWorkosVaultReference normalizes object id aliases", () => {
  expect(parseWorkosVaultReference({ objectId: "  secret_123  " })).toEqual({ objectId: "secret_123" });
  expect(parseWorkosVaultReference({ id: "secret_456", apiKey: "  key_abc  " })).toEqual({
    objectId: "secret_456",
    apiKey: "key_abc",
  });
  expect(parseWorkosVaultReference("not-an-object")).toEqual({});
});

test("extractWorkosVaultObjectId returns null when missing", () => {
  expect(extractWorkosVaultObjectId({ apiKey: "key" })).toBeNull();
  expect(extractWorkosVaultObjectId({ id: "secret_789" })).toBe("secret_789");
});

test("isWorkosVaultRetryableError detects retryable vault messages", () => {
  expect(isWorkosVaultRetryableError(new Error("KEK not yet ready"))).toBe(true);
  expect(isWorkosVaultRetryableError(new Error("This can be retried"))).toBe(true);
  expect(isWorkosVaultRetryableError(new Error("Permission denied"))).toBe(false);
});

test("withWorkosVaultRetryResult retries retryable errors and succeeds", async () => {
  let attempts = 0;
  const result = await withWorkosVaultRetryResult(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("KEK not yet ready");
    }
    return "ok";
  }, {
    maxAttempts: 5,
    initialDelayMs: 0,
    maxDelayMs: 1,
  });

  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value).toBe("ok");
  }
  expect(attempts).toBe(3);
});

test("withWorkosVaultRetryResult returns configured exhaustion error", async () => {
  const result = await withWorkosVaultRetryResult(async () => {
    throw new Error("can be retried");
  }, {
    maxAttempts: 2,
    initialDelayMs: 0,
    maxDelayMs: 1,
    exhaustionErrorMessage: "still warming up",
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.message).toBe("still warming up");
  }
});

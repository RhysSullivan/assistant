import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { Cause } from "effect";

const captureException = vi.fn<(...args: unknown[]) => string | undefined>();

vi.mock("@sentry/cloudflare", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const { captureCause } = await import("./observability");

// Mirrors Sentry core's `is.isError`: it picks the proper-Error path iff
// `Object.prototype.toString.call(x) === "[object Error]"`. Anything that
// fails this check goes down the synthetic "<className> captured as exception
// with keys: ..." path that produced the original CauseImpl Sentry issue.
const looksLikeErrorToSentry = (value: unknown): boolean =>
  Object.prototype.toString.call(value) === "[object Error]";

describe("captureCause", () => {
  it("hands Sentry a real Error when the defect is itself a Cause", () => {
    captureException.mockReset();

    // Reproduces the production chain: an inner runPromise rejects with a
    // CauseImpl (from Effect v4's causeSquash), Effect.promise re-wraps it
    // as Die(CauseImpl), and the outer catchCause receives this shape.
    const innerCause = Cause.fail(new Error("inner failure"));
    const outerCause = Cause.die(innerCause);

    captureCause(outerCause);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [primary] = captureException.mock.calls[0]!;
    expect(looksLikeErrorToSentry(primary)).toBe(true);
  });

  it("hands Sentry a real Error for an ordinary failed Cause", () => {
    captureException.mockReset();
    captureCause(Cause.fail(new Error("plain failure")));
    const [primary] = captureException.mock.calls[0]!;
    expect(looksLikeErrorToSentry(primary)).toBe(true);
  });

  it("forwards non-Cause inputs as-is", () => {
    captureException.mockReset();
    const err = new Error("raw");
    captureCause(err);
    expect(captureException).toHaveBeenCalledWith(err);
  });
});

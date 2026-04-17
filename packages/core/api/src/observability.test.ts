// ---------------------------------------------------------------------------
// Edge translation — `StorageError → InternalError(traceId)` behaviour.
//
// SDK code (@executor/sdk) emits raw `StorageError` in its typed
// channel. The HTTP edge has two primitives that translate it:
//
//   - `capture(eff)` — single-Effect wrapper
//   - `withCapture(obj)` — proxy wrapper for whole extensions
//
// Both route through the `ErrorCapture` tag to generate a trace id.
// ErrorCapture is optional — absent hosts just get empty trace ids.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Layer, Ref } from "effect";
import { StorageError, UniqueViolationError } from "@executor/storage-core";

import {
  capture,
  ErrorCapture,
  InternalError,
  withCapture,
} from "./observability";

// Recording ErrorCapture — returns a fixed trace id and accumulates
// every cause it sees in a Ref.
const makeRecorder = (traceId = "trace-xyz") =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<Cause.Cause<unknown>>>([]);
    const layer = Layer.succeed(
      ErrorCapture,
      ErrorCapture.of({
        captureException: (cause) =>
          Ref.update(seen, (prev) => [...prev, cause]).pipe(
            Effect.as(traceId),
          ),
      }),
    );
    return { layer, seen };
  });

describe("capture", () => {
  it.effect("translates StorageError to InternalError with ErrorCapture trace id", () =>
    Effect.gen(function* () {
      const { layer, seen } = yield* makeRecorder("trace-abc");
      const err = new StorageError({ message: "db down", cause: new Error("x") });

      const eff = capture(Effect.fail(err));
      const result = yield* Effect.flip(eff).pipe(Effect.provide(layer));

      expect(result).toBeInstanceOf(InternalError);
      expect(result.traceId).toBe("trace-abc");

      // The recorder saw exactly one cause carrying the original StorageError.
      const causes = yield* Ref.get(seen);
      expect(causes.length).toBe(1);
      const squashed = Cause.squash(causes[0]!) as StorageError;
      expect(squashed).toBeInstanceOf(StorageError);
      expect(squashed.message).toBe("db down");
    }),
  );

  it.effect("empty traceId when no ErrorCapture is wired", () =>
    Effect.gen(function* () {
      const err = new StorageError({ message: "nope", cause: undefined });
      const result = yield* Effect.flip(capture(Effect.fail(err)));
      expect(result).toBeInstanceOf(InternalError);
      expect(result.traceId).toBe("");
    }),
  );

  it.effect("UniqueViolationError dies (becomes a defect — plugins should catchTag before returning)", () =>
    Effect.gen(function* () {
      const err = new UniqueViolationError({ model: "thing" });
      const exit = yield* Effect.exit(capture(Effect.fail(err)));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const defects = Cause.defects(exit.cause);
        expect(Array.from(defects)[0]).toBeInstanceOf(UniqueViolationError);
      }
    }),
  );

  it.effect("non-storage typed failures pass through unchanged", () =>
    Effect.gen(function* () {
      class DomainError {
        readonly _tag = "DomainError" as const;
      }
      const eff = Effect.fail(new DomainError()) as Effect.Effect<
        never,
        DomainError
      >;
      const result = yield* Effect.flip(capture(eff));
      expect(result._tag).toBe("DomainError");
    }),
  );
});

describe("withCapture", () => {
  it.effect("wraps every Effect-returning method on the extension", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeRecorder("trace-ext");

      // Stand-in extension with one failing method and one succeeding
      // method. Walk the proxy to prove translation is structural, not
      // per-method.
      const ext = {
        boom: () =>
          Effect.fail(
            new StorageError({ message: "boom", cause: undefined }),
          ),
        ok: () => Effect.succeed("fine"),
      };
      const wrapped = withCapture(ext);

      const boomResult = yield* Effect.flip(wrapped.boom()).pipe(
        Effect.provide(layer),
      );
      expect(boomResult).toBeInstanceOf(InternalError);
      expect(boomResult.traceId).toBe("trace-ext");

      const okResult = yield* wrapped.ok();
      expect(okResult).toBe("fine");
    }),
  );

  it.effect("recurses into nested plain-object surfaces", () =>
    Effect.gen(function* () {
      const ext = {
        nested: {
          boom: () =>
            Effect.fail(
              new StorageError({ message: "boom", cause: undefined }),
            ),
        },
      };
      const wrapped = withCapture(ext);
      const result = yield* Effect.flip(wrapped.nested.boom());
      expect(result).toBeInstanceOf(InternalError);
    }),
  );

  it.effect("UniqueViolationError becomes a defect through the wrapper", () =>
    Effect.gen(function* () {
      const ext = {
        conflict: () =>
          Effect.fail(new UniqueViolationError({ model: "thing" })),
      };
      const wrapped = withCapture(ext);
      const exit = yield* Effect.exit(wrapped.conflict());
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const defects = Cause.defects(exit.cause);
        expect(Array.from(defects)[0]).toBeInstanceOf(UniqueViolationError);
      }
    }),
  );
});

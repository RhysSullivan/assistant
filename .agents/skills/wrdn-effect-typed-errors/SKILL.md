---
name: wrdn-effect-typed-errors
description: Fix lint findings that use untyped JavaScript error handling instead of Effect typed failures. Use when lint flags new Error, throw, try/catch, Promise.catch, Promise.reject, instanceof Error, unknown error message/stringification, or redundant helpers that only construct tagged errors.
allowed-tools: Read Grep Glob Bash
---

You fix one family of patterns: untyped JavaScript error handling in Effect code.

The preferred boundary is typed `Schema.TaggedError` / `Data.TaggedError` values in the Effect error channel. Construct the tagged error directly at the failure site unless a helper performs real classification or normalization.

## Trace before changing

1. **Identify the boundary.** Is this Effect domain code, React UI code, a third-party callback, or plain test/tooling code?
2. **Find the existing domain errors.** Check nearby `errors.ts`, `Schema.TaggedError`, `Data.TaggedError`, and API `.addError(...)` declarations before adding a new class.
3. **Decide whether a new error is needed.** Add a new tagged error only if callers have a distinct recovery path, HTTP status, UI affordance, retry policy, or telemetry classification.
4. **Preserve the typed channel.** Do not convert typed failures into `Error`, thrown exceptions, `String(error)`, or `.message` reads from unknown values.
5. **Do not hide construction behind trivial helpers.** Inline `new DomainError(...)` unless the helper branches on input or maps an external error format into a domain error.

## Fix shapes

### Throw / new Error

Bad:

```ts
throw new Error("Missing source");
```

Good in `Effect.gen`:

```ts
return yield* new SourceNotFoundError({ sourceId });
```

Good in combinators:

```ts
Effect.fail(new SourceNotFoundError({ sourceId }));
```

If a third-party interface requires throwing, keep the throw at the adapter edge only and convert back into a typed failure as soon as control returns to Effect.

### Effect.fail inside generators

Prefer yielding the error directly in generator code:

```ts
return yield* new SourceNotFoundError({ sourceId });
```

Use `Effect.fail(...)` in non-generator combinator code:

```ts
Effect.flatMap(source, Option.match({
  onNone: () => Effect.fail(new SourceNotFoundError({ sourceId })),
  onSome: Effect.succeed,
}));
```

### Promise.catch / Promise.reject

Bad:

```ts
await client.close().catch(() => {});
return Promise.reject(new Error("failed"));
```

Good:

```ts
Effect.tryPromise({
  try: () => client.close(),
  catch: (cause) => new ClientCloseError({ cause }),
});
```

If the failure is intentionally ignored:

```ts
Effect.ignore(
  Effect.tryPromise({
    try: () => client.close(),
    catch: (cause) => new ClientCloseError({ cause }),
  }),
);
```

### try/catch

Bad:

```ts
try {
  return JSON.parse(text);
} catch (cause) {
  return new ParseError({ message: String(cause) });
}
```

Good for schema-backed input:

```ts
Schema.decodeUnknownEffect(Schema.fromJsonString(InputSchema))(text).pipe(
  Effect.mapError(() => new ParseError({ message: "Failed to parse input" })),
);
```

Good for non-schema throwing APIs:

```ts
Effect.try({
  try: () => new URL(value),
  catch: (cause) => new UrlParseError({ value, cause }),
});
```

### Unknown error message / instanceof Error

Bad:

```ts
err instanceof Error ? err.message : String(err);
```

Prefer one of:

```ts
Effect.mapError((err) => new DomainError({ cause: err }));
```

```ts
Effect.catchTag("KnownError", (err) =>
  Effect.fail(new DomainError({ message: err.message })),
);
```

Only read `.message` from a typed error union where the type proves that property exists. Do not inspect unknown thrown values for domain behavior.

### Redundant error helpers

Bad:

```ts
const connectionError = (message: string) =>
  new McpConnectionError({ transport: "remote", message });

return yield* connectionError("Endpoint URL is required");
```

Good:

```ts
return yield* new McpConnectionError({
  transport: "remote",
  message: "Endpoint URL is required",
});
```

Helpers are allowed only when they do real work, such as:

- choosing between different tagged errors
- decoding/parsing an external error shape
- preserving protocol-specific fields
- normalizing third-party SDK failures into one domain error

## New error or existing error?

Reuse an existing tagged error when only the message changes.

Create a new tagged error when a caller can reasonably branch differently:

- different HTTP status
- retry vs no retry
- auth/sign-in affordance
- not-found vs conflict vs validation
- user-actionable vs internal failure
- different telemetry grouping that should not depend on message text

Do not create one tagged error per sentence of prose.

## What not to report

- Test assertions that intentionally construct errors as fixture values.
- Runtime adapter edges that must satisfy a third-party throwing API, as long as the throw is contained and converted to typed Effect failure.
- Real normalization helpers like `toOAuth2Error(cause)` that inspect protocol fields and preserve structured semantics.
- React/effect-atom mutation handlers using `try/catch`; use `wrdn-effect-promise-exit` for that UI-specific boundary.

## Output requirements

When reviewing, report:

- **File and line** of the untyped error pattern.
- **Rule** being violated.
- **Existing domain error** to use, or the new tagged error that should exist.
- **Fix** in the relevant shape: direct `yield* new ErrorType(...)`, `Effect.tryPromise`, schema decode, or direct constructor inline.

When editing, keep the error type precise and avoid broad message parsing.

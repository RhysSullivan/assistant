import { transform } from "sucrase";

/**
 * Strip TypeScript type syntax (`: T`, `as T`, `<T>`, type aliases,
 * interfaces, etc.) from user-submitted code so it can run in workerd,
 * which only accepts plain JavaScript.
 *
 * The execute tool description tells callers to write TypeScript, and the
 * `tools.describe.tool` output hands them TypeScript shapes — without this
 * step a single `: number` annotation throws "Unexpected token ':'" at
 * runtime, which used to surface as a 180s client-side timeout (see
 * engine.ts `awaitCompletionOrPause` history) and now surfaces as
 * `DynamicWorkerExecutionError` to the model.
 *
 * Sucrase's TypeScript transform is purely syntactic — no semantic checks,
 * no decorator metadata — which keeps the cost low and matches what
 * `tsc --isolatedModules` / Node's experimental type-stripping do.
 *
 * On parse failure we rethrow the original error so the caller can map it
 * into a tagged `DynamicWorkerExecutionError`. We deliberately do NOT
 * fall back to the raw input — passing TS syntax through to workerd
 * trades a clean error here for an opaque one inside the dynamic worker.
 */
export const stripTypeScript = (code: string): string =>
  transform(code, {
    transforms: ["typescript"],
    // No JSX in user code, no React-specific transforms. `disableESTransforms`
    // keeps sucrase from rewriting `import`/`export` etc — we want only
    // type-syntax removal.
    disableESTransforms: true,
    keepUnusedImports: true,
  }).code;

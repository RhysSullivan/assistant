# @executor-js/env

Vendored environment tooling based on [`rayhanadev/effect-env`](https://github.com/rayhanadev/effect-env), with runtime ergonomics inspired by [`t3-oss/t3-env`](https://github.com/t3-oss/t3-env).

## What this adds

- `Env` helper constructors for Effect `Config` values
- `makeEnv` for Effect Context/Layer integration
- `createEnv(shape, options)` for runtime env assembly with:
  - an optional `prefix` for client-safe keys
  - `runtimeEnv`
  - `onValidationError` / `onInvalidAccess`
  - `skipValidation`
  - `emptyStringAsUndefined`
  - `extends`
  - `createFinalConfig` customization hook

## Example

```ts
import { createEnv, Env } from "@executor-js/env";

export const shared = createEnv(
  {
    NODE_ENV: Env.literal("NODE_ENV", "development", "test", "production"),
  },
  {
    runtimeEnv: process.env,
  },
);

export const web = createEnv(
  {
    PUBLIC_API_URL: Env.url("PUBLIC_API_URL"),
  },
  {
    prefix: "PUBLIC_",
    runtimeEnv: import.meta.env,
  },
);

export const server = createEnv(
  {
    DATABASE_URL: Env.url("DATABASE_URL"),
    PORT: Env.numberOr("PORT", 3000),
  },
  {
    runtimeEnv: process.env,
    extends: [shared],
  },
);
```

# @executor/plugin-openapi

Load [OpenAPI](https://www.openapis.org/) specifications into an executor. Every operation in the spec becomes an invokable tool with a JSON-Schema input, automatic request building, and optional secret-backed auth.

## Install

```sh
bun add @executor/sdk @executor/plugin-openapi
# or
npm install @executor/sdk @executor/plugin-openapi
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { openApiPlugin } from "@executor/plugin-openapi";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [openApiPlugin()] as const,
});

// Load a spec by URL (JSON or YAML, remote or file://)
await executor.openapi.addSpec({
  spec: "https://petstore3.swagger.io/api/v3/openapi.json",
  namespace: "petstore",
});

// List and invoke tools like any other plugin
const tools = await executor.tools.list();
const result = await executor.tools.invoke(
  "petstore.listPets",
  {},
  { onElicitation: "accept-all" },
);
```

## Secret-backed auth headers

Wire API keys or bearer tokens through the executor's secret store — never hard-code them in source configs:

```ts
await executor.secrets.set({
  id: "stripe-key",
  name: "Stripe Key",
  value: "sk_live_...",
  purpose: "authentication",
});

await executor.openapi.addSpec({
  spec: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  namespace: "stripe",
  headers: {
    Authorization: { secretId: "stripe-key", prefix: "Bearer " },
  },
});
```

## Presets

Common public APIs are available as presets from the `/presets` subpath:

```ts
import { openApiPresets } from "@executor/plugin-openapi/presets";
```

## Effect entry point

If you're using `@executor/core` directly, import from the `/core` subpath:

```ts
import { openApiPlugin } from "@executor/plugin-openapi";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT

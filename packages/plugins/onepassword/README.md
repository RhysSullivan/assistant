# @executor/plugin-onepassword

[1Password](https://1password.com) integration for the executor. Provides a secret source that resolves values from a 1Password vault, backed by either the desktop app (connect.sock) or a service account token.

Pairs with [`@executor/sdk`](https://www.npmjs.com/package/@executor/sdk) (promise-based) or [`@executor/core`](https://www.npmjs.com/package/@executor/core) (Effect-based).

## Install

```sh
bun add @executor/sdk @executor/plugin-onepassword
# or
npm install @executor/sdk @executor/plugin-onepassword
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { onepasswordPlugin } from "@executor/plugin-onepassword/core";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [onepasswordPlugin()] as const,
});

// Point the plugin at your account
await executor.onepassword.configure({
  auth: { kind: "desktop-app", accountName: "my-account" },
});

// Inspect connection / list vaults
const status = await executor.onepassword.status();
const vaults = await executor.onepassword.listVaults({
  kind: "desktop-app",
  accountName: "my-account",
});
```

For CI and headless environments, use a service-account token instead of the desktop app:

```ts
await executor.onepassword.configure({
  auth: { kind: "service-account", token: process.env.OP_SERVICE_ACCOUNT_TOKEN! },
});
```

## Effect entry point

If you're using `@executor/core` directly, the same import path works — this plugin does not ship a separate promise entry.

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
